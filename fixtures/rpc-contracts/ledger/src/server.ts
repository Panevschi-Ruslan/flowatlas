import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { ledgerRouter } from './router';

createHTTPServer({ router: ledgerRouter, basePath: '/api/' }).listen(4500);
