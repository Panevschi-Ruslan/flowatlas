import type { Response } from 'express';

/** The project's own way of answering a request that succeeded. */
export const sendOk = (res: Response, body: unknown): void => {
  res.status(200).json(body);
};
