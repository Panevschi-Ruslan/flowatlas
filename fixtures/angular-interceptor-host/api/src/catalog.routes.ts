import { Router } from 'express';

export const catalogRouter = Router();

catalogRouter.get('/products', (req, res) => res.json([]));

catalogRouter.get('/products/featured', (req, res) => res.json([]));

catalogRouter.get('/products/:id', (req, res) => res.json({ id: req.params.id, name: '' }));

catalogRouter.get('/sellers/:name', (req, res) => res.json({ name: req.params.name, following: false }));

catalogRouter.post('/sellers/:name/follow', (req, res) => res.json({ name: req.params.name, following: true }));
