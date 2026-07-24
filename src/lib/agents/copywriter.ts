/**
 * Copywriter — generates ad copy for a whole genome set in ONE batched Pioneer
 * call rather than one call per creative: a single tape entry, a single failure
 * mode, and roughly 8x cheaper.
 *
 * The banned-term avoid-list is stated up front so most violations never occur;
 * repairCopy is the second chance for the ones that slip through.
 *
 * The return value is ALWAYS index-aligned with `genomes` and never short — a
 * missing index falls back deterministically to coreMessage + hook, so a partial
 * LLM response degrades one creative instead of derailing the run.
 */

import type { Brief, Genome, Persona } from '@/lib/contracts';
import type { Feed, LLM } from '../adapters/interfaces';
import type { Violation } from '../creative/complianceGate';

type RawCopy = { index: number; copy: string };

const SCHEMA_HINT = '{ copies: { index: number, copy: string }[] }';

function personaBlock(name: string, personas: Persona[]): string {
  const p = personas.find((x) => x.name === name);
  if (!p) return `Audience: ${name}.`;
  return [
    `Audience: ${p.name} — ${p.summary}`,
    p.pains.length ? `  pains: ${p.pains.join('; ')}` : '',
    p.desires.length ? `  desires: ${p.desires.join('; ')}` : '',
    p.objections.length ? `  objections: ${p.objections.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function genomeBlock(g: Genome, i: number, personas: Persona[]): string {
  return [
    `[${i}] angle: ${g.angle} | style: ${g.style}`,
    `    hook: ${g.hook}`,
    `    ${personaBlock(g.persona, personas).split('\n').join('\n    ')}`,
  ].join('\n');
}

function header(brief: Brief, bannedTerms: string[]): string[] {
  const compliance = brief.compliance ?? [];
  return [
    `Core message: ${brief.coreMessage}`,
    `Call to action: ${brief.cta}`,
    compliance.length ? `Compliance rules: ${compliance.join(' ')}` : '',
    `NEVER use these words or phrases: ${bannedTerms.join(', ')}.`,
  ].filter(Boolean);
}

/**
 * Deterministic fallback so the returned array is never short. Interpolates
 * `g.angle` and `g.persona` VERBATIM alongside the hook — both are attribution
 * keys (src/lib/contracts.ts), so genome distinctness must survive into
 * the artifact even when the LLM produced nothing for this index.
 */
function fallbackCopy(brief: Brief, g: Genome): string {
  return `${g.angle}: ${g.hook} ${brief.coreMessage} ${brief.cta}. (${g.persona})`;
}

export async function writeCopy(
  brief: Brief,
  genomes: Genome[],
  personas: Persona[],
  bannedTerms: string[],
  llm: LLM,
  feed: Feed,
  room: string,
): Promise<string[]> {
  if (genomes.length === 0) return [];

  const prompt = [
    'You are an advertising copywriter. Write ONE short ad copy (max 2 sentences)',
    `for each numbered variant below, for the brand described.`,
    'Each copy must match its variant\'s angle, hook and audience. Return one entry',
    'per index, using the SAME index numbers shown.',
    '',
    ...header(brief, bannedTerms),
    '',
    ...genomes.map((g, i) => genomeBlock(g, i, personas)),
  ].join('\n');

  let raw: RawCopy[] = [];
  try {
    const res = await llm.extract<{ copies?: RawCopy[] }>(prompt, SCHEMA_HINT);
    raw = res?.copies ?? [];
  } catch {
    raw = [];
  }

  const byIndex = new Map<number, string>();
  for (const r of raw) {
    if (typeof r?.index === 'number' && typeof r?.copy === 'string' && r.copy.trim()) {
      byIndex.set(r.index, r.copy.trim());
    }
  }

  const copies = genomes.map((g, i) => byIndex.get(i) ?? fallbackCopy(brief, g));

  await feed.post(room, {
    agent: 'copywriter',
    kind: 'tool_result',
    payload: { requested: genomes.length, generated: byIndex.size, fallbacks: genomes.length - byIndex.size },
  });

  return copies;
}

export async function repairCopy(
  brief: Brief,
  genomes: Genome[],
  personas: Persona[],
  violations: Violation[],
  bannedTerms: string[],
  llm: LLM,
  feed: Feed,
  room: string,
): Promise<Map<number, string>> {
  const repaired = new Map<number, string>();
  if (violations.length === 0) return repaired;

  const prompt = [
    'You are an advertising copywriter. The copy for these variants used FORBIDDEN',
    'terms. Rewrite each one to keep the same angle, hook and audience while removing',
    'every forbidden term. Return one entry per index, using the SAME index numbers.',
    '',
    ...header(brief, bannedTerms),
    '',
    ...violations.map((v) =>
      [
        genomeBlock(genomes[v.index], v.index, personas),
        `    FORBIDDEN TERMS USED: ${v.terms.join(', ')}`,
      ].join('\n'),
    ),
  ].join('\n');

  try {
    const res = await llm.extract<{ copies?: RawCopy[] }>(prompt, SCHEMA_HINT);
    for (const r of res?.copies ?? []) {
      if (typeof r?.index === 'number' && typeof r?.copy === 'string' && r.copy.trim()) {
        repaired.set(r.index, r.copy.trim());
      }
    }
  } catch {
    // No repair available; caller drops the violators.
  }

  await feed.post(room, {
    agent: 'copywriter',
    kind: 'thought',
    payload: { repairAttempted: violations.length, repairReturned: repaired.size },
  });

  return repaired;
}
