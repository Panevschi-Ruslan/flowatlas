import { useEffect, useState } from 'react';

/** A screen that opens its stream itself and listens for a named event in place. */
export function PackingScreen({ workspaceId, warehouseId }: { workspaceId: string; warehouseId: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const source = new EventSource(
      `${import.meta.env.VITE_SHIPPING_URL}/workspaces/${workspaceId}/warehouses/${warehouseId}/packing`,
    );
    source.addEventListener('message', () => setCount(count + 1));
    return () => source.close();
  }, [workspaceId, warehouseId]);
  return <p>{count}</p>;
}
