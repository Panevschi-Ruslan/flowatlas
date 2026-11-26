import express from 'express';

/** A server on a port of its own, made once per port it is asked for. */
export class Listener {
  private port = 3340;

  constructor(options: { port: number }) {
    Object.assign(this, options);
  }

  start() {
    const app = express();
    app.get('/api/admin', (_req, res) => {
      res.json({ ok: true });
    });
    app.listen(this.port);
  }
}
