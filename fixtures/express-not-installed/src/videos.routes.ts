import express from 'express';

import { getVideo, listVideos } from './videos.controller';

/** `express.Router()`: a member of the default import, read as that export. */
export const videosRouter = express.Router();

videosRouter.get('/videos', listVideos);
videosRouter.get('/videos/:id', getVideo);
