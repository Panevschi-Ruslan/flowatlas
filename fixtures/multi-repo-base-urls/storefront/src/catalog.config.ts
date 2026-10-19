import { registerAs } from '@nestjs/config';

/**
 * The catalog's settings, built from the environment. `catalog.url` names no
 * variable where it is read; this is where it says it is `CATALOG_URL`, and
 * what it falls back to without it.
 */
export default registerAs('catalog', () => ({
  url: process.env.CATALOG_URL || 'http://catalog:3002',
  pageSize: 50,
}));
