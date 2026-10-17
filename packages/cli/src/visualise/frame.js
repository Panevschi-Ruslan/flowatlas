/*
 * The graph view's frame: what a link names, what two fingers mean, and what
 * size a picture of the drawing is.
 *
 * Pure functions, like graph.js beside it, written into the same module script
 * by the command and imported as they are by a test:
 *   createKeys    a node's stable key and back, from what the pack ships
 *   parseHash, formatHash   the view in the address - the focus, the hops,
 *                 what is expanded, a question asked, what the filters hide
 *                 and whose "who else" is drawn - old links included
 *   VIEWS, parseViewHash, formatViewHash   the page's tabs, and the address
 *                 of any of them that is not the graph's or the map's
 *   pinch         a two-finger move as a pan and a zoom
 *   drawerWidth   how wide the details panel may be dragged
 *   pictureScale, pictureName   what an export is drawn at and called
 *   PAGE_WORDS, wordFor   the words the page says for a reason, an edge's
 *                 type and its trust, the code kept for the tooltip
 *   SHORTCUTS, pressed   every key the page answers, which the handlers and
 *                 the `?` overlay both read
 *   wheelIntent   what a wheel over a drawing does: scroll the page, pan, zoom
 *   contrastOf    how far apart two colours read, as WCAG counts it
 */

/** Hops a view may ask for. More than three is most of any graph. */
export const HOPS = Object.freeze([1, 2, 3]);

/**
 * Keys by node and nodes by key, from the pack's `keys`.
 *
 * Nodes whose short key is shared answer to their longer keys only; the short
 * one they share opens neither, and `shared` names both, so a link made before
 * the second arrived can offer the two rather than pick one. A page packed
 * before keys existed names nodes by position.
 */
export const createKeys = (packed, size) => {
  if (!packed) {
    return {
      size,
      keyOf: (i) => String(i),
      find: (key) => (/^\d+$/.test(key) && Number(key) < size ? Number(key) : -1),
      shared: () => [],
    };
  }
  const { width, all, longer } = packed;
  const keyOf = (i) => longer[i] ?? all.slice(i * width, (i + 1) * width);
  const byKey = new Map();
  const byShared = new Map();
  for (let i = 0; i < size; i += 1) {
    byKey.set(keyOf(i), i);
    if (longer[i] === undefined) continue;
    const short = all.slice(i * width, (i + 1) * width);
    byShared.set(short, [...(byShared.get(short) || []), i]);
  }
  return {
    size,
    keyOf,
    find: (key) => byKey.get(key) ?? -1,
    shared: (key) => byShared.get(key) || [],
  };
};

/** What a link may hide, by name, and the letter each is written under. */
const HIDDEN = Object.freeze({ s: 'services', e: 'edgeTypes', t: 'confidences' });

/**
 * A question a link asks of the view, as written in the address: `impact` on
 * the focus, `path.<to>.<depth>` from the focus (`.either` when edges are
 * walked either way), or `only`, the drawing cut to the nodes with problems.
 * The end of a path is a key like any node; one this page does not hold comes
 * back as `to: null` with the key, so the page can say so.
 */
const readAsk = (text, keys) => {
  if (!text) return null;
  const [kind, token, depthText, way] = text.split('.');
  if (kind === 'impact' || kind === 'only') return { kind };
  if (kind !== 'path' || !token || !/^\d+$/.test(depthText || '')) return null;
  const to = keys.find(token);
  return { kind, to: to >= 0 ? to : null, key: token, depth: Number(depthText), directed: way !== 'either' };
};

const writeAsk = (keys, ask) => {
  if (!ask) return '';
  if (ask.kind === 'path') return 'path.' + keys.keyOf(ask.to) + '.' + ask.depth + (ask.directed === false ? '.either' : '');
  return ask.kind;
};

