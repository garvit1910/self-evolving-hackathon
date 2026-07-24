import { getActiveBrandId, getDataSource } from '@/lib/datasource.server';
import { MarketDashboard } from '@/components/market/dashboard';

export default async function MarketPage() {
  const [dataSource, activeBrandId] = await Promise.all([getDataSource(), getActiveBrandId()]);
  const [brand, metrics, creatives, panelScores] = await Promise.all([
    dataSource.getBrand(),
    dataSource.getMetrics(),
    dataSource.getCreatives(),
    dataSource.getPanelScores(),
  ]);
  return (
    <MarketDashboard
      metrics={metrics}
      creatives={creatives}
      panelScores={panelScores}
      brandId={brand.id}
      brandActive={activeBrandId !== null}
    />
  );
}
