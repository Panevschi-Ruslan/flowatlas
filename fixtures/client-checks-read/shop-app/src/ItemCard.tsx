import { useEffect, useState } from 'react';
import { loadItem } from './api';

/** `/items/:id`: the line `loadItem` makes of the item and its counts. */
export function ItemCard() {
  const [line, setLine] = useState('');
  useEffect(() => {
    void loadItem('current').then(setLine);
  }, []);
  return <p>{line}</p>;
}
