import { useEffect, useState } from 'react';
import { fetchItems, type ItemRow } from './api';

/** `/items`: every row's name, its badge where it has one, and its stock as it is; the thumbnail is never shown. */
export function ItemsList() {
  const [rows, setRows] = useState<ItemRow[]>([]);
  useEffect(() => {
    fetchItems().then(setRows);
  }, []);
  return <ul>{rows.map((row) => <li key={row.id}>{row.name} {row.badge ?? ''} {row.stock.toFixed(0)}</li>)}</ul>;
}
