import type {
  AutopilotEvent,
  Brand,
  ContextSnapshot,
  Creative,
  DailyMetrics,
  DataSource,
  Fact,
  Learning,
  PanelScore,
} from './contracts';

// Client-side DataSource against the HTTP routes — the documented contract for
// anything living outside the server process (client components, Track A tools).
// Server components use StoreDataSource (datasource.server.ts) instead.
export class RemoteDataSource implements DataSource {
  constructor(private readonly brandId: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private state(): Promise<{
    creatives: Creative[];
    metrics: DailyMetrics[];
    learnings: Learning[];
    panelScores: PanelScore[];
  }> {
    return this.get(`/api/brands/${this.brandId}/state`);
  }

  async getBrand(): Promise<Brand> {
    return (await this.get<{ brand: Brand }>(`/api/brands/${this.brandId}`)).brand;
  }

  async getFacts(contextVersion = 1): Promise<Fact[]> {
    const snap = await this.get<ContextSnapshot>(`/api/brands/${this.brandId}/context`);
    return contextVersion >= 2 ? snap.facts : snap.facts.filter((f) => f.origin === 'research');
  }

  async getCreatives(): Promise<Creative[]> {
    return (await this.state()).creatives;
  }

  async getMetrics(): Promise<DailyMetrics[]> {
    return (await this.state()).metrics;
  }

  async getLearnings(): Promise<Learning[]> {
    return (await this.state()).learnings;
  }

  async getPanelScores(): Promise<PanelScore[]> {
    return (await this.state()).panelScores;
  }

  async getAutopilotEvents(): Promise<AutopilotEvent[]> {
    return (await this.get<{ events: AutopilotEvent[] }>(`/api/brands/${this.brandId}/events`))
      .events;
  }
}
