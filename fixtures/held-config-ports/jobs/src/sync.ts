/** The catalog's items, on the port its bootstrap is handed over the defaults. */
export const items = () => fetch('http://localhost:4100/api/items').then((res) => res.json());

/** The search server, on the port its one caller hands it. */
export const search = () => fetch('http://localhost:4200/api/search').then((res) => res.json());

/** The admin server: one caller hands 4201, the other leaves the default 3201. */
export const reindex = () => fetch('http://localhost:4201/api/reindex', { method: 'GET' });
export const reindexDefault = () => fetch('http://localhost:3201/api/reindex', { method: 'GET' });

/** The orders service, on the port the .env its code loads gives PORT. */
export const orders = () => fetch('http://localhost:4300/api/orders').then((res) => res.json());

/** 3000 is nobody's: the catalog's default is laid under the port it is handed, and orders' fallback under its .env. */
export const stray = () => fetch('http://localhost:3000/api/orders').then((res) => res.json());
