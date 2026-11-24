/**
 * The project the benchmark asks about, as a model (P238).
 *
 * Everything the generator writes and everything the key says comes from this
 * model and from nothing else: the key is what the generator meant, never what
 * a reader found. Built from a seed, so one seed is one project and one key on
 * every machine.
 *
 * The shape is a small shop split the way shops are: a gateway in front, three
 * NestJS services behind it, an Express service and a Lambda service on
 * Terraform, a React storefront and an Angular back office, and a package of
 * shared types. The traps are the places a reader of code goes wrong:
 *
 * - routes nothing calls (most services keep a few);
 * - an event that is published and has no handler;
 * - a call made through a helper function rather than the HTTP client itself;
 * - a base address read from a settings object instead of the environment;
 * - a field renamed across a boundary: the caller sends one name, the
 *   handler reads another.
 *
 * Beside them, the defects the find-the-bug questions plant (P392), each
 * with a safe twin that looks like it and is not one (`plantDefects`): they
 * are added after everything above is drawn, from no random draw, so a seed
 * gives the same project as before with these pieces beside it, and every
 * earlier question the same subject and the same answer.
 */

/** A small fast generator, so a seed is a project (mulberry32). */
export const random = (seed) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low, high) => low + Math.floor(next() * (high - low + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    /** `count` distinct items, in the order drawn. */
    some: (items, count) => {
      const pool = [...items];
      const out = [];
      while (out.length < count && pool.length > 0) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
      return out;
    },
  };
};

/** The services behind the gateway, the resources each may hold, and the framework it is written in. */
const BACKENDS = [
  { name: 'catalog', kind: 'nestjs', env: 'CATALOG_URL', resources: ['products', 'categories', 'brands', 'prices', 'reviews', 'images', 'collections', 'attributes', 'bundles', 'tags'] },
  { name: 'orders', kind: 'nestjs', env: 'ORDERS_URL', resources: ['orders', 'carts', 'returns', 'coupons', 'wishlists', 'checkouts', 'gifts', 'subscriptions', 'quotes', 'notes'] },
  { name: 'shipping', kind: 'nestjs', env: 'SHIPPING_URL', resources: ['shipments', 'carriers', 'parcels', 'labels', 'depots', 'zones', 'pickups', 'rates', 'manifests', 'slots'] },
  { name: 'billing', kind: 'express', env: 'BILLING_URL', resources: ['invoices', 'payments', 'refunds', 'taxes', 'ledgers', 'receipts', 'payouts', 'disputes', 'credits', 'statements'] },
  { name: 'notify', kind: 'lambda', env: 'NOTIFY_URL', resources: ['emails', 'texts', 'pushes', 'digests', 'alerts', 'webhooks', 'reminders', 'broadcasts', 'surveys', 'letters'] },
];

/** What a resource's own routes are: the ordinary five, and one action. */
const ACTIONS = ['archive', 'approve', 'publish', 'lock', 'restore', 'verify', 'export', 'merge'];

/** `products` -> `Products`, `product`. */
export const pascal = (name) => name.replace(/(^|[-_])(\w)/g, (_, __, letter) => letter.toUpperCase());
export const singular = (name) => (name.endsWith('ies') ? `${name.slice(0, -3)}y` : name.endsWith('ses') ? name.slice(0, -2) : name.replace(/s$/, ''));

/** A route's id in the key: the service, the method, and the path with every parameter as `:`. */
export const routeKey = (method, path) => `${method.toUpperCase()} ${path.replace(/[:{][A-Za-z]+}?/g, ':')}`;

/**
 * The model of one project.
 *
 * `resources` is how many each backend holds, which is what sizes the
 * project: the default of 10, every name a backend has, writes about fifteen
 * thousand lines.
 */
