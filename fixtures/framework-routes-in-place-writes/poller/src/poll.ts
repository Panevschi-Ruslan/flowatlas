/** The cms's featured products, a custom Strapi route under /api. */
export const featured = () => fetch('http://localhost:4310/api/products/featured').then((res) => res.json());

/** The cms's homepage, a single type's core route. */
export const homepage = () => fetch('http://localhost:4310/api/homepage').then((res) => res.json());

/** One product, a core route Strapi's own controller answers. */
export const product = (id: string) => fetch(`http://localhost:4310/api/products/${id}`).then((res) => res.json());

/** The site's function, served by Gatsby's development server. */
export const user = (id: string) => fetch(`http://localhost:8100/api/users/${id}`).then((res) => res.json());

/** The api, on the port its bootstrap assigns over its settings. */
export const health = () => fetch('http://localhost:4330/health').then((res) => res.json());

/** Jobs, on the port of the first file it loads. */
export const jobs = () => fetch('http://localhost:4340/api/jobs').then((res) => res.json());

/** The admin panel, on the port of the one listener started. */
export const admin = () => fetch('http://localhost:4341/api/admin').then((res) => res.json());

/** The gateway, on the FASTIFY_PORT its .env gives, over the PORT its command gives. */
export const status = () => fetch('http://localhost:4351/api/status').then((res) => res.json());
