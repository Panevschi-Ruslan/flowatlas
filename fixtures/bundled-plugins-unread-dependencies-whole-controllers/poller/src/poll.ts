/** The installed tags plugin, shipped only as a rollup build: one route its package answers, one the application's extension does. */
export const tags = () => fetch('http://localhost:4510/api/tags/tags').then((res) => res.json());
export const tag = (body: unknown) => fetch('http://localhost:4510/api/tags/tags', { method: 'POST', body: JSON.stringify(body) }).then((res) => res.json());

/** The installed reports plugin, shipped only as an esbuild build. */
export const reports = () => fetch('http://localhost:4510/api/reports/reports').then((res) => res.json());

/** The reviews plugin's routes, its controllers written whole by an extension. */
export const reviews = () => fetch('http://localhost:4510/api/reviews/list').then((res) => res.json());
export const removeReview = (id: string) => fetch(`http://localhost:4510/api/reviews/${id}`, { method: 'DELETE' }).then((res) => res.json());
export const flag = () => fetch('http://localhost:4510/api/reviews/flag', { method: 'POST' }).then((res) => res.json());

/** The api, on the port its deployment writes through three functions. */
export const apiHealth = () => fetch('http://localhost:4610/health').then((res) => res.json());
