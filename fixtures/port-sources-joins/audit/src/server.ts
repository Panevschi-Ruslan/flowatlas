import express from 'express';

/** Audit listens wherever AUDIT_PORT says; its example environment file says 3006. */
const app = express();

app.get('/events', (_req, res) => {
  res.json([]);
});

app.listen(process.env.AUDIT_PORT);
