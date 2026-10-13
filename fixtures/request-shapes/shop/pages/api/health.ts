import type { NextApiRequest, NextApiResponse } from 'next';

interface Health {
  ok: boolean;
  version: string;
}

/** The older router: Express's handler again, its answer held to `Health`. */
export default function handler(req: NextApiRequest, res: NextApiResponse<Health>) {
  res.status(200).json({ ok: true, version: '1' });
}