/** `s:orders-api,e:calls,t:heuristic`: what the filters hide, by name, each name escaped. */
const readHidden = (text) => {
  if (text === undefined) return null;
  const hidden = { services: [], edgeTypes: [], confidences: [] };
  for (const item of text.split(',')) {
    const found = /^([set]):(.+)$/.exec(item);
    if (found === null) continue;
    try {
      hidden[HIDDEN[found[1]]].push(decodeURIComponent(found[2]));
    } catch {
      // A name the address mangled is a filter the page cannot apply.
    }
  }
  return hidden;
};

const writeHidden = (hidden) => {
  if (!hidden) return '';
  return Object.entries(HIDDEN)
    .flatMap(([letter, field]) => [...(hidden[field] || [])].sort().map((name) => letter + ':' + encodeURIComponent(name)))
    .join(',');
};

/** `a.b.c`: nodes by key, the ones this page does not hold dropped, each once. */
const readNodes = (text, keys, focus) => [
  ...new Set((text || '').split('.').filter(Boolean).map((key) => keys.find(key)).filter((v) => v >= 0 && v !== focus)),
];

/**
 * `#graph/<node>[/<hops>[/<expanded>.<expanded>…[/<ask>[/<hidden>[/<also>.<also>…]]]]]`,
 * or null for any other address.
 *
 * A node is its key, a letter and then letters and digits. A node written as a
 * number is a position, which is what links made before keys carried: it opens
 * whatever sits there in this page, and one past the end opens nothing. A key
 * this page does not have comes back as `focus: null` with the key, and with
 * the nodes now sharing it in `among` when it is a short key two of them spell,
 * so the page can say so rather than quietly show something else. Expanded
 * nodes the page does not have are dropped. An expanded node draws more of the
 * flow, the way it looks from the focus; a link made before that, when an
 * expansion drew both ways, opens the same keys as the flow.
 *
 * `ask` is the question on the view (`readAsk`), null when there is none, and
 * `hidden` what the filters hide by name, null when the link does not say, so
 * a link without them leaves the filters as the person has them. `also` are the
 * nodes whose "who else uses this" is drawn, as context; empty when the link
 * does not say, as every link made before it does not.
 */
export const parseHash = (hash, keys) => {
  const found = /^#graph\/([a-z0-9]+)(?:\/(\d+)(?:\/([a-z0-9.]*)(?:\/([a-z0-9.]*)(?:\/([^/]*)(?:\/([a-z0-9.]*))?)?)?)?)?$/
    .exec(hash);
  if (found === null) return null;
  const [, token, hopsText, expandedText, askText, hiddenText, alsoText] = found;
  const byPosition = /^\d+$/.test(token);
  const position = byPosition ? Number(token) : keys.find(token);
  const focus = position >= 0 && position < keys.size ? position : null;
  const hops = hopsText === undefined ? null : Number(hopsText);
  return {
    focus,
    key: token,
    byPosition,
    among: focus === null && !byPosition ? keys.shared(token) : [],
    hops: HOPS.includes(hops) ? hops : null,
    expanded: readNodes(expandedText, keys, focus),
    ask: readAsk(askText, keys),
    hidden: readHidden(hiddenText),
    also: readNodes(alsoText, keys, focus),
  };
};

/**
 * The address of a view. A view with no question, nothing hidden and no "who
 * else" is written as it always was; the segments after the expanded nodes
 * appear only when they, or one after them, say something.
 */
export const formatHash = (keys, focus, hops, expanded = [], more = {}) => {
  const segments = [keys.keyOf(focus), String(hops), expanded.map(keys.keyOf).join('.'), writeAsk(keys, more.ask),
    writeHidden(more.hidden), (more.also || []).map(keys.keyOf).join('.')];
  while (segments.length > 2 && segments[segments.length - 1] === '') segments.pop();
  return '#graph/' + segments.join('/');
};

/**
 * The page's tabs, by the name the address and the markup give them, in the
 * order they are drawn (P98). Every one opens from a link.
 */
export const VIEWS = Object.freeze(['map', 'steps', 'crossings', 'missing', 'busiest', 'changes', 'graph']);

/**
 * Tabs that went, by the tab that shows what they showed: a link made while
 * they were there still opens the same way in (P99 folded Walk into Steps).
 */
