import { createHash } from 'node:crypto';

// 16 hex chars to match the fixture hash format (a3f91c7e2b445d10) and the
// shortHash display. Server-only: node:crypto must stay out of client bundles.
export function sha256Hex16(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
