import express from 'express';

import { videosRouter } from './controllers/videos';

const app = express();

app.use('/api/v1/videos', videosRouter);

app.listen(9101);
