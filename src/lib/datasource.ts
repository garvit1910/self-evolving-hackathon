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
import { magicSpoonBrand } from '@/fixtures/brand';
import { performanceLoopFacts, researchFacts } from '@/fixtures/facts';
import { gen1Creatives } from '@/fixtures/creatives';
import { panelScores } from '@/fixtures/panel-scores';
import { learnings } from '@/fixtures/learnings';
import { autopilotEvents } from '@/fixtures/autopilot-events';
import metricsJson from '@/fixtures/metrics.json';

// Offline fixture implementation — zero network, zero env vars.
// Track A: implement DataSource against Supabase and swap the export below.
export class FixtureDataSource implements DataSource {
  getBrand(): Promise<Brand> {
    return Promise.resolve(magicSpoonBrand);
  }

  getFacts(contextVersion = 1): Promise<Fact[]> {
    return Promise.resolve(
      contextVersion >= 2 ? [...researchFacts, ...performanceLoopFacts] : researchFacts,
    );
  }

  getCreatives(): Promise<Creative[]> {
    return Promise.resolve(gen1Creatives);
  }

  getMetrics(): Promise<DailyMetrics[]> {
    return Promise.resolve(metricsJson as DailyMetrics[]);
  }

  getLearnings(): Promise<Learning[]> {
    return Promise.resolve(learnings);
  }

  getPanelScores(): Promise<PanelScore[]> {
    return Promise.resolve(panelScores);
  }

  getAutopilotEvents(): Promise<AutopilotEvent[]> {
    return Promise.resolve(autopilotEvents);
  }
}

export const dataSource: DataSource = new FixtureDataSource();
