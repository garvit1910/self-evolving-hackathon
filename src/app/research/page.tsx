import { dataSource } from '@/lib/datasource';
import { ResearchFeed } from '@/components/research/feed';

export default async function ResearchPage() {
  // v2 so the feed can resolve performance_loop fact ids too if replayed late.
  const facts = await dataSource.getFacts(2);
  return <ResearchFeed facts={facts} />;
}
