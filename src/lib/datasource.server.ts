import { cookies } from 'next/headers';
import type {
  AutopilotEvent,
  Brand,
  Creative,
  DailyMetrics,
  DataSource,
  Fact,
  Learning,
  PanelScore,
} from './contracts';
import { dataSource as fixtureDataSource } from './datasource';
import { BRAND_COOKIE, FIXTURE_BRAND_ID } from './server/brands';
import { getStore } from './store';

// Server-side brand switch. No cookie / fixture brand / unknown brand → the
// offline FixtureDataSource, byte-identical to today's demo. A created brand →
// StoreDataSource reading LocalStore in-process (server components never
// fetch-to-self; RemoteDataSource covers client components).

export class StoreDataSource implements DataSource {
  constructor(private readonly brandId: string) {}

  async getBrand(): Promise<Brand> {
    const brand = getStore().getBrand(this.brandId);
    if (!brand) throw new Error(`unknown brand: ${this.brandId}`);
    return brand;
  }

  /** Mirrors fixture semantics: v1 = research facts, v2+ adds performance_loop. */
  async getFacts(contextVersion = 1): Promise<Fact[]> {
    const facts = getStore().getFacts(this.brandId);
    return contextVersion >= 2 ? facts : facts.filter((f) => f.origin === 'research');
  }

  async getCreatives(): Promise<Creative[]> {
    return getStore().getCreatives(this.brandId);
  }

  async getMetrics(): Promise<DailyMetrics[]> {
    return getStore().getMetrics(this.brandId);
  }

  async getLearnings(): Promise<Learning[]> {
    return getStore().getLearnings(this.brandId);
  }

  async getPanelScores(): Promise<PanelScore[]> {
    return getStore().getPanelScores(this.brandId);
  }

  async getAutopilotEvents(): Promise<AutopilotEvent[]> {
    return getStore().getEvents(this.brandId);
  }
}

export async function getActiveBrandId(): Promise<string | null> {
  const jar = await cookies();
  const id = jar.get(BRAND_COOKIE)?.value;
  if (!id || id === FIXTURE_BRAND_ID || !getStore().hasBrand(id)) return null;
  return id;
}

export async function getDataSource(): Promise<DataSource> {
  const id = await getActiveBrandId();
  return id ? new StoreDataSource(id) : fixtureDataSource;
}
