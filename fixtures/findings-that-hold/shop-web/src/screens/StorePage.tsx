import { useEffect, useState } from 'react';

/** The page's idea of a store: more than the stores service answers. */
export interface StoreView {
  id: string;
  name: string;
  address?: string;
  distance?: number;
  rating: number;
  changesFromPrevious?: { added: string[] };
}

export async function fetchStore(id: string): Promise<StoreView> {
  const response = await fetch(`${import.meta.env.VITE_STORES_URL}/stores/${id}`);
  return response.json();
}

/** Read behind a check: with no distance the label falls back to the address, itself read with a fallback. */
export function distanceLabel(v: StoreView): string {
  const m = v.distance;
  if (m == null) return v.address ?? '';
  return `${m} km`;
}

/** Read behind a check: no changes, no summary. */
export function changeSummary(row: StoreView): string {
  const d = row.changesFromPrevious;
  if (d) {
    return d.added.join(', ');
  }
  return '';
}

/** `rating` is read as it is: the stores service never answers it. */
export function StorePage({ id }: { id: string }) {
  const [store, setStore] = useState<StoreView | null>(null);
  useEffect(() => {
    fetchStore(id).then(setStore);
  }, [id]);
  if (store === null) return null;
  return (
    <div>
      <b>{store.name}</b>
      <i>{distanceLabel(store)}</i>
      <span>{store.rating.toFixed(1)}</span>
      <p>{changeSummary(store)}</p>
    </div>
  );
}
