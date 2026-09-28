import { Router, type NextFunction, type Request, type Response } from 'express';

import { countRates, loadVideo, saveVideo } from '../lib/videos';
import { asyncMiddleware, asyncRetryTransactionMiddleware } from '../middlewares/async';

/**
 * The four shapes a video platform writes a route in, one registration each.
 *
 * Every handler is declared below the registrations, as a function declaration,
 * because that is where a video platform's controllers keep them: the router at the top
 * of the file reads as a table of contents.
 */
export const videosRouter = Router();

const authenticate = (_req: Request, _res: Response, next: NextFunction): void => next();

// A named handler handed to a wrapper, behind middleware that is wrapped too.
// Two hundred and twenty-four of a video platform's registrations are this one.
videosRouter.get('/:id', authenticate, asyncMiddleware(videosGetValidator), asyncMiddleware(getVideo));

// The same through the other wrapper; sixty-seven of them.
videosRouter.post('/', asyncRetryTransactionMiddleware(addVideo));

// A handler a factory builds from a value, handed to the wrapper; six of them.
videosRouter.get('/:id/likes', asyncMiddleware(getRateFactory('like')));

// A factory handed a function, inside the wrapper; eight of them. The function
// written in place picks an owner and answers nothing, and from the call alone
// the factory cannot be told from a second wrapper, so nothing is pointed at.
videosRouter.get('/:id/lists', asyncMiddleware(listFactory((req) => req.params['id'] as string)));

// A list handed to the wrapper, which runs each in turn: no one function is the
// answer, so nothing is pointed at.
videosRouter.post('/batch', asyncMiddleware([checkBatch, runBatch]));

// The ordinary form, beside the others, unchanged.
videosRouter.get('/:id/plain', getVideo);

async function videosGetValidator(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (req.params['id'] === undefined) throw new Error('no id');
  next();
}

async function getVideo(req: Request, res: Response): Promise<unknown> {
  const video = await loadVideo(req.params['id'] as string);
  return res.json(video);
}

async function addVideo(req: Request<unknown, unknown, { name: string }>, res: Response): Promise<unknown> {
  const video = await saveVideo(req.body.name);
  return res.status(201).json(video);
}

function getRateFactory(kind: 'like' | 'dislike') {
  return async (req: Request, res: Response): Promise<unknown> => {
    const total = await countRates(req.params['id'] as string, kind);
    return res.json({ total });
  };
}

function listFactory(ownerOf: (req: Request) => string) {
  return async (req: Request, res: Response): Promise<unknown> => {
    const total = await countRates(ownerOf(req), 'list');
    return res.json({ total });
  };
}

async function checkBatch(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  next();
}

async function runBatch(_req: Request, res: Response): Promise<unknown> {
  return res.status(204).send();
}