export const VIEWS_MOVED = Object.freeze({ walk: 'steps' });

/**
 * `#<view>[/<way in>][/<name>=<value>&…]`: a tab, the way in it opens on, and
 * where in it to go (`reason=<reason>` on Not joined), or null for an address
 * this grammar leaves to another: `#map…` is the map's (`parseMapHash`) and
 * `#graph/…` the graph's (`parseHash`); `#graph` alone is the Graph tab.
 *
 * The way in is a node's key, the one `#graph/` links carry; a key this page
 * does not hold comes back as `entry: null` with the key, so the page can say
 * so. A name that is no tab comes back as `view: null` with the name; one
 * that was a tab comes back as the tab that took it over (`VIEWS_MOVED`). A
 * segment holding `=` is never a key, since keys are letters and digits, so
 * the way in can be left out before it.
 */
export const parseViewHash = (hash, keys) => {
  const found = /^#([a-z][a-z-]*)((?:\/[^/]*)*)$/.exec(hash || '');
  if (found === null) return null;
  const [, name, tail] = found;
  if (name === 'map' || (name === 'graph' && tail !== '')) return null;
  const parts = tail.split('/').slice(1);
  const key = parts.length > 0 && !parts[0].includes('=') ? parts.shift() : '';
  const rest = {};
  for (const item of parts.join('/').split('&')) {
    const at = item.indexOf('=');
    if (at <= 0) continue;
    try {
      rest[item.slice(0, at)] = decodeURIComponent(item.slice(at + 1));
    } catch {
      // A value the address mangled is a place the page cannot go to.
    }
  }
  const at = /^[a-z0-9]+$/.test(key) ? keys.find(key) : -1;
  const view = VIEWS.includes(name) ? name
    : Object.prototype.hasOwnProperty.call(VIEWS_MOVED, name) ? VIEWS_MOVED[name] : null;
  return { view, name, entry: at >= 0 ? at : null, key, rest };
};

/** The address of a tab, with the way in it shows by key and where in it to go; empty parts are left out. */
export const formatViewHash = (view, key = null, rest = {}) => {
  const where = Object.entries(rest)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => name + '=' + encodeURIComponent(value))
    .join('&');
  return '#' + [view, key || '', where].filter(Boolean).join('/');
};

/**
 * Two fingers before and after a move, as `[{x, y}, {x, y}]` in the canvas's
 * own pixels: the point between them moves the drawing with it, and the spread
 * between them zooms about where that point now is. Fingers on one spot spread
 * nothing, and zoom nothing.
 */
export const pinch = (before, after) => {
  const middle = (p) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const spread = (p) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const from = middle(before);
  const to = middle(after);
  const was = spread(before);
  return {
    dx: to.x - from.x,
    dy: to.y - from.y,
    at: to,
    factor: was > 0 ? spread(after) / was : 1,
  };
};

/** The narrowest a details panel is useful at, and the least drawing it leaves. */
export const DRAWER = Object.freeze({ min: 260, max: 760, leave: 320 });

/** A width asked for by dragging, held between the narrowest and what leaves room to draw. */
export const drawerWidth = (wanted, room) =>
  Math.round(Math.max(DRAWER.min, Math.min(wanted, DRAWER.max, room - DRAWER.leave)));

/**
 * How many pixels a picture spends on one unit of the drawing: twice over for a
 * sharp screen, less when that would make a canvas larger than a browser will
 * draw on one side (eight thousand pixels is safe everywhere) or in all (forty
 * million).
 */
export const pictureScale = (width, height, wanted = 2) =>
  Math.min(wanted, 8192 / width, 8192 / height, Math.sqrt(40e6 / (width * height)));

/** `<project>-<node>.<ext>`, in letters, digits and dashes, so every system keeps it. */
export const pictureName = (project, label, ext) => {
  const part = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const name = [part(project), part(label).slice(0, 60)].filter(Boolean).join('-') || 'graph';
  return name + '.' + ext;
};

