import { dataSource } from '@/lib/datasource';
import { contextHashV2 } from '@/fixtures/brand';
import { ContextView } from '@/components/context/context-view';

export default async function ContextPage() {
  const [brand, factsV1, factsV2] = await Promise.all([
    dataSource.getBrand(),
    dataSource.getFacts(1),
    dataSource.getFacts(2),
  ]);
  return <ContextView brand={brand} factsV1={factsV1} factsV2={factsV2} hashV2={contextHashV2} />;
}
