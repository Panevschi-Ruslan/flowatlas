import express from 'express';
import { catalogueItem, withdrawItem } from './catalogue.handlers';

/** The catalogue's API, in a clone nobody has installed. */
export const app = express();

app.use(express.json());
app.post('/items', catalogueItem);
app.delete('/items/:itemId', withdrawItem);

app.listen(3000);
