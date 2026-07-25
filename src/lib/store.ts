import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type {
  AutopilotEvent,
  Brand,
  Brief,
  Creative,
  DailyMetrics,
  Fact,
  Learning,
  PanelScore,
} from './contracts';

// JSON-file persistence under .data/ so created brands survive dev-server
// restarts. All API routes read/write through this store; the offline fixture
// demo never touches it. Server-only (node:fs) — never import from 'use client'.
//
// Layout:
//   .data/brands/<brandId>/{brand,facts,creatives,metrics,learnings,events,briefs,panel-scores}.json
//   .data/uploads/<brandId>/<product image>
//   .data/creatives/<brandId>/<creativeId>.{png,svg}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

type Collection =
  | 'facts'
  | 'creatives'
  | 'metrics'
  | 'learnings'
  | 'events'
  | 'briefs'
  | 'panel-scores';

export class LocalStore {
  constructor(readonly root: string = defaultRoot()) {}

  private brandDir(brandId: string): string {
    return path.join(this.root, 'brands', brandId);
  }

  private filePath(brandId: string, name: Collection | 'brand'): string {
    return path.join(this.brandDir(brandId), `${name}.json`);
  }

  private readJson<T>(file: string, fallback: T): T {
    if (!existsSync(file)) return fallback;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  // tmp + rename so a crash mid-write never leaves a torn JSON file behind
  private writeJson(file: string, value: unknown): void {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    renameSync(tmp, file);
  }

  // ---- brands ----

  listBrands(): Brand[] {
    const dir = path.join(this.root, 'brands');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((id) => this.getBrand(id))
      .filter((b): b is Brand => b !== null);
  }

  hasBrand(brandId: string): boolean {
    return existsSync(this.filePath(brandId, 'brand'));
  }

  getBrand(brandId: string): Brand | null {
    return this.readJson<Brand | null>(this.filePath(brandId, 'brand'), null);
  }

  putBrand(brand: Brand): void {
    this.writeJson(this.filePath(brand.id, 'brand'), brand);
  }

  // ---- facts ----

  getFacts(brandId: string): Fact[] {
    return this.readJson<Fact[]>(this.filePath(brandId, 'facts'), []);
  }

  putFacts(brandId: string, facts: Fact[]): void {
    this.writeJson(this.filePath(brandId, 'facts'), facts);
  }

  /** Dedupe by id, last write wins. Returns the full stored set. */
  appendFacts(brandId: string, facts: Fact[]): Fact[] {
    const byId = new Map(this.getFacts(brandId).map((f) => [f.id, f]));
    for (const f of facts) byId.set(f.id, f);
    const all = [...byId.values()];
    this.putFacts(brandId, all);
    return all;
  }

  // ---- creatives ----

  getCreatives(brandId: string): Creative[] {
    return this.readJson<Creative[]>(this.filePath(brandId, 'creatives'), []);
  }

  appendCreatives(brandId: string, creatives: Creative[]): void {
    const byId = new Map(this.getCreatives(brandId).map((c) => [c.id, c]));
    for (const c of creatives) byId.set(c.id, c);
    this.writeJson(this.filePath(brandId, 'creatives'), [...byId.values()]);
  }

  updateCreative(brandId: string, creativeId: string, patch: Partial<Creative>): void {
    const all = this.getCreatives(brandId);
    const idx = all.findIndex((c) => c.id === creativeId);
    if (idx === -1) return;
    all[idx] = { ...all[idx], ...patch };
    this.writeJson(this.filePath(brandId, 'creatives'), all);
  }

  // ---- metrics ----

  getMetrics(brandId: string): DailyMetrics[] {
    return this.readJson<DailyMetrics[]>(this.filePath(brandId, 'metrics'), []);
  }

  /** Rows keyed (adId, day) — re-posting a day replaces it instead of duplicating. */
  appendMetrics(brandId: string, rows: DailyMetrics[]): void {
    const byKey = new Map(this.getMetrics(brandId).map((m) => [`${m.adId}:${m.day}`, m]));
    for (const m of rows) byKey.set(`${m.adId}:${m.day}`, m);
    this.writeJson(this.filePath(brandId, 'metrics'), [...byKey.values()]);
  }

  // ---- learnings ----

  getLearnings(brandId: string): Learning[] {
    return this.readJson<Learning[]>(this.filePath(brandId, 'learnings'), []);
  }

  upsertLearnings(brandId: string, learnings: Learning[]): void {
    const byId = new Map(this.getLearnings(brandId).map((l) => [l.id, l]));
    for (const l of learnings) byId.set(l.id, l);
    this.writeJson(this.filePath(brandId, 'learnings'), [...byId.values()]);
  }

  /** Marks a learning sensoIngested (Track A calls this after the real Senso write). */
  setLearningIngested(learningId: string, brandId?: string): boolean {
    const brands = brandId ? [brandId] : this.listBrands().map((b) => b.id);
    for (const id of brands) {
      const all = this.getLearnings(id);
      const idx = all.findIndex((l) => l.id === learningId);
      if (idx === -1) continue;
      all[idx] = { ...all[idx], sensoIngested: true };
      this.writeJson(this.filePath(id, 'learnings'), all);
      return true;
    }
    return false;
  }

  // ---- autopilot events ----

  getEvents(brandId: string, sinceTs?: number): AutopilotEvent[] {
    const all = this.readJson<AutopilotEvent[]>(this.filePath(brandId, 'events'), []);
    return sinceTs === undefined ? all : all.filter((e) => e.ts > sinceTs);
  }

  appendEvents(brandId: string, events: AutopilotEvent[]): void {
    const all = this.readJson<AutopilotEvent[]>(this.filePath(brandId, 'events'), []);
    all.push(...events);
    this.writeJson(this.filePath(brandId, 'events'), all);
  }

  // ---- panel scores ----

  getPanelScores(brandId: string): PanelScore[] {
    return this.readJson<PanelScore[]>(this.filePath(brandId, 'panel-scores'), []);
  }

  appendPanelScores(brandId: string, scores: PanelScore[]): void {
    const byKey = new Map(
      this.getPanelScores(brandId).map((s) => [`${s.creativeId}:${s.persona}`, s]),
    );
    for (const s of scores) byKey.set(`${s.creativeId}:${s.persona}`, s);
    this.writeJson(this.filePath(brandId, 'panel-scores'), [...byKey.values()]);
  }

  // ---- briefs ----

  getBriefs(brandId: string): Brief[] {
    return this.readJson<Brief[]>(this.filePath(brandId, 'briefs'), []);
  }

  appendBriefs(brandId: string, briefs: Brief[]): void {
    const byId = new Map(this.getBriefs(brandId).map((b) => [b.id, b]));
    for (const b of briefs) byId.set(b.id, b);
    this.writeJson(this.filePath(brandId, 'briefs'), [...byId.values()]);
  }

  // ---- binary files (uploads + generated creatives) ----

  /** Stores the uploaded product image; returns its served URL. Browsers hand
   *  over AVIF/HEIC with misleading extensions, and the image providers
   *  (OpenAI /images/edits, Gemini inline_data) only take PNG/JPEG/WebP — so
   *  sniff magic bytes and transcode via `sips` (macOS) when available. */
  saveUpload(brandId: string, filename: string, bytes: Buffer): string {
    const safe = path.basename(filename);
    const file = path.join(this.root, 'uploads', brandId, safe);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);

    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isPng && !isJpeg && !isWebp) {
      try {
        // sips refuses identical in/out paths (uploads are often ".png"-named
        // AVIF), so transcode through a temp file and swap it into place
        const tmp = `${file}.transcode.png`;
        execFileSync('sips', ['-s', 'format', 'png', file, '--out', tmp], { stdio: 'ignore' });
        const png = file.replace(/\.[^.]+$/, '') + '.png';
        rmSync(file);
        renameSync(tmp, png);
        return `/api/files/uploads/${brandId}/${path.basename(png)}`;
      } catch {
        console.warn(`[store] product image is not PNG/JPEG/WebP and transcode failed — live image edits may reject it`);
      }
    }
    return `/api/files/uploads/${brandId}/${safe}`;
  }

  /** Absolute path of the brand's stored product image, if any. */
  productImagePathFor(brandId: string): string | null {
    const dir = path.join(this.root, 'uploads', brandId);
    if (!existsSync(dir)) return null;
    const first = readdirSync(dir).find((f) => !f.startsWith('.'));
    return first ? path.join(dir, first) : null;
  }

  /** Stores a generated ad image; returns its served URL. */
  saveCreativeImage(brandId: string, filename: string, bytes: Buffer): string {
    const safe = path.basename(filename);
    const file = path.join(this.root, 'creatives', brandId, safe);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return `/api/files/creatives/${brandId}/${safe}`;
  }

  /** Serves files back out. Only uploads/ and creatives/ are reachable. */
  readServedFile(relPath: string): { bytes: Buffer; contentType: string } | null {
    const resolved = path.resolve(this.root, relPath);
    const allowed = ['uploads', 'creatives'].some((dir) =>
      resolved.startsWith(path.resolve(this.root, dir) + path.sep),
    );
    if (!allowed || !existsSync(resolved)) return null;
    const ext = path.extname(resolved).toLowerCase();
    return {
      bytes: readFileSync(resolved),
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
    };
  }
}

function defaultRoot(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
}

// One instance per process, surviving Next dev HMR module reloads. Re-created
// when DATA_DIR changes so tests can point at fresh temp dirs.
export function getStore(): LocalStore {
  const g = globalThis as typeof globalThis & { __swarmadsStore?: LocalStore };
  const root = defaultRoot();
  if (!g.__swarmadsStore || g.__swarmadsStore.root !== root) {
    g.__swarmadsStore = new LocalStore(root);
  }
  return g.__swarmadsStore;
}
