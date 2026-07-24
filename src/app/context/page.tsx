import { getActiveBrandId, getDataSource } from '@/lib/datasource.server';
import { contextHashV2 } from '@/fixtures/brand';
import { ContextView } from '@/components/context/context-view';

export default async function ContextPage() {
  const [dataSource, activeBrandId] = await Promise.all([getDataSource(), getActiveBrandId()]);
  const [brand, factsV1, factsV2] = await Promise.all([
    dataSource.getBrand(),
    dataSource.getFacts(1),
    dataSource.getFacts(2),
  ]);
  // Live brands carry a real sha256-derived hash on the brand record; the
  // fixture brand keeps its hand-written constant.
  const hashV2 = activeBrandId ? brand.contextHash : contextHashV2;
  return <ContextView brand={brand} factsV1={factsV1} factsV2={factsV2} hashV2={hashV2} />;
}
