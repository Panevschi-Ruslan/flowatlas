import express, { Router } from 'express';

/**
 * `express` is declared and not installed. A field holding what the
 * framework's own maker made, written by nothing but its own constructor, is
 * the value as surely as a `const` (P350).
 */
class CatalogServer {
  private readonly app = express();
  private products = Router();
  /** Written again outside the constructor: an account of the value. */
  private drafts = Router();

  start(): void {
    this.products.get('/products', (_req, res) => {
      res.json([]);
    });
    this.drafts.get('/drafts', (_req, res) => {
      res.json([]);
    });
    this.app.use('/api', this.products);
    this.app.use('/api', this.drafts);
    this.app.listen(4700);
  }

  reset(): void {
    this.drafts = Router();
  }
}

new CatalogServer().start();

/** Its default is a maker's, and its one caller hands it nothing: the default is the value. */
function mountReviews(router = Router()) {
  router.get('/reviews', (_req, res) => {
    res.json([]);
  });
  return router;
}

mountReviews();

/** A caller hands it a router: what it holds is that caller's account. */
function mountTags(router = Router()) {
  router.get('/tags', (_req, res) => {
    res.json([]);
  });
}

mountTags(Router());
