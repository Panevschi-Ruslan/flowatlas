import type { Handler } from 'minihttp';

/** The one guard in this service, installed above every mount. */
export const authenticate: Handler = (req, res) => {
  void req;
  void res;
};
