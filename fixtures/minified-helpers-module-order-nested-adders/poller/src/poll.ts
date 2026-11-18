const CMS = 'http://localhost:4720';

/** An esbuild bundle, minified: its helpers renamed. */
export const badges = () => fetch(`${CMS}/api/badges/badges`).then((res) => res.json());
export const addBadge = (body: unknown) => fetch(`${CMS}/api/badges/badges`, { method: 'POST', body: JSON.stringify(body) }).then((res) => res.json());

/** A rolldown bundle, minified. */
export const ribbons = () => fetch(`${CMS}/api/ribbons/ribbons`).then((res) => res.json());

/** A webpack 5 bundle, minified: its loader renamed. */
export const stamps = () => fetch(`${CMS}/api/stamps/stamps`).then((res) => res.json());
export const unstamp = (id: string) => fetch(`${CMS}/api/stamps/stamps/${id}`, { method: 'DELETE' }).then((res) => res.json());

/** A bundle whose loader is of no shape known: still a row. */
export const seals = () => fetch(`${CMS}/api/seals/seals`).then((res) => res.json());