export const buildModel = ({ seed = 1, resources = 10 } = {}) => {
  const rng = random(seed);
  const services = [];
  const routes = [];
  const calls = [];
  const events = [];
  const constants = [];
  const methods = [];
  const fields = [];

  // The backends and their routes.
  for (const backend of BACKENDS) {
    const held = rng.some(backend.resources, resources);
    const service = { ...backend, repo: backend.name, resources: [] };
    services.push(service);
    for (const resource of held) {
      const one = singular(resource);
      const action = rng.pick(ACTIONS);
      const own = {
        name: resource,
        one,
        className: `${pascal(backend.name)}${pascal(resource)}`,
        action,
        routes: [],
        retries: rng.chance(0.4),
      };
      service.resources.push(own);
      const shapes = [
        { method: 'GET', path: `/${resource}`, verb: 'list', writes: false },
        { method: 'GET', path: `/${resource}/:id`, verb: 'findOne', writes: false },
        { method: 'POST', path: `/${resource}`, verb: 'create', writes: true },
        { method: 'PATCH', path: `/${resource}/:id`, verb: 'update', writes: true },
        { method: 'DELETE', path: `/${resource}/:id`, verb: 'remove', writes: true },
        { method: 'POST', path: `/${resource}/:id/${action}`, verb: action, writes: rng.chance(0.5) },
      ];
      for (const shape of shapes) {
        const route = {
          id: `${backend.name}:${routeKey(shape.method, shape.path)}`,
          service: backend.name,
          method: shape.method,
          path: shape.path,
          // The file that declares it: what a rename of the route changes on the serving side (P392).
          file: backend.kind === 'nestjs' ? `src/${resource}/${resource}.controller.ts` : backend.kind === 'express' ? `src/${resource}/${resource}.routes.ts` : 'infra/api.tf',
          resource,
          verb: shape.verb,
          handler: `${own.className}${backend.kind === 'nestjs' ? 'Controller' : 'Routes'}.${shape.verb}`,
          writes: shape.writes,
          callers: [],
        };
        own.routes.push(route);
        routes.push(route);
      }
      // What the resource's service does with its store, method by method.
      for (const shape of shapes) {
        methods.push({ service: backend.name, className: `${own.className}Service`, method: shape.verb, writes: shape.writes, retries: own.retries && shape.writes });
      }
      constants.push({ service: backend.name, resource, name: `${one.toUpperCase()}_PAGE_SIZE`, value: rng.int(11, 97) });
    }
  }
  const backend = (name) => services.find((service) => service.name === name);

  // The gateway: proxies a share of every backend's routes, each through a
  // client class of its own. One client goes through a helper function, one
  // reads its base address from a settings object.
  const gateway = { name: 'gateway', kind: 'nestjs', repo: 'gateway', resources: [], proxies: [] };
  services.unshift(gateway);
  const proxied = [];
  for (const service of services.filter((each) => each.env !== undefined && each.name !== 'notify')) {
    for (const resource of service.resources) {
      const kept = resource.routes.filter((route) => rng.chance(0.6));
      if (kept.length === 0) continue;
      const clientClass = `Gateway${pascal(service.name)}${pascal(resource.name)}Client`;
      const controllerClass = `Gateway${pascal(service.name)}${pascal(resource.name)}Controller`;
      const proxy = {
        service: service.name,
        resource: resource.name,
        clientClass,
        controllerClass,
        clientFile: `src/clients/${service.name}-${resource.name}.client.ts`,
        controllerFile: `src/${service.name}/${service.name}-${resource.name}.controller.ts`,
        via: 'baseUrlEnv',
        routes: [],
      };
      for (const route of kept) {
        const gatewayRoute = {
          id: `gateway:${routeKey(route.method, `/api/${service.name}${route.path}`)}`,
          service: 'gateway',
          method: route.method,
          path: `/api/${service.name}${route.path}`,
          file: proxy.controllerFile,
          resource: resource.name,
          verb: route.verb,
          handler: `${controllerClass}.${route.verb}`,
          writes: false,
          callers: [],
          backend: route.id,
        };
        routes.push(gatewayRoute);
        proxy.routes.push({ route, gatewayRoute });
        const symbol = `${clientClass}.${route.verb}`;
        route.callers.push({ service: 'gateway', file: proxy.clientFile, symbol });
        calls.push({ from: { service: 'gateway', file: proxy.clientFile, symbol }, to: route.id, via: 'baseUrlEnv' });
      }
      gateway.proxies.push(proxy);
      proxied.push(proxy);
    }
  }
  // The two traps on the way out of the gateway.
  const helperProxy = rng.pick(proxied.filter((proxy) => proxy.service !== 'billing'));
  helperProxy.via = 'helper';
  const settingsProxy = rng.pick(proxied.filter((proxy) => proxy !== helperProxy && proxy.service !== helperProxy.service));
  settingsProxy.via = 'settings';
  for (const proxy of [helperProxy, settingsProxy]) {
    for (const call of calls) if (call.from.file === proxy.clientFile) call.via = proxy.via;
  }

  // The renamed field: one proxied create sends `qty`, its handler reads `quantity`.
  const creates = proxied.flatMap((proxy) => proxy.routes.filter((pair) => pair.route.verb === 'create' && proxy.service !== 'billing').map((pair) => ({ proxy, ...pair })));
  const renamed = rng.pick(creates);
  for (const pair of creates) {
    fields.push({
      route: pair.route.id,
      caller: `${pair.proxy.clientClass}.create`,
      sent: pair === renamed ? ['name', 'qty'] : ['name', 'quantity'],
      read: ['name', 'quantity'],
    });
  }

  // Calls between backends: orders bills through billing, shipping tells
  // notify, with the base address from the environment.
  const between = [
    { from: 'orders', to: 'billing' },
    { from: 'shipping', to: 'notify' },
    { from: 'orders', to: 'notify' },
  ];
  for (const link of between) {
    const source = backend(link.from);
    const target = backend(link.to);
    const resource = rng.pick(source.resources);
    const targetResource = rng.pick(target.resources);
    const route = rng.pick(targetResource.routes.filter((each) => each.method === 'POST'));
    const clientClass = `${pascal(link.from)}${pascal(link.to)}Client`;
    const symbol = `${clientClass}.${route.verb}${pascal(targetResource.one)}`;
    const file = `src/clients/${link.to}.client.ts`;
    route.callers.push({ service: link.from, file, symbol });
    calls.push({ from: { service: link.from, file, symbol }, to: route.id, via: 'baseUrlEnv', resource: resource.name });
    (source.outbound ??= []).push({ to: link.to, clientClass, file, route, symbol, resource: resource.name });
  }

  // The browsers: the storefront and the back office each call a share of
  // the gateway's routes, from a component each.
  const gatewayRoutes = routes.filter((route) => route.service === 'gateway');
  const browsers = [
    { name: 'web', kind: 'react', repo: 'web', share: 0.45, key: 'VITE_API_URL' },
    { name: 'admin', kind: 'angular', repo: 'admin', share: 0.4, key: 'apiUrl' },
  ];
  for (const browser of browsers) {
    const service = { ...browser, screens: [] };
    services.push(service);
    const byResource = new Map();
    for (const route of gatewayRoutes) {
      if (!rng.chance(browser.share)) continue;
      const key = `${route.path.split('/')[2]}-${route.resource}`;
      byResource.set(key, [...(byResource.get(key) ?? []), route]);
    }
    for (const [key, used] of byResource) {
      const base = pascal(key);
      const screen =
        browser.kind === 'react'
          ? { component: `${base}Panel`, file: `src/${key}/${base}Panel.tsx`, api: `src/${key}/${key}.api.ts`, routes: used }
          : { component: `${base}Component`, file: `src/app/${key}/${key}.component.ts`, api: `src/app/${key}/${key}-api.service.ts`, apiClass: `${base}ApiService`, routes: used };
      service.screens.push(screen);
      for (const route of used) {
        const symbol = browser.kind === 'react' ? `${route.verb}${base}` : `${base}ApiService.${route.verb}`;
        route.callers.push({ service: browser.name, file: screen.api, symbol, screen: screen.file });
        calls.push({ from: { service: browser.name, file: screen.api, symbol, screen: screen.file }, to: route.id, via: 'apiTarget' });
      }
    }
  }

  // Events: a share of the NestJS backends' writes publish one; each has up
  // to two handlers in the other NestJS backends, and one has none at all.
  const nest = services.filter((service) => service.kind === 'nestjs' && service.name !== 'gateway');
  for (const service of nest) {
    for (const resource of service.resources) {
      for (const verb of ['create', 'update']) {
        if (!rng.chance(0.45)) continue;
        const name = `${resource.one}.${verb === 'create' ? 'created' : 'updated'}`;
        if (events.some((event) => event.name === name)) continue;
        const others = nest.filter((each) => each !== service);
        const count = rng.int(1, 2);
        const consumers = rng.some(others, count).map((other) => ({
          service: other.name,
          className: `${pascal(other.name)}${pascal(resource.one)}Events`,
          file: `src/events/${resource.one}.events.ts`,
          method: `on${pascal(resource.one)}${verb === 'create' ? 'Created' : 'Updated'}`,
        }));
        events.push({ name, publisher: { service: service.name, className: `${resource.className}Service`, method: verb, file: `src/${resource.name}/${resource.name}.service.ts` }, consumers });
      }
    }
  }
  // The event nobody handles: the last one published loses its handlers.
  const unheard = events[events.length - 1];
  unheard.consumers = [];
  unheard.unheard = true;

  const model = { seed, resources, services, routes, calls, events, constants, methods, fields, traps: { helper: helperProxy.clientFile, settings: settingsProxy.clientFile, renamed: renamed.route.id, unheard: unheard.name } };
  plantDefects(model);
  return model;
};