/* ── Plain words for the codes the page shows (P101) ── */

/**
 * What the page says for a code a reader would otherwise be handed raw: a
 * check row's reason, an edge's type as a verb, how far an edge is trusted,
 * and what a finding risks. The code stays wherever a machine reads it - the address, a prompt,
 * the MCP server - and in the tooltip of the word, so it can be found and
 * copied. One table, so the words can be reviewed together and cannot drift
 * from panel to panel.
 */
export const PAGE_WORDS = Object.freeze({
  reason: Object.freeze({
    'ambiguous-handler': 'two handlers for one route',
    'ambiguous-route': 'several routes answer the call',
    'ambiguous-route-api': 'several APIs serve the address',
    'ambiguous-route-application': 'several applications serve the address',
    'ambiguous-route-target': 'base setting names no one service',
    'api-base-override-unread': 'own base address not read',
    'api-base-unknown': 'base address setting unknown',
    'api-body-unread': 'API description not read',
    'api-client-unread': 'client class not followed',
    'api-method-dynamic': 'verb chosen at run time',
    'api-path-dynamic': 'address built at run time',
    'application-root-unread': 'application root not named',
    'base-url-from-files': 'base address taken from a file',
    'base-url-from-name': 'base address guessed from its name',
    'body-already-serialised': 'body sent already serialised',
    'bootstrap-not-found': 'bootstrap file not found',
    'bot-handlers-not-found': 'bot handlers not found',
    'bucket-notification-unread': 'bucket notification not read',
    'call-dynamic-receiver': 'call on an untyped receiver',
    'call-module-ref': 'resolved through the container',
    'call-through-token': 'call through a token not followed',
    'channel-const-unresolved': 'channel constant not read',
    'channel-dynamic': 'channel name built at run time',
    'channel-from-config': 'channel name read from settings',
    'channel-from-environment': 'channel from an environment variable',
    'channel-without-consumer': 'nothing consumes the channel',
    'channel-without-producer': 'nothing publishes to the channel',
    'consumer-handler-unresolved': 'listener does more than delegate',
    'db-call-at-module-level': 'query runs on import',
    'db-handover-unstated': 'data handover not typed',
    'db-layer-unread': 'data layer not recognised',
    'db-package-unread': 'data package not described',
    'db-receiver-name-only': 'data layer known by name only',
    'decorator-arg-dynamic': 'decorator argument computed',
    'delivered-onward': 'message handed onward',
    'delivery-target-unread': 'delivery target outside the project',
    'deployment-unread': 'no deployment description read',
    'di-token-ambiguous': 'token provided twice',
    'di-token-unknown': 'token nothing provides',
    'di-type-unresolved': 'injected type not resolved',
    'document-age': 'how old the document is',
    'duplicate-node-id': 'one id in two repositories',
    'dynamic-bot-trigger': 'bot trigger computed',
    'dynamic-cache-key': 'cache key built at run time',
    'dynamic-config-key': 'config key computed',
    'dynamic-http-url': 'request address built at run time',
    'dynamic-table-name': 'table name not written out',
    'entry-http-description-inactive': 'route description unused',
    'entry-http-routes-unmatched': 'route description matched no routes',
    'entry-http-routes-unplaced': 'some routes have no address',
    'entry-http-types-unmatched': 'route description matched no types',
    'entry-procedures-description-inactive': 'procedure description unused',
    'entry-registry-unconfigured': 'handler table not configured',
    'envelope-unread': 'message reshaped on the way',
    'environment-from-files': 'environment value taken from a file',
    'environment-not-set': 'environment variable not set',
    'environment-value-unread': 'environment value not read',
    'event-pattern-unread': 'event pattern not read',
    'failure-declared-unseen': 'declared failure never seen',
    'failure-seen-undeclared': 'status seen but not declared',
    'fails-filter-unread': 'exception filter status not read',
    'file-not-parsed': 'file could not be parsed',
    'function-handler-ambiguous': 'function handler ambiguous',
    'function-handler-not-found': 'function handler not found',
    'function-handler-unread': 'function handler not read',
    'function-image-unread': 'function is a container image',
    'function-name-disputed': 'function named two ways',
    'function-name-unread': 'function name not settled',
    'function-repeated-unread': 'repeated functions not settled',
    'function-runtime-unread': 'function runtime not read',
    'function-source-unread': 'function source not found',
    'global-wrapper-dynamic': 'global wrapper not read',
    'handler-not-a-method': 'binding is not a method',
    'handler-not-found': 'handler method not declared',
    'handler-unread': 'handler not read',
    'infra-file-unparsed': 'configuration file did not parse',
    'infra-module-description-invalid': 'module description invalid',
    'infra-module-missing': 'module directory missing',
    'infra-module-undescribed': 'outside module not described',
    'inject-token-unresolved': 'token is not a class',
    'invoke-target-ambiguous': 'two functions of one name',
    'invoke-target-not-found': 'invoked function not deployed here',
    'invoker-not-read': 'who runs the function not read',
    'iot-action-not-read': 'rule action not followed',
    'marker-reason-missing': 'public marker gives no reason',
    'marker-route-not-found': 'annotated route not found',
    'marker-service-unknown': 'annotated service not configured',
    'message-undeclared': 'message type not declared',
    'message-unparsed': 'message not parsed into a type',
    'middleware-matcher-unread': 'middleware matcher not read',
    'middleware-route-dynamic': 'middleware route computed',
    'module-controllers-unread': 'module controllers not read',
    'module-import-dynamic': 'module import computed',
    'module-providers-unread': 'module providers not read',
    'no-type-on-receiver': 'receiver has no type',
    'no-type-on-sender': 'sender has no type',
    'orphan-scene-decorator': 'scene step outside a scene',
    'orphan-update-decorator': 'bot handler outside an update class',
    'package-from-repo': 'package read from its source',
    'package-source-ambiguous': 'two sources for one package',
    'package-version-differs': 'package source is another version',
    'pattern-ambiguous': 'two pattern rules match the call',
    'pattern-file-unread': 'pattern file not read',
    'pattern-not-expressible': 'pattern rule cannot be read',
    'pattern-shadowed': 'pattern rule overruled by a description',
    'pattern-unmatched': 'pattern rule matches nothing',
    'payload-type-unknown': 'no payload on the channel',
    'procedure-ambiguous': 'procedure declared twice',
    'procedure-branch-unread': 'procedure branch not followed',
    'procedure-call-mismatch': 'procedure called the wrong way',
    'procedure-input-by-name': 'procedure input known by name',
    'procedure-key-dynamic': 'procedure key computed',
    'procedure-members-unmatched': 'procedure description matched nothing',
    'procedure-not-found': 'procedure not found',
    'procedure-output-inferred': 'procedure output inferred',
    'procedure-path-dynamic': 'procedure path computed',
    'procedure-router-unread': 'procedure tree not read',
    'procedure-trees-unmatched': 'no procedure tree found',
    'query-in-loop': 'query inside a loop',
    'reference-ambiguous': 'deployed name declared twice',
    'reference-not-found': 'deployed name not found',
    'registry-handler-anonymous': 'registered handler has no name',
    'registry-key-dynamic': 'registry key computed',
    'route-api-guessed': 'API guessed from the setting name',
    'route-base-path-unread': 'API base path not read',
    'route-checked-in-body': 'route checks access in its body',
    'route-claimed-twice': 'two files claim one route',
    'route-config-unread': 'route configuration not read',
    'route-file-not-served': 'route file not served',
    'route-guard-skipped': 'guard switched off',
    'route-handler-anonymous': 'route handler built at run time',
    'route-handler-unread': 'route handler not read',
    'route-link-dynamic': 'link built at run time',
    'route-loader-unread': 'route loader not read',
    'route-module-not-found': 'route module not found',
    'route-mount-assumed-empty': 'mount taken as empty',
    'route-mount-unread': 'mount path not read',
    'route-path-dynamic': 'route path computed',
    'route-path-unread': 'route path not settled',
    'route-public-declared': 'route public on purpose',
    'route-registry-unread': 'mounted applications not read',
    'route-root-ambiguous': 'API root placed twice',
    'route-root-not-found': 'API root not found',
    'route-screen-unread': 'screen behind the route not read',
    'route-shadowed': 'route answered before the application',
    'route-target-unread': 'route target not read',
    'route-target-unresolved': 'no route answers the link',
    'route-unguarded': 'no guard in front',
    'route-verb-unread': 'route file exports no verb',
    'route-wildcard-only': 'only a wildcard route answers',
    's3-write-matches-nothing': 'bucket write notifies nothing',
    'seen-not-in-code': 'seen at run time, not in code',
    'sender-forwards': 'message forwarded',
    'server-action-unread': 'server action not read',
    'service-binding-unknown': 'service binding unknown',
    'service-read-nothing': 'service read nothing',
    'shape-file-unmatched': 'shape file not used',
    'shape-file-unread': 'shape file not read',
    'sql-parse-failed': 'query text not written out',
    'start-from-environment': 'what it starts is an environment variable',
    'start-name-unread': 'what it starts not read',
    'starter-undescribed': 'starting helper not described',
    'stream-filter-not-matched': 'stream filter not evaluated',
    'stream-no-writer': 'nothing writes the stream',
    'subscription-forward-unread': 'forwarded events not named',
    'subscription-matches-nothing': 'rule matches nothing published',
    'subscription-source-unread': 'subscription source not read',
    'subscription-target-unread': 'subscription target not read',
    'target-route-not-found': 'route not found on the target',
    'template-not-found': 'template not found',
    'template-not-parsed': 'template did not parse',
    'test-directory-skipped': 'test directory skipped',
    'type-depth-exceeded': 'type nested too deep',
    'type-generic-uninstantiated': 'type argument unknown',
    'type-kind-unsupported': 'kind of type not supported',
    'type-missing': 'type missing',
    'type-unresolved': 'type not resolved',
    'unknown-base-url-env': 'base address setting names no service',
    'unknown-db-operation': 'query neither reads nor writes',
    'unknown-db-package': 'data package unknown',
    'wizard-step-conflict': 'two wizard steps share a number',
    'workflow-definition-invalid': 'workflow definition invalid',
    'workflow-definition-not-loaded': 'workflow definition not read',
    'workflow-definition-unreadable': 'workflow definition unreadable',
    'workflow-name-duplicate': 'two workflows of one name',
    'workflow-name-unread': 'workflow name not settled',
    'workflow-named-by-file': 'workflow named after its file',
    'workflow-target-dynamic': 'step target chosen at run time',
    'workflow-target-unreadable': 'step target not named',
    'workflow-template-unbound': 'step target is a placeholder',
  }),
  edge: Object.freeze({
    imports: 'imports',
    injects: 'injects',
    calls: 'calls',
    handles: 'handled by',
    guarded_by: 'guarded by',
    queries: 'queries',
    caches: 'caches',
    emits: 'publishes',
    consumes: 'consumes',
    http_calls: 'requests',
    hits: 'answered by',
    triggers: 'starts',
    reads_config: 'reads config',
  }),
  /* `marker` and `declared` keep a word each: the Graph's trust filter lists
     both, and core keeps them apart on purpose (model/edges.ts). */
  trust: Object.freeze({
    static: 'read from code',
    marker: 'annotated',
    declared: 'declared',
    heuristic: 'best guess',
    runtime: 'seen at run time',
  }),
  /* What a finding risks (P100, core's `riskOf`): the Risks section's groups on Not joined. */
  risk: Object.freeze({
    auth: 'who may ask',
    performance: 'likely N+1 and cost',
    wiring: 'wired wrong or meeting nothing',
  }),
});

