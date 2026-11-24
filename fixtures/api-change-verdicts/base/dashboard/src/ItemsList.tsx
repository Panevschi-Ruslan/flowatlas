import { useEffect, useState } from 'react';
import { fetchItems, type ItemRow } from './api';

/** `/items`: every row's name; the thumbnail is never shown. */
export function ItemsList() {
  const [rows, setRows] = useState<ItemRow[]>([]);
  useEffect(() => {
    fetchItems().then(setRows);
  }, []);
  return <ul>{rows.map((row) => <li key={row.id}>{row.name}</li>)}</ul>;
}
