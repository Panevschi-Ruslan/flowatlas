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
        events.push({ name, publisher: { service: service.name, className: `${resource.className}Service`, method: verb }, consumers });
      }
    }
  }
  // The event nobody handles: the last one published loses its handlers.
  const unheard = events[events.length - 1];
  unheard.consumers = [];
  unheard.unheard = true;

  return { seed, resources, services, routes, calls, events, constants, methods, fields, traps: { helper: helperProxy.clientFile, settings: settingsProxy.clientFile, renamed: renamed.route.id, unheard: unheard.name } };
};
