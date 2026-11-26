import express from 'express';

/** Listens on PORT; started by bin/jobs, which scripts/run-jobs.sh runs after exporting 4810. */
const app = express();

app.get('/runs', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
