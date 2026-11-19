import OrdersGateway from '../../gateways/orders.gateway';
import { withAudit, type ApiHandler } from '../../lib/with-audit';

/** The orders way in: what it does is behind the gateway's object, and the wrapper runs in front of it. */
const handler: ApiHandler = async ({ method, url }, response) => {
  switch (method) {
    case 'GET': {
      response.status(200).json({ ids: await OrdersGateway.list(), latest: await OrdersGateway.latest() });
      return;
    }
    case 'DELETE': {
      await OrdersGateway.remove(url ?? '');
      response.status(204).json(null);
      return;
    }
    default:
      response.status(405).json(null);
  }
};

export default withAudit(handler);
