import { useEffect, useState } from 'react';

/** The menu's idea of a category; the service answers a type made of itself. */
export interface CategoryNode {
  label: string;
  children: CategoryNode[];
}

export async function fetchCategories(): Promise<CategoryNode[]> {
  const response = await fetch(`${import.meta.env.VITE_STORES_URL}/categories/tree`);
  return response.json();
}

export function CategoryMenu() {
  const [nodes, setNodes] = useState<CategoryNode[]>([]);
  useEffect(() => {
    fetchCategories().then(setNodes);
  }, []);
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.label}>
          {node.label} ({node.children.length})
        </li>
      ))}
    </ul>
  );
}
