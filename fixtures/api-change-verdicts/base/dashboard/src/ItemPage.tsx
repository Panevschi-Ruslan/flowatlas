import { useEffect, useState } from 'react';
import { fetchItem, type ItemDetail } from './api';

/** `/items/current`: the answer handed to a state's setter; the page reads the name and the price. */
export function ItemPage() {
  const [item, setItem] = useState<ItemDetail | null>(null);
  useEffect(() => {
    fetchItem('current').then(setItem);
  }, []);
  return (
    <div>
      <h1>{item?.name}</h1>
      <b>{item?.price}</b>
    </div>
  );
}
