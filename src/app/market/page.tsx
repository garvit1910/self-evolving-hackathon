import { getDataSource } from '@/lib/datasource.server';
import { MarketDashboard } from '@/components/market/dashboard';

export default async function MarketPage() {
  const dataSource = await getDataSource();
  const [metrics, creatives] = await Promise.all([
    dataSource.getMetrics(),
    dataSource.getCreatives(),
  ]);
  return <MarketDashboard metrics={metrics} creatives={creatives} />;
}
