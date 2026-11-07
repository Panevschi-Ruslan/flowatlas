/** Scanned because `imports.dirs` names `queries`, under `app/`. */
export const searchProducts = (q: string) => $fetch('/api/products', { query: { q } });
