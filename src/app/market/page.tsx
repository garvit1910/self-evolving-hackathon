import { dataSource } from '@/lib/datasource';
import { MarketDashboard } from '@/components/market/dashboard';

export default async function MarketPage() {
  const [metrics, creatives] = await Promise.all([
    dataSource.getMetrics(),
    dataSource.getCreatives(),
  ]);
  return <MarketDashboard metrics={metrics} creatives={creatives} />;
}
