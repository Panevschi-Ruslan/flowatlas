import type { DeliveryTarget } from '@flowatlas/core';
import type { Instance } from '../eval/values.js';
import { argument, siteOf, textOf, unreadRow, whyNot } from './arguments.js';
import { integrationOfRoute, integrationType, resourceIntegration, sentBy } from './integrations.js';
import type { ResourceReader } from './reading.js';

/**
 * WebSocket APIs (R174).
 *
 * A WebSocket API has no paths and no verbs: a client holds a connection open,
 * and each message on it goes to the route its selection expression picks -
 * `$connect` and `$disconnect` as the connection opens and closes, a value read
 * out of the message such as `sendMessage`, and `$default` for the rest. Each
 * route is therefore a way in of its own, delivered to whatever its integration
 * invokes or sends to, and is read as a delivery from the API's connections, the
 * way a schedule is a delivery from a clock.
 */

/** The API a route belongs to, when it is a WebSocket API. */
const socketApiOf = (route: Instance): Instance | undefined => {
  const value = argument(route, 'api_id');
  const api = value?.kind === 'ref' ? value.target : undefined;
  return api !== undefined && textOf(argument(api, 'protocol_type')) === 'WEBSOCKET' ? api : undefined;
};

const readSocketRoute: ResourceReader[1] = (route, reading) => {
  const api = socketApiOf(route);
  if (api === undefined) return;
  const keyValue = argument(route, 'route_key');
  const key = textOf(keyValue);
  if (key === undefined) {
    reading.rows.push(unreadRow(route, 'route-path-unread', `the route key of ${route.address}`, whyNot(keyValue, 'route_key')));
    return;
  }
  const name = textOf(argument(api, 'name')) ?? api.address;
  const declared = integrationOfRoute(route);
  const integration = declared === undefined ? undefined : resourceIntegration(declared, 'http');
  const type = integration === undefined ? undefined : integrationType(integration);
  const found =
    integration === undefined
      ? undefined
      : (sentBy(integration, reading) ?? (type === 'AWS_PROXY' || type === 'AWS' ? reading.invoked(integration) : undefined));
  let to: DeliveryTarget | undefined;
  if (found !== undefined && 'reason' in found) {
    reading.rows.push(unreadRow(route, 'route-target-unread', `what answers ${key} on ${name}`, found));
  } else if (found !== undefined) {
    to = 'sends' in found ? found.sends : 'function' in found ? { kind: 'function', function: found.function } : { kind: 'function', name: found.name };
  }
  const authorization = textOf(argument(route, 'authorization_type'));
  const meta = {
    ...(integration === undefined ? { integration: 'none' } : {}),
    ...(authorization === undefined || authorization === 'NONE' ? {} : { authorization }),
  };
  reading.deliveries.push({
    ...siteOf(route),
    address: route.address,
    by: 'route',
    name: key,
    from: { kind: 'connection', api: name, route: key },
    ...(to === undefined ? {} : { to }),
    ...(Object.keys(meta).length === 0 ? {} : { meta }),
  });
};

export const SOCKET_READERS: readonly ResourceReader[] = [['aws_apigatewayv2_route', readSocketRoute]];