/**
 * The word for a code: `wordFor('reason', 'route-unguarded')` is "no guard in
 * front". A code the table has no word for reads as itself with its dashes and
 * underscores as spaces, so a new reason is still words on the page.
 */
export const wordFor = (kind, code) => {
  const table = PAGE_WORDS[kind];
  const text = String(code ?? '');
  return table !== undefined && Object.prototype.hasOwnProperty.call(table, text) ? table[text] : text.replace(/[-_]+/g, ' ');
};

/* ── The page's keys (P101) ── */

/**
 * Every key the page answers, where it works and what it does: the handlers
 * ask `pressed(id, event)` and the `?` overlay lists the table, so a key that
 * exists is always one a person can find. `keys` are `KeyboardEvent.key`
 * values; `mod` is Ctrl or ⌘ held; an entry with no keys is a gesture, listed
 * for completeness. `where` groups them in the overlay.
 */
export const SHORTCUTS = Object.freeze([
  { id: 'find', where: 'anywhere', keys: ['/'], say: '/', what: 'search everything' },
  { id: 'palette', where: 'anywhere', keys: ['k', 'K'], mod: true, say: '⌘K or Ctrl+K', what: 'run a command' },
  { id: 'help', where: 'anywhere', keys: ['?'], say: '?', what: 'these keys' },
  { id: 'press', where: 'anywhere', keys: ['Enter', ' '], say: 'Enter or Space', what: 'press what the keyboard is on: a pill, a box, a button' },
  { id: 'close', where: 'anywhere', keys: ['Escape'], say: 'Escape', what: 'close the note, list or card that is open' },
  { id: 'tabs.move', where: 'tabs', keys: ['ArrowLeft', 'ArrowRight'], say: '← →', what: 'the tab before or after, opened' },
  { id: 'tabs.ends', where: 'tabs', keys: ['Home', 'End'], say: 'Home End', what: 'the first or the last tab, opened' },
  { id: 'list.move', where: 'list', keys: ['ArrowDown', 'ArrowUp', 'Home', 'End'], say: '↓ ↑ Home End', what: 'the way in below or above, or the first or last one' },
  { id: 'find.move', where: 'find', keys: ['ArrowDown', 'ArrowUp'], say: '↓ ↑', what: 'move through what was found' },
  { id: 'find.go', where: 'find', keys: ['Enter'], say: 'Enter', what: 'go to it, marked' },
  { id: 'find.close', where: 'find', keys: ['Escape'], say: 'Escape', what: 'clear the search, or stop picking a path’s end' },
  { id: 'graph.move', where: 'graph', keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], say: '← → ↑ ↓', what: 'move between nodes' },
  { id: 'graph.open', where: 'graph', keys: ['Enter', ' '], say: 'Enter', what: 'open a node’s details, or a group' },
  { id: 'graph.expand', where: 'graph', keys: ['+'], say: '+', what: 'draw more of the flow past a node' },
  { id: 'graph.also', where: 'graph', keys: ['o', 'O'], say: 'O', what: 'who else uses a node' },
  { id: 'graph.plumbing', where: 'graph', keys: ['w', 'W'], say: 'W', what: 'unfold the plumbing in front of a node' },
  { id: 'graph.types', where: 'graph', keys: ['t', 'T'], say: 'T', what: 'types under every node' },
  { id: 'graph.type-all', where: 'graph', keys: ['e', 'E', '*'], say: 'E', what: 'open a type in the details all the way' },
  { id: 'graph.full', where: 'graph', keys: ['f', 'F'], say: 'F', what: 'full screen' },
  { id: 'graph.close', where: 'graph', keys: ['Escape'], say: 'Escape', what: 'close the nearest: a popover, picking an end, the details, an answer, full screen' },
  { id: 'graph.drawer', where: 'graph', keys: ['ArrowLeft', 'ArrowRight', 'Home', 'End'], say: '← → Home End', what: 'on the edge of the details panel: widen or narrow it' },
  { id: 'graph.fold', where: 'graph', keys: ['Enter', ' '], say: 'Enter', what: 'on the edge of the details panel: fold it' },
  { id: 'graph.centre', where: 'graph', keys: [], say: 'double-click', what: 'centre on a node' },
  { id: 'graph.zoom', where: 'graph', keys: [], say: 'Ctrl or ⌘ + wheel', what: 'zoom; a pinch on a trackpad or a screen too' },
  { id: 'graph.pan', where: 'graph', keys: [], say: 'drag', what: 'move the drawing; the wheel scrolls the page, and moves the drawing only in full screen' },
  { id: 'map.move', where: 'map', keys: [], say: 'Tab', what: 'move between boxes' },
  { id: 'map.open', where: 'map', keys: ['Enter', ' '], say: 'Enter', what: 'open a box, or a stacked box’s family' },
  { id: 'map.full', where: 'map', keys: ['f', 'F'], say: 'F', what: 'full screen' },
  { id: 'map.close', where: 'map', keys: ['Escape'], say: 'Escape', what: 'close the nearest: a notice, the details, one box, full screen' },
  { id: 'map.focus', where: 'map', keys: [], say: 'double-click', what: 'draw one box and what it touches' },
  { id: 'map.zoom', where: 'map', keys: [], say: 'Ctrl or ⌘ + wheel', what: 'zoom; a pinch too' },
  { id: 'map.pan', where: 'map', keys: [], say: 'drag', what: 'move the map; the wheel scrolls the page, and moves the map only in full screen' },
  { id: 'menu.move', where: 'menu', keys: ['ArrowDown', 'ArrowUp'], say: '↓ ↑', what: 'move through the commands' },
  { id: 'menu.run', where: 'menu', keys: ['Enter'], say: 'Enter', what: 'run the command' },
  { id: 'menu.close', where: 'menu', keys: ['Escape'], say: 'Escape', what: 'close it, or this list, back to where you were' },
]);

