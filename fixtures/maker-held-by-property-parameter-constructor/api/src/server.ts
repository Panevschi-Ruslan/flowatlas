import express, { Application } from 'express';

import { catalog } from './catalog.routes';
import { mountOrders } from './orders.routes';
import { plugins } from './plugins.routes';
import { mountReports } from './reports.routes';
import services from './services';

/**
 * `express` is declared and not installed, so nothing here has a type. The
 * application is a field declared with no value of its own and given one by
 * the constructor - the only place that writes it, with the framework's own
 * maker - so it is as sure as `const app = express()` would be (P354).
 */
export class Server {
  private app: Application;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    // A parameter every caller hands the application to.
    mountOrders(this.app);
    // Members of objects written in place.
    this.app.use('/api/catalog', catalog.router);
    this.app.use('/api/plugins', plugins.router);
    // Handed round a list: no caller of `mountReports` can be read.
    [mountReports].forEach((mount) => mount(this.app));
  }

  /** A service started by its name, through a map of lazy imports. */
  async start(name: keyof typeof services) {
    const { default: init } = await services[name]();
    init(this.app);
    this.app.listen(3000);
  }
}

new Server().start('status');
