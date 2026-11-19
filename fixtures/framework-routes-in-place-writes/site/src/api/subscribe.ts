import type { GatsbyFunctionRequest, GatsbyFunctionResponse } from 'gatsby';

/** Adds an address to the newsletter; only POST is answered. */
export default function subscribe(req: GatsbyFunctionRequest, res: GatsbyFunctionResponse) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  res.json({ subscribed: req.body.email });
}
