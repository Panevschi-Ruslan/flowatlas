import { withMetrics } from 'metrics-kit';
import type { ApiRequest, ApiResponse } from '../../lib/api-types';

const listReviews = async (request: ApiRequest, response: ApiResponse) => {
  if (request.method === 'GET') return response.status(200).json([]);
  return response.status(405).send('');
};

// A wrapper from a package nobody installed: whether it runs the handler is not
// read, so the way in lands on the handler as a guess and says which wrapper.
export default withMetrics(listReviews);
