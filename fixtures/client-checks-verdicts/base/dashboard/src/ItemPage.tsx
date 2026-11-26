import { useEffect, useState } from 'react';
import { fetchItem, fetchPage, searchItems, type ItemDetail, type ItemRow } from './api';

/** The words a status is shown with: a case for each, and a default for any other. */
const statusLabel = (item: ItemDetail): string => {
  switch (item.status) {
    case 'draft':
      return 'Draft';
    case 'live':
      return 'On sale';
    default:
      return 'Unknown';
  }
};

/** `/items/current`: the item's name and the words for its status, the first page, and a search. */
export function ItemPage() {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [rows, setRows] = useState<ItemRow[]>([]);
  useEffect(() => {
    fetchItem('current').then(setItem);
    fetchPage('1').then(setRows);
    searchItems('kettle').then(setRows);
  }, []);
  return (
    <div>
      <h1>{item?.name}</h1>
      <b>{item === null ? '' : statusLabel(item)}</b>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>{row.name}</li>
        ))}
      </ul>
    </div>
  );
}
