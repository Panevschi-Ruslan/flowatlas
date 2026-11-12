import Router from 'koa-router';
import envelope from './middleware/envelope';
import jobs from './jobs/jobs';
import products from './products/products';

/**
 * The API's router. Every module of it is a router of its own, installed here,
 * and a middleware factory beside them is called once for every request.
 */
const api = new Router({ prefix: '/api' });

api.use(envelope());
api.use(products.routes());
api.use(jobs.routes());

export default api;
