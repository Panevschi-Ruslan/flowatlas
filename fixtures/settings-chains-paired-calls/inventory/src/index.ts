import express from 'express';

const app = express();

app.get('/api/listings', (_req, res) => {
  res.json([]);
});

// Only the code says where it listens: no compose file, no PORT in an env file.
app.listen(4300);
