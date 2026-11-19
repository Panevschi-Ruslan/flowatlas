import { Injectable } from '@nestjs/common';
import http from 'http';

export interface StatusConfig {
  port: number;
  /**
   * The route the readiness check answers at.
   *
   * @default '/ready'
   */
  route?: string;
}

/** A small server of its own beside the application, made only when it is asked for. */
@Injectable()
export class StatusServer {
  start(config: StatusConfig): void {
    // Loaded lazily, so the package is only needed where the server runs.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const express: typeof import('express') = require('express');
    const app = express();
    app.get('/status', (_req, res) => {
      res.send({ status: 'ok' });
    });
    app.get(config.route || '/ready', (_req, res) => {
      res.send({ ready: true });
    });
    http.createServer(app).listen(config.port);
  }
}
