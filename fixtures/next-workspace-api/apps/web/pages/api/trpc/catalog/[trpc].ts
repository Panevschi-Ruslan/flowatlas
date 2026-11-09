import { createNextApiHandler } from '@shop/api/createNextApiHandler';
import { catalogRouter } from '@shop/api/routers/catalog/_router';

export default createNextApiHandler(catalogRouter);
