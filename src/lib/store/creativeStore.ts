/**
 * CreativeStore — the persistence seam. Phase 2 needs to persist creatives, but
 * the shared Drizzle/Supabase schema is Track-G-coupled and does not exist yet.
 * This narrow interface unblocks generation now; a Supabase implementation slots
 * in behind the same three methods later without touching the engine.
 *
 * Images go under public/runs/ so Next serves them directly. Metadata goes under
 * .runs/ (gitignored) so generated JSON never pollutes the repo.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Creative } from '@/lib/contracts';

export interface CreativeStore {
  saveRun(runId: string, creatives: Creative[]): Promise<void>;
  getRun(runId: string): Promise<Creative[] | null>;
  /** Persists image bytes; returns the public URL to store on Creative.imageUrl. */
  saveImage(runId: string, id: string, data: Buffer): Promise<string>;
}

export function createFileCreativeStore(root: string = process.cwd()): CreativeStore {
  const imageDir = (runId: string) => join(root, 'public', 'runs', runId);
  const metaDir = (runId: string) => join(root, '.runs', runId);

  return {
    async saveImage(runId, id, data) {
      const dir = imageDir(runId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.png`), data);
      return `/runs/${runId}/${id}.png`;
    },

    async saveRun(runId, creatives) {
      const dir = metaDir(runId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'creatives.json'), JSON.stringify(creatives, null, 2));
    },

    async getRun(runId) {
      const path = join(metaDir(runId), 'creatives.json');
      if (!existsSync(path)) return null;
      return JSON.parse(await readFile(path, 'utf8')) as Creative[];
    },
  };
}
