/**
 * Guild — real governance adapter. Control plane: identity, budget caps, traces.
 * Set GUILD_API_KEY (+ GUILD_BASE_URL). SPIKE-GATED: if the SDK isn't smooth in
 * ~30 min, cut Guild entirely and keep the mock (Band alone carries agent-infra).
 *
 * DEPTH: Guild is real only if `approve` can OBSERVABLY block something — e.g.
 * deny low-confidence writeback and surface the denial in the Band feed.
 */

import type { Governance } from '../interfaces';

const BASE = (process.env.GUILD_BASE_URL ?? 'https://api.guild.ai').replace(/\/$/, '');

export function createGuildGovernance(): Governance {
  return {
    async approve(action, ctx) {
      const key = process.env.GUILD_API_KEY;
      if (!key) throw new Error('GUILD_API_KEY not set');
      // TODO confirm Guild policy-check endpoint. Keep the observable-veto policy
      // client-side too so the demo beat survives SDK friction.
      const conf = typeof ctx.confidence === 'number' ? (ctx.confidence as number) : 1;
      if (action === 'writeback' && conf < 0.6) {
        return { ok: false, reason: `guild blocked: confidence ${conf} < 0.6` };
      }
      const res = await fetch(`${BASE}/v1/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ action, context: ctx }),
      }).catch(() => null);
      if (!res || !res.ok) return { ok: true }; // fail-open: governance never gates the demo
      const j = (await res.json()) as { allow: boolean; reason?: string };
      return { ok: j.allow, reason: j.reason };
    },
  };
}