/**
 * The defects the find-the-bug questions ask about (P392), each beside a twin
 * that looks like it and is right, so an answer that lists everything that
 * looks odd is marked down for the twins: a score is true positives minus
 * false positives. Written into the model, the generator writes their code
 * from `model.planted` and the key says what is a defect and what a twin.
 *
 * - orders' support tickets (`tickets`): the route that closed one was
 *   renamed `resolve` on the server and the gateway still posts to `close`
 *   (the twin, `reopen`, matches); a literal `GET /tickets/overdue` declared
 *   after `GET /tickets/:id`, which answers its requests first (the twin,
 *   `GET /tickets/summary`, is declared before it); and resolving publishes
 *   `ticket.resolved` where shipping still listens for `ticket.closed` (the
 *   twin, `ticket.reopened`, is heard).
 * - shipping's claims: the gateway sends a claim's reason as `cause`, read as
 *   `reason` (the twin, a note's `text`, matches); and `DELETE /claims/:id`
 *   is the one write of its controller without the guard its siblings carry
 *   (the twins: `GET /claims`, a read left open, and the delete of a
 *   controller guarded as a whole).
 * - billing reads `LEDGER_REGION` with no default, and its deployment sets
 *   `LEDGER_ZONE` (the twin, `PAYMENT_PROVIDER`, is set).
 *
 * Every route here is marked `planted`, so the earlier questions pick their
 * subjects from the routes they always had.
 */
