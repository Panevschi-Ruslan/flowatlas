import type { GatsbyFunctionRequest, GatsbyFunctionResponse } from 'gatsby';

export default function user(req: GatsbyFunctionRequest, res: GatsbyFunctionResponse) {
  res.json({ id: req.params.id });
}
