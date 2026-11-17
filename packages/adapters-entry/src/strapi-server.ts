import { hasAnyDependency, type EntryAdapter } from '@flowatlas/core';
import { strapiListens } from './listen-ports.js';

/**
 * A Strapi application's server, as far as where it listens (P321).
 *
 * Strapi starts its own server, from `config/server.*`, and the application
 * declares neither Koa, which it is built on, nor a `listen` of its own: no
 * other adapter is detected for it, so none would say where it listens. This
 * one says only that - the port its configuration gives, moved by the `.env`
 * Strapi loads, or Strapi's 1337 - and reads no route: the routes its core
 * routers declare are not read yet.
 */
export const strapiServerAdapter: EntryAdapter = {
  name: 'strapi-server',
  detect: (pkg) => hasAnyDependency(pkg, ['@strapi/strapi']),
  extractEntries: () => [],
  listens: strapiListens,
};