export const plantDefects = (model) => {
  const route = (service, method, path, handler, file, callers = []) => {
    const made = { id: `${service}:${routeKey(method, path)}`, service, method, path, file, resource: path.split('/')[1], verb: handler.split('.')[1], handler, writes: method !== 'GET', callers, planted: true };
    model.routes.push(made);
    return made;
  };
  const ticketsClient = { service: 'gateway', file: 'src/clients/orders-tickets.client.ts' };
  const claimsClient = { service: 'gateway', file: 'src/clients/shipping-claims.client.ts' };
  const caller = (client, symbol) => ({ ...client, symbol });
  // orders: the tickets controller, in its declaration order.
  const tickets = 'src/tickets/tickets.controller.ts';
  route('orders', 'GET', '/tickets', 'OrdersTicketsController.list', tickets);
  route('orders', 'GET', '/tickets/summary', 'OrdersTicketsController.summary', tickets, [caller(ticketsClient, 'GatewayOrdersTicketsClient.summary')]);
  // The literal declared after `:id` is never reached: its request lands on findOne.
  route('orders', 'GET', '/tickets/:id', 'OrdersTicketsController.findOne', tickets, [caller(ticketsClient, 'GatewayOrdersTicketsClient.overdue')]);
  route('orders', 'GET', '/tickets/overdue', 'OrdersTicketsController.overdue', tickets);
  route('orders', 'POST', '/tickets/:id/resolve', 'OrdersTicketsController.resolve', tickets);
  route('orders', 'POST', '/tickets/:id/reopen', 'OrdersTicketsController.reopen', tickets, [caller(ticketsClient, 'GatewayOrdersTicketsClient.reopen')]);
  // The gateway's own routes in front of them, which no screen calls.
  const ticketsFront = 'src/orders/orders-tickets.controller.ts';
  route('gateway', 'GET', '/api/orders/tickets/summary', 'GatewayOrdersTicketsController.summary', ticketsFront);
  route('gateway', 'GET', '/api/orders/tickets/overdue', 'GatewayOrdersTicketsController.overdue', ticketsFront);
  route('gateway', 'POST', '/api/orders/tickets/:id/close', 'GatewayOrdersTicketsController.close', ticketsFront);
  route('gateway', 'POST', '/api/orders/tickets/:id/reopen', 'GatewayOrdersTicketsController.reopen', ticketsFront);
  // shipping: the claims, one write left unguarded, and the refunds, guarded as a whole.
  const claims = 'src/claims/claims.controller.ts';
  route('shipping', 'GET', '/claims', 'ShippingClaimsController.list', claims);
  route('shipping', 'POST', '/claims', 'ShippingClaimsController.create', claims, [caller(claimsClient, 'GatewayShippingClaimsClient.create')]);
  route('shipping', 'POST', '/claims/:id/notes', 'ShippingClaimsController.addNote', claims, [caller(claimsClient, 'GatewayShippingClaimsClient.addNote')]);
  route('shipping', 'DELETE', '/claims/:id', 'ShippingClaimsController.remove', claims);
  const refunds = 'src/claims/claim-refunds.controller.ts';
  route('shipping', 'POST', '/claim-refunds', 'ShippingClaimRefundsController.create', refunds);
  route('shipping', 'DELETE', '/claim-refunds/:id', 'ShippingClaimRefundsController.remove', refunds);
  const claimsFront = 'src/shipping/shipping-claims.controller.ts';
  route('gateway', 'POST', '/api/shipping/claims', 'GatewayShippingClaimsController.create', claimsFront);
  route('gateway', 'POST', '/api/shipping/claims/:id/notes', 'GatewayShippingClaimsController.addNote', claimsFront);
  // The events: resolved is published and heard by no one; reopened is heard.
  const publisher = (method) => ({ service: 'orders', className: 'OrdersTicketsService', method, file: 'src/tickets/tickets.service.ts' });
  const handler = (method) => ({ service: 'shipping', className: 'ShippingTicketEvents', file: 'src/events/ticket.events.ts', method });
  model.events.push({ name: 'ticket.resolved', publisher: publisher('resolve'), consumers: [], planted: true });
  model.events.push({ name: 'ticket.reopened', publisher: publisher('reopen'), consumers: [handler('onTicketReopened')], planted: true });
  const renamedCaller = model.fields.find((field) => field.route === model.traps.renamed).caller;
  model.planted = {
    tickets: { client: ticketsClient.file, front: ticketsFront },
    claims: { client: claimsClient.file, front: claimsFront },
    staleHandler: { ...handler('onTicketClosed'), event: 'ticket.closed' },
    settings: { service: 'billing', read: ['LEDGER_REGION', 'PAYMENT_PROVIDER'], set: ['PAYMENT_PROVIDER', 'LEDGER_ZONE'] },
  };
  // What each find-the-bug question expects, and the twins an answer is marked down for. `context`: what an
  // answer needs to see, the repository the question is asked from or the repositories across a boundary.
  model.defects = [
    { id: 'renamed-route', context: 'across', from: 'gateway', scorer: 'symbols', expected: ['GatewayOrdersTicketsClient.close'], decoys: ['GatewayOrdersTicketsClient.reopen', 'GatewayOrdersTicketsClient.summary'] },
    // The gateway's own renamed field (the contract trap) is one too: an answer is right with both.
    { id: 'renamed-field', context: 'across', from: 'gateway', scorer: 'symbols', expected: ['GatewayShippingClaimsClient.create', renamedCaller].sort(), decoys: ['GatewayShippingClaimsClient.addNote'] },
    { id: 'renamed-message', context: 'across', from: 'shipping', scorer: 'symbols', expected: ['ShippingTicketEvents.onTicketClosed'], decoys: ['ShippingTicketEvents.onTicketReopened'] },
    { id: 'shadowed-route', context: 'repository', from: 'orders', service: 'orders', scorer: 'routes', expected: ['GET /tickets/overdue'], decoys: ['GET /tickets/summary'] },
    { id: 'env-renamed', context: 'repository', from: 'billing', service: 'billing', scorer: 'names', expected: ['LEDGER_REGION'], decoys: ['PAYMENT_PROVIDER'] },
    { id: 'unguarded-write', context: 'repository', from: 'shipping', service: 'shipping', scorer: 'routes', expected: ['DELETE /claims/:id'], decoys: ['DELETE /claim-refunds/:id', 'GET /claims'] },
  ];
};
