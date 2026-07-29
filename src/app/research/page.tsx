import { getActiveBrandId, getDataSource } from '@/lib/datasource.server';
import { ResearchFeed } from '@/components/research/feed';

export default async function ResearchPage() {
  const dataSource = await getDataSource();
  // v2 so the feed can resolve performance_loop fact ids too if replayed late.
  const facts = await dataSource.getFacts(2);
  const brandId = await getActiveBrandId();
  return <ResearchFeed facts={facts} brandId={brandId} />;
}
