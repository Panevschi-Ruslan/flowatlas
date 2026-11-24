import {
  CREDENTIALS_META,
  ENVIRONMENT_META,
  failuresOf,
  HEADERS_META,
  rowKindOf,
  SENDS_JSON_META,
  statusChecksOf,
  STREAM_EVENTS_META,
  STREAM_EVENTS_UNREAD_META,
  UNREAD_SPAN,
  type GraphNode,
  type SettingNames,
} from '@flowatlas/core';
import type { AnchoredUnresolvedRow, GraphDb } from '../db/reader.js';
import { closeSpelling, likelyRenamed, waysInReaching, type BoundaryFinding, type Promoted } from './boundary.js';

/**
 * Protocol, validation, settings, status and CORS mismatches across the
 * boundary (P388): where flowatlas reads both sides of something the two
 * sides must agree on and one side says what the other never does. Each is
 * gated on the fact that makes it a defect, as the findings between the
 * services are (P384): where that fact does not hold the candidate is held
 * back with why, never named a defect and never silence.
 *
 * - A stream's frames sent under a name its browser listener never listens
 *   for (MDN: `onmessage` hears only frames with no `event:`; a named one goes
 *   to `addEventListener(name)`), and a listener for a name never sent.
 * - A bot's button whose callback data no handler matches, a handler no button
 *   triggers, callback data over the 64 bytes the bot platform's API allows.
 * - A setting read with no default and set in none of its service's
 *   deployment files, one set there and read nowhere, and the pair a letter or
 *   two apart that is most likely one name spelled two ways.
 * - A client branching on a status the route it is joined to never answers.
 * - A browser's request its server's CORS settings refuse: credentials
 *   against `*` or without `credentials: true`, a header or a verb not allowed.
 *
 * Read off the graph at answer time, as the types never published are, from
 * facts each reader wrote beside what it already drew (a route's
 * `streamEvents`, a method's `callbackButtons`, a request's `statusChecks`,
 * `credentials`, `headers` and `sendsJson`, a service's `cors`) and the names
 * its deployment files set, kept beside the graph (`GraphDb.settingNames`).
 */

/** The finding kinds this module says, in the order the findings list them. */
export const MISMATCH_KINDS = [
  'sse-event-unhandled',
  'bot-button-unhandled',
  'bot-button-data-too-long',
  'config-name-mismatch',
  'status-never-answered',
  'cors-credentials',
  'cors-header-not-allowed',
  'cors-method-not-allowed',
  'config-not-set',
  'sse-event-never-sent',
  'bot-handler-untriggered',
  'config-never-read',
] as const;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const nodeLoc = (node: Pick<GraphNode, 'file' | 'line'> | undefined): string | undefined =>
  node?.file === undefined ? undefined : node.line === undefined ? node.file : `${node.file}:${node.line}`;

const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(', ');

/** A request as a reader says it: the code that sends it, and what it asks for. */
const sentBy = (db: GraphDb, request: GraphNode): string => {
  const sender = db
    .edgesTo(request.id, ['calls'])
    .flatMap((edge) => db.node(edge.from)?.label ?? [])
    .sort(byText)[0];
  return sender === undefined ? request.label : `${sender} (${request.label})`;
};

