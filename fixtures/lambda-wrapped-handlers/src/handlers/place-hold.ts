import { instrument } from '@lending/telemetry';
import middy from '@middy/core';
import jsonBodyParser from '@middy/http-json-body-parser';
import { addHold } from '../lib/desk-table';

interface HoldEvent {
  body: { isbn: string; borrowerId: string };
}

async function placeHold(event: HoldEvent): Promise<{ position: number }> {
  return { position: await addHold(event.body.isbn, event.body.borrowerId) };
}

// The function, then options, from a package that is not installed, through a
// const the middleware chain is built on.
const placeHoldMeasured = instrument(placeHold, { segment: 'holds' });

export const handler = middy(placeHoldMeasured).use(jsonBodyParser());