/** The headings the overlay lists the keys under, in its order. */
export const SHORTCUT_PLACES = Object.freeze({
  anywhere: 'Anywhere', tabs: 'On the tab row', list: 'In the Ways in list', find: 'In the search', graph: 'On the Graph tab', map: 'On the Map tab', menu: 'In the command list or a row menu',
});

const SHORTCUT_BY_ID = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

/**
 * Whether a key event is the shortcut `id`. Alt never is; Ctrl or ⌘ only for
 * a shortcut that asks for it. An id the table does not hold throws, so a
 * handler cannot answer a key the overlay does not list.
 */
export const pressed = (id, event) => {
  const shortcut = SHORTCUT_BY_ID.get(id);
  if (shortcut === undefined) throw new Error(`no shortcut ${id}`);
  if (event.altKey || Boolean(shortcut.mod) !== Boolean(event.ctrlKey || event.metaKey)) return false;
  return shortcut.keys.includes(event.key);
};

/**
 * What a wheel over a drawing does (P102): with Ctrl or ⌘ - which is also how
 * a browser sends a trackpad pinch - it zooms; otherwise it scrolls the page,
 * the way a map set in a page does, so a person scrolling past is never
 * caught in the canvas. In full screen there is no page to scroll, and the
 * wheel moves the drawing.
 */
export const wheelIntent = (event, full) => {
  if (event.ctrlKey || event.metaKey) return 'zoom';
  return full ? 'pan' : 'page';
};

/** `#rgb` or `#rrggbb` as its three channels, 0 to 255; null for anything else. */
const channelsOf = (colour) => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(colour).trim());
  if (hex === null) return null;
  const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
};

/** How bright a colour reads, 0 (black) to 1 (white): WCAG 2's relative luminance. */
const luminanceOf = (colour) => {
  const channels = channelsOf(colour);
  if (channels === null) throw new Error(`not a colour the contrast is worked out for: ${colour}`);
  const [r, g, b] = channels.map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * The contrast ratio of two colours, 1 to 21, either way round: 4.5 is what
 * WCAG AA asks of text, 3 of large text and of a graphic.
 */
export const contrastOf = (fg, bg) => {
  const [light, dark] = [luminanceOf(fg), luminanceOf(bg)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};
