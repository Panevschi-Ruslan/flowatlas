import Koa from 'koa';
import api from './routes/api/index';

/** The server, with the API's router installed under `/api`. */
const app = new Koa();

app.use(api.routes()).use(api.allowedMethods());

app.listen(3000);
