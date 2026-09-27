import type { Request, Response } from 'express';

/** Named, so each route has code to point at and the fixture proves the edge too. */
export const listVideos = (_req: Request, res: Response): void => {
  res.json([{ id: 'video-1' }]);
};

export const getVideo = (req: Request, res: Response): void => {
  res.json({ id: req.params.id });
};
