import express from 'express';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.development' });

/** Loads .env.development before it listens on PORT. */
const app = express();

app.get('/stuff', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT);
