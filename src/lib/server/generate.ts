import type { Brief, Creative, Genome, PanelScore, Persona, Prior, ProviderMode } from '../contracts';
import type { Feed, LLM } from '../adapters/interfaces';
import type { CreativeStore } from '../store/creativeStore';
import { createMockFeed, createMockGovernance, createMockImageGen, createMockLLM } from '../adapters/mocks';
import { createBandFeed } from '../adapters/real/band';
import { runCreativeEngine } from '../agents/creativeEngine';
import { getContextStore } from '../context';
import { composeBriefs, parsePersonas, type Priors } from '../creative/compose';
import { SvgImageGen, generateAll, getLiveImageGen, type ImageRequest } from '../imagegen';
import { HTTPLLMClient, getLLMConfig } from '../llm';
import { scorePanel } from '../panel';
import { getStore, type LocalStore } from '../store';

// The /generate pipeline (UNIFIED at merge — docs/WIRING.md): Track G retrieval
// (facts + ContextStore.search) composes ONE lead brief; Track A's engine
// (expandGenomes → copywriter → complianceGate drop/repair → governance) turns
// it into screened creatives; images ride Track G's verified chain (Gemini →
// OpenAI edits → SVG) with the uploaded product photo as reference. Every
// engine/feed message is mirrored into AutopilotEvents so governance is a
// visible demo beat, not an internal detail.

const MIN_COUNT = 4;
const MAX_COUNT = 6;

export type GenerateResult = {
  creatives: Creative[];
  briefs: Brief[];
  panelScores: PanelScore[];
  mode: { copy: ProviderMode; image: 'gemini' | 'openai' | 'svg' | 'mixed' };
};

function flag(name: string): boolean {
  return process.env[name] === '1' || process.env[name] === 'true';
}

/** Live LLM (branch `LLM` interface) over Track G's HTTPLLMClient; throws on
 *  failure so the engine's own per-stage fallbacks kick in. */
function liveLLM(client: HTTPLLMClient, onLive: () => void): LLM {
  return {
    async extract<T>(prompt: string, schemaHint: string): Promise<T> {
      const res = await client.jsonChat<T>({
        system:
          'You are a structured extraction engine. Respond ONLY with a valid JSON object ' +
          `matching this schema: ${schemaHint}. No prose.`,
        user: prompt,
        maxTokens: 1200,
      });
      onLive();
      return res;
    },
    async complete(prompt: string): Promise<string> {
      const res = await client.jsonChat<{ text: string }>({
        system: 'Answer as JSON: {"text": "<answer>"}.',
        user: prompt,
        maxTokens: 400,
      });
      onLive();
      return res.text ?? '';
    },
  };
}

const AGENT_LABELS: Record<string, string> = {
  creative: 'Creative',
  copywriter: 'Copywriter',
  imagesmith: 'Imagesmith',
  governance: 'Governance',
};

function feedMessage(agent: string, kind: string, payload: Record<string, unknown>): string {
  if (agent === 'governance' && payload.action === 'creative_drop') {
    return `Dropped creative #${payload.index}: prohibited term(s) ${JSON.stringify(payload.terms)} survived repair.`;
  }
  if (agent === 'governance' && payload.action === 'creative_publish') {
    return payload.ok
      ? 'Publish approved — creative set cleared governance.'
      : `Publish DENIED: ${payload.reason}`;
  }
  if (agent === 'copywriter' && 'repairAttempted' in payload) {
    return `Repair pass: ${payload.repairReturned}/${payload.repairAttempted} violating copies rewritten.`;
  }
  if (agent === 'copywriter') {
    return `Copy written for ${payload.requested} genomes (${payload.generated} live, ${payload.fallbacks} fallback).`;
  }
  if (agent === 'imagesmith') {
    return `Rendered ${payload.rendered} images (${payload.failed} fell back), mode ${payload.mode}.`;
  }
  const rest = Object.entries(payload)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
  return `${kind}: ${rest}`;
}

/** Mirrors every engine feed post into AutopilotEvents (step 'generate') AND
 *  forwards it to the inner feed (Band when USE_REAL_BAND, else mock). The UI
 *  reads only the events route, so it never cares whether Band is up. */
function teeFeed(store: LocalStore, brandId: string): Feed {
  const inner = flag('USE_REAL_BAND') ? createBandFeed() : createMockFeed();
  return {
    async join(room) {
      await inner.join(room).catch(() => {});
    },
    async post(room, event) {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const deny = event.agent === 'governance' && payload.action === 'creative_publish' && !payload.ok;
      store.appendEvents(brandId, [
        {
          step: 'generate',
          status: deny ? 'failed' : 'running',
          ts: Date.now(),
          payload: {
            agent: AGENT_LABELS[event.agent] ?? event.agent,
            message: feedMessage(event.agent, event.kind, payload),
            room,
            ...payload,
          },
        },
      ]);
      await inner.post(room, event).catch(() => {});
    },
  };
}

/** CreativeStore stub for the app path: LocalStore is the persistence
 *  authority (persist:false below), so none of these should ever run. */
const noopCreativeStore: CreativeStore = {
  async saveRun() {},
  async getRun() {
    return null;
  },
  async saveImage() {
    throw new Error('app path renders via src/lib/imagegen.ts, not CreativeStore');
  },
};

