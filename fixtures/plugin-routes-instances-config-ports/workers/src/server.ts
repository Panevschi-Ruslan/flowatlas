import express from 'express';

const app = express();
app.get('/api/work', (_req, res) => {
  res.json([]);
});

export class Server {
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  start() {
    app.listen(this.port);
  }
}
