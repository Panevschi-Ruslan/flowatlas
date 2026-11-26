import { useEffect, useState } from 'react';

export function Stock({ id }: { id: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    fetch(`http://localhost:4700/items/${id}`)
      .then((res) => res.json())
      .then((item) => setCount(item.stock));
  }, [id]);
  return <span>{count}</span>;
}