export async function generateCreatives(opts: {
  brandId: string;
  generation: 1 | 2;
  priors?: Priors;
  count?: number;
  runId?: string;
}): Promise<GenerateResult> {
  const store = getStore();
  const brand = store.getBrand(opts.brandId);
  if (!brand) throw new Error(`unknown brand: ${opts.brandId}`);

  const count = Math.max(MIN_COUNT, Math.min(MAX_COUNT, opts.count ?? (opts.generation === 2 ? 4 : 6)));
  const facts = store.getFacts(opts.brandId);
  const contextStore = getContextStore();
  const { version, hash } = await contextStore.getVersion(opts.brandId);

  // runId derived from store state, not clocks — offline generation is replayable
  const priorRuns = store.getBriefs(opts.brandId).filter((b) => b.generation === opts.generation);
  const runId = opts.runId ?? `g${opts.generation}r${priorRuns.length + 1}`;

  const queryText =
    facts.find((f) => f.section === 'value_prop')?.statement ?? `${brand.name} advertising angles`;
  const rankedFacts = await contextStore.search(opts.brandId, queryText, 6);

  // -- lead brief: Track G's deterministic composer, engine extras attached --
  const composed = composeBriefs({
    brand,
    facts,
    rankedFacts,
    priors: opts.priors,
    count,
    generation: opts.generation,
    runId,
    contextVersion: version,
    contextHash: hash,
  });
  const lead: Brief = {
    ...composed[0],
    hooks: [...new Set(composed.map((b) => b.hook))],
    compliance: facts.filter((f) => f.section === 'compliance').map((f) => f.statement),
  };

  const personaFacts = facts.filter((f) => f.section === 'persona');
  const personas: Persona[] = parsePersonas(personaFacts).map((name, i) => ({
    id: `${opts.brandId}-p${i + 1}`,
    brandId: opts.brandId,
    name,
    summary: personaFacts[i]?.statement ?? name,
    pains: [],
    desires: [],
    objections: [],
    factIds: personaFacts[i] ? [personaFacts[i].id] : [],
  }));

  const priorList: Prior[] = opts.priors
    ? (Object.entries(opts.priors) as [Prior['dimension'], string][])
        .filter(([, value]) => Boolean(value))
        .map(([dimension, value]) => ({ dimension, value, weight: 1 }))
    : [];

  // -- adapters over Track G seams --
  let anyLiveCopy = false;
  const llmConfig = getLLMConfig();
  const llm = llmConfig
    ? liveLLM(new HTTPLLMClient(llmConfig), () => {
        anyLiveCopy = true;
      })
    : createMockLLM();
  const feed = teeFeed(store, opts.brandId);

  // -- images: Track G's verified chain, product photo as reference --
  const productImagePath = store.productImagePathFor(opts.brandId);
  const render = async (genomes: Genome[], ids: string[]) => {
    const requests: ImageRequest[] = genomes.map((genome, i) => ({
      brief: {
        ...lead,
        id: `${runId}-b${i + 1}`,
        angle: genome.angle,
        persona: genome.persona,
        hook: genome.hook,
        style: genome.style,
        hooks: undefined,
        compliance: undefined,
      },
      creativeId: ids[i],
      brandId: opts.brandId,
      brandName: brand.name,
      productImagePath,
      variant: i,
    }));
    const results = await generateAll(requests, { live: getLiveImageGen(), svg: new SvgImageGen() });
    const modes = [...new Set(results.map((r) => r.mode))];
    await feed.post(`brand-creative:${opts.brandId}`, {
      agent: 'imagesmith',
      kind: 'tool_result',
      payload: {
        rendered: results.filter((r) => r.mode !== 'svg').length,
        failed: results.filter((r) => r.mode === 'svg').length,
        mode: modes.join('+'),
      },
    });
    return results.map((r) => ({ url: r.url, mode: r.mode }));
  };

  const run = await runCreativeEngine(
    runId,
    brand,
    lead,
    personas,
    { llm, feed, governance: createMockGovernance(), imageGen: createMockImageGen() },
    noopCreativeStore,
    count,
    priorList,
    { render, publishedAdIdFor: (id) => `ad-${id}`, persist: false },
  );

  // -- per-creative briefs, axes byte-equal with genomes --
  const briefs: Brief[] = run.creatives.map((c, i) => ({
    id: `${runId}-b${i + 1}`,
    brandId: opts.brandId,
    generation: opts.generation,
    angle: c.genome.angle,
    persona: c.genome.persona,
    hook: c.genome.hook,
    style: c.genome.style,
    coreMessage: lead.coreMessage,
    cta: lead.cta,
    sourceFactIds: lead.sourceFactIds,
    contextVersion: version,
    contextHash: hash,
    priorSource: composed[0].priorSource,
  }));
  const creatives = run.creatives.map((c, i) => ({ ...c, briefId: briefs[i].id }));

  if (run.governance.ok) {
    store.appendBriefs(opts.brandId, briefs);
    store.appendCreatives(opts.brandId, creatives);
  }

  // -- panel --
  const { scores } = await scorePanel({
    creatives,
    personaFacts,
    brandName: brand.name,
  });
  if (run.governance.ok) store.appendPanelScores(opts.brandId, scores);

  const imageModes = run.imageModes.filter((m) => m !== 'mock');
  return {
    creatives,
    briefs,
    panelScores: scores,
    mode: {
      copy: anyLiveCopy ? 'live' : 'mock',
      image: imageModes.length > 1 ? 'mixed' : (imageModes[0] as 'gemini' | 'openai' | 'svg') ?? 'svg',
    },
  };
}