/** The ways in that meet a defect, said on it where any reach it. */
const metBy = (db: GraphDb, id: string): Pick<BoundaryFinding, 'seenBy' | 'waysIn'> => {
  const ways = waysInReaching(db, id);
  return {
    ...(ways.seenBy.length === 0 ? {} : { seenBy: ways.seenBy }),
    ...(ways.waysIn > ways.seenBy.length ? { waysIn: ways.waysIn } : {}),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Streams of server-sent events

/** The event a browser dispatches a frame under when the frame names none. */
const UNNAMED = 'message';

const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : []);

/**
 * Frames a route sends under a name no listener of the browser's stream
 * listens for (`sse-event-unhandled`, high), and a listener for a name the
 * route never sends (`sse-event-never-sent`, medium). Judged where every frame
 * the route writes says its name and every listener of the stream was read.
 */
export const streamEventMismatches = (db: GraphDb): Promoted[] => {
  const out: Promoted[] = [];
  const routes = db
    .nodesByType('entry', 'http')
    .filter((route) => route.meta?.['stream'] === 'sse' && Array.isArray(route.meta?.[STREAM_EVENTS_META]))
    .sort((a, b) => byText(a.id, b.id));
  for (const route of routes) {
    const sent = stringsOf(route.meta?.[STREAM_EVENTS_META]);
    const sentUnread = route.meta?.[STREAM_EVENTS_UNREAD_META] === true;
    const requests = [...new Set(db.edgesTo(route.id, ['hits']).map((edge) => edge.from))]
      .flatMap((id) => db.node(id) ?? [])
      .filter((node) => node.type === 'ui_api_call')
      .sort((a, b) => byText(a.id, b.id));
    let listenedAtAll = false;
    for (const request of requests) {
      const consumers = db
        .edgesFrom(request.id, ['triggers'])
        .flatMap((edge) => db.node(edge.to) ?? [])
        .filter((node) => node.type === 'consumer' && node.meta?.['client'] === 'EventSource')
        .sort((a, b) => byText(a.id, b.id));
      if (consumers.length === 0) continue;
      listenedAtAll = true;
      const listened = [...new Set(consumers.flatMap((consumer) => stringsOf(consumer.meta?.['events'])))].sort(byText);
      const listener = consumers[0]!;
      const loc = nodeLoc(listener);
      const unheard = sent.filter((event) => !listened.includes(event));
      const neverSent = listened.filter((event) => event !== UNNAMED && event !== '?' && !sent.includes(event));
      if (listened.includes('?')) {
        for (const event of unheard) {
          out.push({ held: { kind: 'sse-event-unhandled', id: `${listener.id}|${event}`, why: `a listener of the stream of ${route.label} is registered under a name not read` } });
        }
        continue;
      }
      for (const event of unheard) {
        const renamed = likelyRenamed(event, listened.filter((each) => each !== UNNAMED));
        out.push({
          finding: {
            kind: 'sse-event-unhandled',
            id: listener.id,
            service: listener.repo,
            ...(loc === undefined ? {} : { loc }),
            message:
              event === UNNAMED
                ? `${route.label} sends frames named no event, which only onmessage hears; ${listener.label} listens only for ${quoted(listened)}`
                : `${route.label} sends frames as the event "${event}", which ${listener.label} never listens for: it listens for ${quoted(listened)}${listened.includes(UNNAMED) ? ', and onmessage hears only frames named no event' : ''}`,
            precision: 'high',
            evidence: 'every frame the route writes was read with its name, and every listener of the stream with the name it listens for',
            fix:
              renamed !== undefined
                ? `likely renamed: "${event}" is sent, "${renamed}" is listened for`
                : event === UNNAMED
                  ? 'name the frames, or listen with onmessage'
                  : `listen with addEventListener("${event}", …), or send the frames with no event name`,
            nearest: [route.id],
            ...metBy(db, request.id),
            to: route.id,
          },
        });
      }
      for (const event of neverSent) {
        if (sentUnread) {
          out.push({ held: { kind: 'sse-event-never-sent', id: `${listener.id}|${event}`, why: `a frame of ${route.label} is named at run time, or written where it is not read` } });
          continue;
        }
        const renamed = likelyRenamed(event, sent);
        out.push({
          finding: {
            kind: 'sse-event-never-sent',
            id: listener.id,
            service: listener.repo,
            ...(loc === undefined ? {} : { loc }),
            message: `${listener.label} listens for "${event}" on ${route.label}, which sends ${sent.length === 0 ? 'no frame' : quoted(sent)}`,
            precision: 'medium',
            evidence: 'every frame the route writes was read with its name',
            ...(renamed === undefined ? {} : { fix: `likely renamed: "${renamed}" is sent, "${event}" is listened for` }),
            nearest: [route.id],
            to: route.id,
          },
        });
      }
    }
    // Frames sent under a name not read: whatever a listener misses is not said.
    if (sentUnread && listenedAtAll) {
      out.push({ held: { kind: 'sse-event-unhandled', id: route.id, why: `a frame of ${route.label} is named at run time, or written where it is not read` } });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Bot buttons and the handlers of callback data

/** The most bytes the bot platform's API takes as a button's `callback_data`. */
export const CALLBACK_DATA_MAX_BYTES = 64;

interface Button {
  data: string;
  at: string;
  holder: GraphNode;
}

interface Handler {
  entry: GraphNode;
  /** The data matched exactly, or a pattern. */
  text?: string;
  pattern?: RegExp;
  said: string;
}

/** The buttons the graph's code builds, project wide. */
const buttonsOf = (db: GraphDb): Button[] =>
  [...db.nodesByType('method'), ...db.nodesByType('function')]
    .flatMap((holder) =>
      (Array.isArray(holder.meta?.['callbackButtons']) ? (holder.meta['callbackButtons'] as unknown[]) : [])
        .filter((each): each is { data: string; at: string } => isRecord(each) && typeof each['data'] === 'string' && typeof each['at'] === 'string')
        .map((each) => ({ data: each.data, at: each.at, holder })),
    )
    .sort((a, b) => byText(a.at, b.at) || byText(a.data, b.data));

const regexOf = (source: string, flags: string): RegExp | undefined => {
  try {
    return new RegExp(source, flags.replace(/[gy]/g, ''));
  } catch {
    return undefined;
  }
};

/** A handler's trigger as it matches: the data itself, or `/source/flags`. */
const handlerOf = (entry: GraphNode): Handler | undefined => {
  const callback = entry.meta?.['callbackData'];
  const marker = ':bot_callback:';
  const key = typeof entry.meta?.['key'] === 'string' ? entry.meta['key'] : entry.id.slice(entry.id.lastIndexOf(marker) + marker.length);
  if (isRecord(callback) && typeof callback['regex'] === 'string') {
    const flags = String(callback['flags'] ?? '');
    const pattern = regexOf(callback['regex'], flags);
    return pattern === undefined ? undefined : { entry, pattern, said: `/${callback['regex']}/${flags}` };
  }
  if (typeof callback === 'string') return { entry, text: callback, said: `"${callback}"` };
  const regex = /^\/(.*)\/([a-z]*)$/.exec(key);
  if (regex !== null) {
    const pattern = regexOf(regex[1]!, regex[2]!);
    return pattern === undefined ? undefined : { entry, pattern, said: key };
  }
  return key === '' ? undefined : { entry, text: key, said: `"${key}"` };
};

/** Data with its unread parts filled, the ways a handler is asked whether it matches it. */
const samplesOf = (data: string): string[] => (data.includes(UNREAD_SPAN) ? ['1', 'a', 'x1'].map((fill) => data.split(UNREAD_SPAN).join(fill)) : [data]);

/** A button's data as a pattern a handler's own text is held against: the unread parts match anything. */
const patternOf = (data: string): RegExp =>
  new RegExp(`^${data.split(UNREAD_SPAN).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);

const matches = (handler: Handler, data: string): boolean =>
  handler.pattern !== undefined
    ? samplesOf(data).some((sample) => handler.pattern!.test(sample))
    : handler.text === data || (data.includes(UNREAD_SPAN) && patternOf(data).test(handler.text ?? ''));

/** The bytes a button's data takes at least: what is written of it. */
const bytesOf = (data: string): number => Buffer.byteLength(data.split(UNREAD_SPAN).join(''), 'utf8');

/**
 * Buttons whose callback data no handler matches (`bot-button-unhandled`,
 * high), handlers no button triggers (`bot-handler-untriggered`, medium), and
 * callback data over the platform's 64 bytes (`bot-button-data-too-long`,
 * high). A dead button is judged where every handler of callback data in the
 * project was read and none takes every callback (`on('callback_query')`);
 * an untriggered handler where every button was read, its data written out.
 */
export const botButtonMismatches = (db: GraphDb, all: readonly AnchoredUnresolvedRow[]): Promoted[] => {
  const out: Promoted[] = [];
  const buttons = buttonsOf(db);
  const entries = db.nodesByType('entry', 'bot_callback').filter((entry) => entry.meta?.['registration'] !== 'inlineQuery');
  if (buttons.length === 0 && entries.length === 0) return out;
  const handlers = entries.flatMap((entry) => handlerOf(entry) ?? []).sort((a, b) => byText(a.entry.id, b.entry.id));
  const botServices = new Set(db.nodesByType('entry').filter((entry) => /^bot_|^scene_/.test(entry.kind ?? '')).map((entry) => entry.repo));
  const unreadTriggers = all.filter((row) => row.reason === 'dynamic-bot-trigger' && botServices.has(row.service ?? '')).length;
  const catchAll = db
    .nodesByType('entry', 'bot_event')
    .find((entry) => entry.meta?.['updateType'] === 'callback_query' || entry.meta?.['key'] === 'callback_query' || entry.id.endsWith(':bot_event:callback_query'));
  const handlersWhy =
    unreadTriggers > 0
      ? `${unreadTriggers} handler(s) of a bot are registered under a trigger not read`
      : catchAll !== undefined
        ? `${catchAll.label} (${catchAll.repo}) takes every callback`
        : handlers.length < entries.length
          ? 'a handler of callback data is registered under a pattern not read'
          : undefined;
  for (const button of buttons) {
    const bytes = bytesOf(button.data);
    const partly = button.data.includes(UNREAD_SPAN);
    if (bytes > CALLBACK_DATA_MAX_BYTES) {
      out.push({
        finding: {
          kind: 'bot-button-data-too-long',
          id: button.holder.id,
          service: button.holder.repo,
          loc: button.at,
          message: `${button.holder.label} builds a button whose callback data "${button.data}" is ${partly ? 'at least ' : ''}${bytes} bytes, over the ${CALLBACK_DATA_MAX_BYTES} the bot platform takes: the message carrying it is refused`,
          precision: 'high',
          evidence: `the bot platform's API takes callback_data of 1-${CALLBACK_DATA_MAX_BYTES} bytes; ${partly ? 'the parts written out alone are longer' : 'the data is written out'}`,
          fix: 'send a short key (an id, a code) and look the rest up when it comes back',
          ...metBy(db, button.holder.id),
        },
      });
    }
    if (button.data === UNREAD_SPAN || handlers.some((handler) => matches(handler, button.data))) continue;
    if (handlersWhy !== undefined) {
      out.push({ held: { kind: 'bot-button-unhandled', id: `${button.holder.id}|${button.at}`, why: handlersWhy } });
      continue;
    }
    const near = likelyRenamed(button.data, handlers.flatMap((handler) => (handler.text === undefined ? [] : [handler.text])));
    out.push({
      finding: {
        kind: 'bot-button-unhandled',
        id: button.holder.id,
        service: button.holder.repo,
        loc: button.at,
        message: `${button.holder.label} builds a button sending "${button.data}", which no handler of callback data matches${handlers.length === 0 ? ': none is registered' : `; the handlers match ${handlers.map((each) => each.said).sort(byText).join(', ')}`}`,
        precision: 'high',
        evidence: 'every handler of callback data in the project was read, and none takes every callback',
        ...(near === undefined ? {} : { fix: `likely renamed: "${button.data}" is sent, "${near}" is handled`, nearest: handlers.filter((each) => each.text === near).map((each) => each.entry.id) }),
        ...metBy(db, button.holder.id),
      },
    });
  }
  const buttonsWhy = buttons.some((button) => button.data === UNREAD_SPAN)
    ? 'a button sends callback data not read'
    : all.some((row) => row.reason === 'bot-button-unplaced')
      ? 'a button is built where no function the reading draws holds it'
      : buttons.length === 0
        ? 'no button was read in the project; its keyboards may be built where the reading does not look'
        : undefined;
  const sentData = [...new Set(buttons.map((button) => button.data))].sort(byText);
  for (const handler of handlers) {
    if (buttons.some((button) => button.data !== UNREAD_SPAN && matches(handler, button.data))) continue;
    if (buttonsWhy !== undefined) {
      out.push({ held: { kind: 'bot-handler-untriggered', id: handler.entry.id, why: buttonsWhy } });
      continue;
    }
    const near = handler.text === undefined ? undefined : likelyRenamed(handler.text, sentData.filter((data) => !data.includes(UNREAD_SPAN)));
    const loc = nodeLoc(handler.entry);
    const runs = db.edgesFrom(handler.entry.id, ['handles']).flatMap((edge) => db.node(edge.to)?.label ?? [])[0];
    out.push({
      finding: {
        kind: 'bot-handler-untriggered',
        id: handler.entry.id,
        service: handler.entry.repo,
        ...(loc === undefined ? {} : { loc }),
        message: `${runs ?? handler.entry.label} handles callback data ${handler.said}, which no button the project builds sends; the buttons send ${quoted(sentData)}`,
        precision: 'medium',
        evidence: 'every button the project builds was read with its callback data; a button built outside the project is what would make this wrong',
        ...(near === undefined ? {} : { fix: `likely renamed: "${near}" is sent, ${handler.said} is handled` }),
      },
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Settings read against the settings set

/**
 * Settings the platform, the runtime or a tool sets or reads by itself: a
 * key among these read with no default is not a defect, and one set and read
 * by no code is read by them.
 */
const PLATFORM_SETTING =
  /^(NODE_ENV|NODE_OPTIONS|PORT|HOST|HOSTNAME|HOME|PATH|PWD|TZ|LANG|CI|DEBUG|npm_.*|AWS_(REGION|DEFAULT_REGION|EXECUTION_ENV|LAMBDA_.*)|LAMBDA_TASK_ROOT|_HANDLER|K_SERVICE|K_REVISION|VERCEL.*|NETLIFY.*|CF_PAGES.*|GITHUB_.*|RUNNER_.*|DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|COMPOSE_.*|DOCKER_.*)$/;

interface ConfigRead {
  node: GraphNode;
  key: string;
  defaulted: boolean;
}

/** The names a service's deployed functions are given in their deployment (`meta.environment`). */
const deployedNames = (db: GraphDb, service: string): Set<string> =>
  new Set(
    db
      .nodesByType('entry')
      .filter((entry) => entry.repo === service && isRecord(entry.meta?.[ENVIRONMENT_META]))
      .flatMap((entry) => Object.keys(entry.meta![ENVIRONMENT_META] as Record<string, unknown>)),
  );

/** Why a key read and set nowhere cannot be said to be set nowhere, or undefined where it can. */
const notSetWhy = (service: string, ledger: SettingNames | undefined, deployed: ReadonlySet<string>): string | undefined => {
  if (ledger === undefined) return deployed.size > 0 ? undefined : 'the names its deployment files set were not recorded; build again';
  if (ledger.files.length === 0 && deployed.size === 0) return `no deployment file of ${service} was read: its settings may be set where the reading does not look`;
  if (ledger.schema !== undefined) return `the configuration module in ${ledger.schema} validates the settings with a schema, which may give it a default`;
  if (ledger.from !== undefined && ledger.from.length > 0) return `a manifest takes every setting of ${ledger.from[0]}, which no file read writes`;
  if (ledger.unread !== undefined && ledger.unread.length > 0) return `${ledger.unread[0]} could not be parsed`;
  return undefined;
};

/**
 * A setting read with no default that none of its service's deployment files
 * sets (`config-not-set`, medium: a value given outside the files, a secret
 * store or a console, is what would make it wrong), the same where another
 * name a letter or two apart is set and read nowhere (`config-name-mismatch`,
 * high), and a name set and read by no code of the service
 * (`config-never-read`, low).
 */
export const configMismatches = (db: GraphDb, all: readonly AnchoredUnresolvedRow[]): Promoted[] => {
  const out: Promoted[] = [];
  const ledgers = db.settingNames();
  const reads = new Map<string, ConfigRead[]>();
  for (const node of db.nodesByType('config_key').sort((a, b) => byText(a.id, b.id))) {
    const key = String(node.meta?.['key'] ?? node.label);
    const defaulted = node.meta?.['defaultValue'] !== undefined || node.meta?.['fallback'] === true;
    reads.set(node.repo, [...(reads.get(node.repo) ?? []), { node, key, defaulted }]);
  }
  for (const [service, keys] of [...reads].sort((a, b) => byText(a[0], b[0]))) {
    const ledger = ledgers?.[service];
    const deployed = deployedNames(db, service);
    const set = new Set([...Object.keys(ledger?.names ?? {}), ...deployed]);
    const readKeys = new Set(keys.map((each) => each.key));
    const unsetUnread = Object.keys(ledger?.names ?? {}).filter((name) => !readKeys.has(name) && !PLATFORM_SETTING.test(name));
    const nearOf = (key: string): string[] => unsetUnread.filter((name) => closeSpelling(name.toLowerCase(), key.toLowerCase())).sort(byText);
    const why = notSetWhy(service, ledger, deployed);
    const files = ledger?.files ?? [];
    const named = new Set<string>();
    for (const read of keys) {
      if (read.defaulted || set.has(read.key) || PLATFORM_SETTING.test(read.key)) continue;
      if (why !== undefined) {
        out.push({ held: { kind: 'config-not-set', id: read.node.id, why } });
        continue;
      }
      const near = nearOf(read.key);
      const one = near.length === 1 ? near[0]! : undefined;
      if (one !== undefined) named.add(one);
      const firstReader = db
        .edgesTo(read.node.id, ['reads_config'])
        .flatMap((edge) => db.node(edge.from) ?? [])
        .sort((a, b) => byText(a.id, b.id))[0];
      const by = firstReader === undefined ? '' : ` by ${firstReader.label}`;
      const loc = nodeLoc(read.node);
      out.push({
        finding: {
          kind: one === undefined ? 'config-not-set' : 'config-name-mismatch',
          id: read.node.id,
          service,
          ...(loc === undefined ? {} : { loc }),
          message:
            one !== undefined
              ? `${read.key} is read with no default${by} and set nowhere, while ${one} is set in ${(ledger?.names[one] ?? []).join(', ')} and read nowhere`
              : `${read.key} is read with no default${by}, and none of ${service}'s deployment files sets it (${files.slice(0, 3).join(', ')}${files.length > 3 ? `, ${files.length - 3} more` : ''})`,
          precision: one === undefined ? 'medium' : 'high',
          evidence:
            one !== undefined
              ? 'one name is read and set nowhere, the other set and read nowhere, a letter or two apart'
              : 'every deployment file of the service was read for the names it sets; a value given outside the files (a secret store, a console, the shell) is what would make this wrong',
          fix: one !== undefined ? `one name spelled two ways: read ${one}, or set ${read.key}` : `set ${read.key} where ${service} is deployed, or give the read a default`,
          ...(firstReader === undefined ? {} : metBy(db, firstReader.id)),
        },
      });
    }
    // Set and read by no code: only where every read's key was read and the files were.
    if (ledger === undefined || ledger.files.length === 0) continue;
    const dynamic = all.some((row) => row.service === service && row.reason === 'dynamic-config-key');
    for (const name of unsetUnread.sort(byText)) {
      // Said already, as the other half of a name spelled two ways.
      if (named.has(name)) continue;
      const id = `config_key:${service}#${name}`;
      if (dynamic) {
        out.push({ held: { kind: 'config-never-read', id, why: `a setting of ${service} is read under a key built at run time, which may be it` } });
        continue;
      }
      const where = ledger.names[name] ?? [];
      out.push({
        finding: {
          kind: 'config-never-read',
          id,
          service,
          ...(where[0] === undefined ? {} : { loc: where[0] }),
          message: `${name} is set in ${where.join(', ')} and no code of ${service} reads it`,
          precision: 'low',
          evidence: 'every read of a setting in the service names its key; a library reading it by itself is what would make this wrong',
          fix: `drop ${name}, or read it`,
        },
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Statuses a client branches on

/**
 * Statuses not judged: what the framework, a proxy or a gateway in front may
 * answer whatever the route's code says - a malformed or refused body, who is
 * asking, a size or a rate limit, a timeout, any server error - and a success.
 */
const ANSWERED_BY_ANYONE = (status: number): boolean =>
  status < 400 || [400, 401, 403, 405, 407, 408, 413, 415, 429].includes(status) || status >= 500;

/** The edges the code behind a route is walked along, within its service. */
const BEHIND = ['handles', 'calls'] as const;

/**
 * A client branching on a status the route its request is joined to never
 * answers (`status-never-answered`): the branch is dead, or the route answers
 * the case another way (a 200 with nothing, another status). Judged where the
 * route's failures were read by its framework's reader (Nest's), every one
 * with its status, and no file of the code behind it left a gap; high, `404`
 * medium (a proxy in front may answer it for a path).
 */
export const statusMismatches = (db: GraphDb, all: readonly AnchoredUnresolvedRow[]): Promoted[] => {
  const out: Promoted[] = [];
  // The gaps of each file, and the code each line of a file belongs to: a gap
  // counts against a route only where it is written in code behind it.
  const gapsIn = new Map<string, AnchoredUnresolvedRow[]>();
  for (const row of all) {
    if (row.file === null || (row.kind ?? rowKindOf(row)) !== 'gap') continue;
    const key = `${row.service ?? ''}|${row.file}`;
    gapsIn.set(key, [...(gapsIn.get(key) ?? []), row]);
  }
  const bodiesIn = new Map<string, Array<{ line: number; id: string }>>();
  for (const node of [...db.nodesByType('method'), ...db.nodesByType('function'), ...db.nodesByType('entry')]) {
    if (node.file === undefined || node.line === undefined) continue;
    const key = `${node.repo}|${node.file}`;
    bodiesIn.set(key, [...(bodiesIn.get(key) ?? []), { line: node.line, id: node.id }]);
  }
  for (const list of bodiesIn.values()) list.sort((a, b) => a.line - b.line || byText(a.id, b.id));
  /** The code a line of a file is written in: the last body starting at or above it. */
  const ownerOf = (key: string, line: number): string | undefined => {
    let owner: string | undefined;
    for (const body of bodiesIn.get(key) ?? []) {
      if (body.line > line) break;
      owner = body.id;
    }
    return owner;
  };
  const requests = [...db.nodesByType('ui_api_call'), ...db.nodesByType('http_out')]
    .filter((node) => statusChecksOf(node).length > 0)
    .sort((a, b) => byText(a.id, b.id));
  for (const request of requests) {
    const checks = statusChecksOf(request).filter((check) => !ANSWERED_BY_ANYONE(check.status));
    if (checks.length === 0) continue;
    const routes = [...new Set(db.edgesFrom(request.id, ['hits', 'http_calls']).map((edge) => edge.to))]
      .flatMap((id) => db.node(id) ?? [])
      .filter((node) => node.type === 'entry');
    if (routes.length === 0) continue;
    const hold = (why: string): void => {
      for (const check of checks) out.push({ held: { kind: 'status-never-answered', id: `${request.id}|${check.status}`, why } });
    };
    if (routes.length > 1) {
      hold(`the request is joined to ${routes.length} routes`);
      continue;
    }
    const route = routes[0]!;
    if (route.meta?.['adapter'] !== 'nestjs-http') {
      hold(`what ${route.label} answers with is not read for its framework`);
      continue;
    }
    const failures = failuresOf(route);
    const computed = failures.find(
      (failure) => failure.status === undefined && (failure.chosenFrom === undefined || failure.chosenFrom.some((choice) => choice.status === undefined)),
    );
    if (computed !== undefined) {
      hold(`${route.label} throws ${computed.exception}, whose status is not read`);
      continue;
    }
    const walked = db.traverse({ from: route.id, direction: 'out', edgeTypes: BEHIND, maxDepth: 12, maxNodes: 2000 });
    if (walked.truncated) {
      hold(`the code behind ${route.label} is larger than the walk reads`);
      continue;
    }
    const behind = new Set([route.id, ...walked.rows.filter((row) => row.service === route.repo).map((row) => row.id)]);
    const files = new Set([...behind].flatMap((id) => db.node(id)?.file ?? []));
    const gap = [...files]
      .sort(byText)
      .flatMap((file) => (gapsIn.get(`${route.repo}|${file}`) ?? []).map((row) => ({ file, row })))
      .find(({ file, row }) => (row.node !== null && behind.has(row.node)) || behind.has(ownerOf(`${route.repo}|${file}`, row.line ?? 0) ?? ''));
    if (gap !== undefined) {
      hold(`the code behind ${route.label} was not read whole (${gap.row.reason} at ${gap.file}:${gap.row.line ?? 0})`);
      continue;
    }
    const answered = new Set(
      failures.flatMap((failure) => [
        ...(failure.status === undefined ? [] : [failure.status]),
        ...(failure.chosenFrom ?? []).flatMap((choice) => (choice.status === undefined ? [] : [choice.status])),
      ]),
    );
    const said = [...answered].sort((a, b) => a - b);
    const sender = db
      .edgesTo(request.id, ['calls'])
      .flatMap((edge) => db.node(edge.from)?.label ?? [])
      .sort(byText)[0];
    const seen = new Set<number>();
    for (const check of checks) {
      if (answered.has(check.status) || seen.has(check.status)) continue;
      seen.add(check.status);
      out.push({
        finding: {
          kind: 'status-never-answered',
          id: request.id,
          service: request.repo,
          loc: check.at,
          message: `${check.in ?? sender ?? request.label} branches on ${check.status} from ${route.label}, which never answers ${check.status}${said.length === 0 ? ': its code throws nothing with a status' : `: it answers ${said.join(', ')}`}`,
          precision: check.status === 404 ? 'medium' : 'high',
          evidence:
            'every failure of the route was read with its status and nothing behind it left unread; statuses a proxy or the framework may answer (400, 401, 403, 408, 413, 429, 5xx) are not judged',
          fix:
            said.length === 0
              ? `throw the exception that answers ${check.status} where the case arises, or drop the branch`
              : `branch on what the route answers (${said.join(', ')}), or make it answer ${check.status}`,
          nearest: [route.id],
          ...metBy(db, request.id),
          to: route.id,
        },
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// CORS

interface Cors {
  at: string;
  origin: '*' | 'reflect' | 'list' | 'unread';
  credentials: boolean | 'unread';
  allowedHeaders?: string[] | 'unread';
  methods?: string[] | 'unread';
}

const corsOf = (node: GraphNode): Cors | undefined => {
  const raw = node.meta?.['cors'];
  return isRecord(raw) && typeof raw['at'] === 'string' && typeof raw['origin'] === 'string' ? (raw as unknown as Cors) : undefined;
};

/** Headers a browser sends cross-origin without asking first (the CORS-safelisted ones). */
const SAFELISTED_HEADERS: ReadonlySet<string> = new Set(['accept', 'accept-language', 'content-language', 'range']);

/** Verbs a browser sends cross-origin without the server listing them. */
const SAFELISTED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST']);

/**
 * A browser's request its server's CORS settings refuse (MDN, the `cors`
 * middleware's defaults): credentials sent to a server answering `*`, or one
 * not sending `Access-Control-Allow-Credentials: true` (`cors-credentials`);
 * a header, or the `Content-Type` of a JSON body, its `allowedHeaders` leaves
 * out (`cors-header-not-allowed`); a verb its `methods` leave out
 * (`cors-method-not-allowed`). Judged on the services that enable CORS - a
 * browser on another origin is what they are set for - each setting where it
 * was read.
 */
export const corsMismatches = (db: GraphDb): Promoted[] => {
  const out: Promoted[] = [];
  const evidence = (cors: Cors): string => `the service enables CORS at ${cors.at}, for a browser on another origin, and the setting was read`;
  for (const repo of db.nodesByType('repo').sort((a, b) => byText(a.id, b.id))) {
    const cors = corsOf(repo);
    if (cors === undefined) continue;
    const service = repo.repo;
    const routes = db
      .nodesByType('entry', 'http')
      .filter((route) => route.repo === service)
      .sort((a, b) => byText(a.id, b.id));
    const seen = new Set<string>();
    for (const route of routes) {
      for (const edge of db.edgesTo(route.id, ['hits'])) {
        const request = db.node(edge.from);
        if (request === undefined || request.type !== 'ui_api_call' || seen.has(request.id)) continue;
        seen.add(request.id);
        const loc = nodeLoc(request);
        const base = {
          id: request.id,
          service: request.repo,
          ...(loc === undefined ? {} : { loc }),
          precision: 'high' as const,
          nearest: [route.id],
          to: route.id,
        };
        const credentials = isRecord(request.meta?.[CREDENTIALS_META]) ? (request.meta[CREDENTIALS_META] as { at?: string; via?: string }) : undefined;
        if (credentials !== undefined) {
          const from = credentials.via === 'call' || credentials.at === undefined ? '' : ` (every request gets them at ${credentials.at})`;
          if (cors.credentials === 'unread' || cors.origin === 'unread') {
            out.push({ held: { kind: 'cors-credentials', id: request.id, why: `the CORS settings at ${cors.at} are not read whole` } });
          } else if (cors.origin === '*') {
            out.push({
              finding: {
                ...base,
                kind: 'cors-credentials',
                message: `${sentBy(db, request)} sends credentials${from} to ${service}, whose CORS answers any origin with *: the browser blocks the answer`,
                evidence: evidence(cors),
                fix: "allow the front end's origin by name (origin: [...], or true to echo it) with credentials: true",
                ...metBy(db, request.id),
              },
            });
          } else if (cors.credentials === false) {
            out.push({
              finding: {
                ...base,
                kind: 'cors-credentials',
                message: `${sentBy(db, request)} sends credentials${from} to ${service}, whose CORS does not send Access-Control-Allow-Credentials: true: the browser blocks the answer`,
                evidence: evidence(cors),
                fix: 'add credentials: true to the CORS settings, or send the request without credentials',
                ...metBy(db, request.id),
              },
            });
          }
        }
        const allowed = cors.allowedHeaders;
        if (allowed !== undefined) {
          const json = request.meta?.[SENDS_JSON_META] === true;
          const asked = [
            ...new Set([
              ...(Array.isArray(request.meta?.[HEADERS_META]) ? (request.meta[HEADERS_META] as string[]) : []).filter(
                (header) => !SAFELISTED_HEADERS.has(header) && header !== 'content-type',
              ),
              ...(json ? ['content-type'] : []),
            ]),
          ].sort(byText);
          if (allowed === 'unread') {
            if (asked.length > 0) out.push({ held: { kind: 'cors-header-not-allowed', id: request.id, why: `the headers the CORS settings at ${cors.at} allow are not read` } });
          } else {
            const refused = asked.filter((header) => !allowed.includes(header));
            if (refused.length > 0) {
              out.push({
                finding: {
                  ...base,
                  kind: 'cors-header-not-allowed',
                  message: `${sentBy(db, request)} sets ${refused.map((header) => (header === 'content-type' && json ? 'Content-Type: application/json (its JSON body)' : header)).join(', ')}, which ${service}'s CORS does not allow (it allows ${allowed.join(', ') || 'none'}): the browser's preflight fails`,
                  evidence: evidence(cors),
                  fix: `add ${refused.join(', ')} to allowedHeaders, or leave allowedHeaders out to allow what the browser asks for`,
                  ...metBy(db, request.id),
                },
              });
            }
          }
        }
        const methods = cors.methods;
        const verb = String(request.meta?.['method'] ?? '').toUpperCase();
        if (methods !== undefined && verb !== '' && !SAFELISTED_METHODS.has(verb)) {
          if (methods === 'unread') {
            out.push({ held: { kind: 'cors-method-not-allowed', id: request.id, why: `the verbs the CORS settings at ${cors.at} allow are not read` } });
          } else if (!methods.includes(verb)) {
            out.push({
              finding: {
                ...base,
                kind: 'cors-method-not-allowed',
                message: `${sentBy(db, request)} uses ${verb}, which ${service}'s CORS does not allow (it allows ${methods.join(', ')}): the browser's preflight fails`,
                evidence: evidence(cors),
                fix: `add ${verb} to methods`,
                ...metBy(db, request.id),
              },
            });
          }
        }
      }
    }
  }
  return out;
};

/** Every mismatch this module says, in one list, for the findings to rank (P388). */
export const boundaryMismatches = (db: GraphDb, all: readonly AnchoredUnresolvedRow[]): Promoted[] => [
  ...streamEventMismatches(db),
  ...botButtonMismatches(db, all),
  ...configMismatches(db, all),
  ...statusMismatches(db, all),
  ...corsMismatches(db),
];
