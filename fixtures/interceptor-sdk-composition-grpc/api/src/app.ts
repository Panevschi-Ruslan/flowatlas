import express from 'express';

export const app = express();

app.use(express.json());

// The back office, reached under its own prefix.
app.get('/office-rest/admin/users', (req, res) => res.json([]));

// The shop, under another.
app.get('/store-rest/products', (req, res) => res.json([]));

// The storefront's orders.
app.get('/api/orders', (req, res) => res.json([]));
app.get('/api/orders/:id', (req, res) => res.json({ id: req.params.id }));
app.get('/api/cart', (req, res) => res.json({ lines: [] }));

app.listen(3000);
