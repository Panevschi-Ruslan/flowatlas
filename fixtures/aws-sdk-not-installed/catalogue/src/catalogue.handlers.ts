import type { Request, Response } from 'express';
import { SQSClient } from '@aws-sdk/client-sqs';
import { announceWithdrawal, CatalogueEvents, queueForShelving, type CatalogueItem } from './catalogue-events';

const events = new CatalogueEvents();
const sqs = new SQSClient({ region: 'eu-west-1' });

/**
 * A `send` of this repository's own, on a class it declares. The checker reads
 * this one whether or not anything is installed, so it is never mistaken for a
 * client's.
 */
class Mailer {
  send(message: { to: string; body: string }): Promise<void> {
    return Promise.resolve(void message);
  }
}

const mailer = new Mailer();

export const catalogueItem = async (req: Request, res: Response): Promise<unknown> => {
  const item = req.body as CatalogueItem;
  await events.catalogued(item);
  await queueForShelving(sqs, item);
  await mailer.send({ to: 'cataloguers@library.example', body: item.title });
  return res.status(201).json(item);
};

export const withdrawItem = async (req: Request, res: Response): Promise<unknown> => {
  await announceWithdrawal(req.params['itemId'] as string);
  return res.status(204).send();
};
