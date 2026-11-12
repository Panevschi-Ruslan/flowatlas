import express from 'express';

const app = express();

app.get('/v1/tokens/list', (_req, res) => res.json([]));
app.delete('/v1/tokens/revoke', (_req, res) => res.status(204).end());
app.get('/v1/docs/:slug', (req, res) => res.json({ slug: req.params.slug }));

app.listen(4100);
