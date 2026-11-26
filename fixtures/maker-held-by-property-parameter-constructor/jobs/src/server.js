const express = require('express');

/**
 * Plain JavaScript, nothing installed: the class declares `app` by writing it
 * in its constructor, and nothing else writes it, so it holds the maker's
 * value and only that (P354).
 */
class JobsServer {
  constructor() {
    this.app = express();
    this.app.get('/jobs/health', (_req, res) => {
      res.send('ok');
    });
  }

  start() {
    this.app.listen(4000);
  }
}

new JobsServer().start();
