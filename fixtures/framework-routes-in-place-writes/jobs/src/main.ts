import express from 'express';
import { loadEnvFile } from 'node:process';

// Each call sets only what is not set yet: .env.local's JOBS_PORT stays.
loadEnvFile('.env.local');
loadEnvFile('.env');

const app = express();
app.get('/api/jobs', (_req, res) => {
  res.json([]);
});
app.listen(process.env.JOBS_PORT ?? 3000);
