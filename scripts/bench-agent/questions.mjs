/**
 * The questions, made concrete from the key (P238).
 *
 * `questions.yaml` holds the templates; this picks each one's subject from the
 * key and works out the expected answer from the key alone. Candidates are
 * taken a service at a time, round the services, so `index` 0, 1, 2 land in
 * different services rather than in the first one listed.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
// The workspace's own YAML reader, resolved through the package that depends on it.
const { parse } = createRequire(join(ROOT, 'packages', 'core', 'package.json'))('yaml');

export const QUESTIONS_FILE = join(HERE, 'questions.yaml');

/** How each scorer asks for its answer, said the same way to every arm. */
export const ANSWER_FORMATS = {
  symbols: 'End your answer with one line of the form ANSWER: ["Class.method", ...], with an empty list if there are none.',
  files: 'End your answer with one line of the form ANSWER: ["path/to/File.tsx", ...], with an empty list if there are none.',
  routes: 'End your answer with one line of the form ANSWER: ["GET /path/:id", ...], with an empty list if there are none.',
  exact: 'End your answer with one line of the form ANSWER: "<value>".',
  yesno: 'End your answer with one line: ANSWER: "yes" or ANSWER: "no".',
  // P392: a file named with its repository, as the workspace lays the repositories side by side.
  paths: 'End your answer with one line of the form ANSWER: ["repository/path/to/file.ts", ...], each path starting with its repository\'s folder, with an empty list if there are none.',
  names: 'End your answer with one line of the form ANSWER: ["NAME", ...], with an empty list if there are none.',
};

export const readTemplates = (path = QUESTIONS_FILE) => parse(readFileSync(path, 'utf8')).questions;

/** Candidates a service at a time: the first of each service, then the second of each. */
const spread = (items, serviceOf) => {
  const byService = new Map();
  for (const item of items) byService.set(serviceOf(item), [...(byService.get(serviceOf(item)) ?? []), item]);
  const out = [];
  for (let round = 0; out.length < items.length; round += 1) {
    for (const list of byService.values()) if (list[round] !== undefined) out.push(list[round]);
  }
  return out;
};

const declared = (route) => `${route.method} ${route.path}`;

/** How an action is said once done: `approve` -> `approved` (P392). */
const DONE = { archive: 'archived', approve: 'approved', publish: 'published', lock: 'locked', restore: 'restored', verify: 'verified', export: 'exported', merge: 'merged' };

/**
 * A route's new name for a change task (P392), changed where its own
 * declaration says it, so the controller's or router's prefix stays: an
 * action becomes its noun, a create gains `/new`.
 */
const NOUN = { archive: 'archival', approve: 'approval', publish: 'publication', lock: 'locking', restore: 'restoration', verify: 'verification', export: 'exportation', merge: 'merging' };
const renamedPath = (route) => (NOUN[verbOf(route)] === undefined ? `${route.path}/new` : route.path.replace(new RegExp(`${verbOf(route)}$`), NOUN[verbOf(route)]));

/** A route's verb, its handler's method: `findOne`, `create`, an action. */
const verbOf = (route) => route.handler.split('.')[1];
/** The class that does a route's work: `OrdersNotesController` -> `OrdersNotesService`. */
const workerOf = (route) => `${route.handler.split('.')[0].replace(/(Controller|Routes)$/, '')}Service`;

/** A file as an answer names it: its repository, then its path there. */
const inRepo = (key, service, file) => `${key.services.find((each) => each.name === service)?.repo ?? service}/${file}`;

/** What a rename touches, for a change task: the declaring file and every caller's (P392). */
const routeFiles = (key, route) => [...new Set([inRepo(key, route.service, route.file), ...route.callers.map((caller) => inRepo(key, caller.service, caller.file))])].sort();

/** Each subject: its candidates, what fills the prompt, the expected answer, and where it is asked from. */
const SUBJECTS = {
  'called-backend-route': (key) => {
    const candidates = key.routes.filter((route) => route.service !== 'gateway' && route.callers.length > 0);
    // Routes two services call first: the answer is in more than one place.
    const ranked = [...candidates.filter((route) => new Set(route.callers.map((caller) => caller.service)).size > 1), ...candidates.filter((route) => new Set(route.callers.map((caller) => caller.service)).size === 1)];
    return spread(ranked, (route) => route.service).map((route) => ({
      fill: { route: declared(route), service: route.service },
      from: route.service,
      expected: [...new Set(route.callers.map((caller) => caller.symbol))].sort(),
    }));
  },
  'called-gateway-route': (key) => {
    const candidates = key.routes.filter((route) => route.service === 'gateway' && route.callers.length > 0);
    const ranked = [...candidates.filter((route) => route.callers.length > 1), ...candidates.filter((route) => route.callers.length === 1)];
    return spread(ranked, (route) => route.backend.split(':')[0]).map((route) => ({
      fill: { route: declared(route), service: 'gateway' },
      from: 'gateway',
      expected: [...new Set(route.callers.map((caller) => caller.symbol))].sort(),
    }));
  },
  'route-with-screens': (key) => {
    const screensOf = (route) =>
      [...new Set(key.routes.filter((each) => each.backend === route.id).flatMap((each) => each.callers.map((caller) => `${caller.service}/${caller.screen}`)))].sort();
    const candidates = key.routes.filter((route) => route.service !== 'gateway' && screensOf(route).length > 0);
    const ranked = [...candidates.filter((route) => screensOf(route).length > 1), ...candidates.filter((route) => screensOf(route).length === 1)];
    return spread(ranked, (route) => route.service).map((route) => ({
      fill: { route: declared(route), service: route.service },
      from: route.service,
      expected: screensOf(route),
    }));
  },
  'heard-event': (key) => {
    const heard = key.events.filter((event) => event.consumers.length > 0);
    const ranked = [...heard.filter((event) => event.consumers.length > 1), ...heard.filter((event) => event.consumers.length === 1)];
    return spread(ranked, (event) => event.publisher.service).map((event) => ({
      fill: { event: event.name, service: event.publisher.service },
      from: event.publisher.service,
      expected: event.consumers.map((consumer) => `${consumer.className}.${consumer.method}`).sort(),
    }));
  },
  'unheard-event': (key) =>
    key.events
      .filter((event) => event.unheard === true)
      .map((event) => ({ fill: { event: event.name, service: event.publisher.service }, from: event.publisher.service, expected: [] })),
  'backend-of-kind': (key, template) =>
    key.services
      .filter((service) => service.kind === template.of && service.name !== 'gateway')
      .map((service) => ({
        fill: { service: service.name },
        from: service.name,
        expected: key.routes.filter((route) => route.service === service.name && route.callers.length === 0).map(declared).sort(),
      })),
  'renamed-field': (key) => fieldSubjects(key, (field) => field.sent.join() !== field.read.join(), 'no'),
  'kept-field': (key) => fieldSubjects(key, (field) => field.sent.join() === field.read.join(), 'yes'),
  'client-via': (key, template) => {
    const clients = new Map();
    for (const call of key.calls.filter((each) => each.from.service === 'gateway' && each.via === template.via)) {
      clients.set(call.from.symbol.split('.')[0], call.to.split(':')[0]);
    }
    return spread([...clients], ([, service]) => service).map(([client, service]) => ({ fill: { client }, from: 'gateway', expected: service }));
  },
  'service-class': (key) => {
    const classes = new Map();
    for (const method of key.methods.filter((each) => hasClasses(key, each.service))) {
      classes.set(method.className, [...(classes.get(method.className) ?? []), method]);
    }
    return spread([...classes], ([, methods]) => methods[0].service).map(([className, methods]) => ({
      fill: { class: className, service: methods[0].service },
      from: methods[0].service,
      expected: methods.filter((method) => method.writes).map((method) => `${className}.${method.method}`).sort(),
    }));
  },
  constant: (key) =>
    spread(key.constants, (constant) => constant.service).map((constant) => ({ fill: { name: constant.name, service: constant.service }, from: constant.service, expected: String(constant.value) })),
  'write-method': (key, template) =>
    spread(
      key.methods.filter((method) => hasClasses(key, method.service) && method.writes && method.retries === template.retries),
      (method) => method.service,
    ).map((method) => ({ fill: { method: `${method.className}.${method.method}`, service: method.service }, from: method.service, expected: template.retries ? 'yes' : 'no' })),
  // P392, find the bug: a defect the model planted, the twins an answer is marked down for, and what it takes to see it.
  'planted-defect': (key, template) =>
    key.defects
      .filter((defect) => defect.id === template.defect)
      .map((defect) => ({ fill: { service: defect.service ?? defect.from }, from: defect.from, expected: defect.expected, decoys: defect.decoys, context: defect.context })),
  // P392, a change task: every file a rename of a route touches, in every repository, called from two places first.
  'renamed-route-files': (key, template) => {
    const candidates = key.routes.filter(
      (route) => route.method === 'POST' && route.service !== 'gateway' && key.services.find((each) => each.name === route.service)?.kind === template.of && route.callers.length > 0,
    );
    const ranked = [...candidates.filter((route) => new Set(route.callers.map((caller) => caller.service)).size > 1), ...candidates.filter((route) => new Set(route.callers.map((caller) => caller.service)).size === 1)];
    return ranked.map((route) => ({
      fill: { route: declared(route), renamed: `${route.method} ${renamedPath(route)}`, service: route.service },
      from: route.service,
      expected: routeFiles(key, route),
    }));
  },
  // P392, a change task: every file a rename of an event touches, the publisher's and each handler's, heard twice first.
  'renamed-event-files': (key) => {
    const heard = key.events.filter((event) => event.consumers.length > 0 && event.publisher.file !== undefined);
    const ranked = [...heard.filter((event) => event.consumers.length > 1), ...heard.filter((event) => event.consumers.length === 1)];
    return spread(ranked, (event) => event.publisher.service).map((event) => ({
      fill: { event: event.name, renamed: `${event.name}.v2`, service: event.publisher.service },
      from: event.publisher.service,
      expected: [...new Set([inRepo(key, event.publisher.service, event.publisher.file), ...event.consumers.map((consumer) => inRepo(key, consumer.service, consumer.file))])].sort(),
    }));
  },
  // P392, fuzzy navigation: where a record is changed by an action, said as it is done, with no service named.
  'action-method': (key) => {
    const actions = key.routes.filter((route) => DONE[verbOf(route)] !== undefined && hasClasses(key, route.service) && route.service !== 'gateway');
    const writing = actions.filter((route) => key.methods.some((method) => method.service === route.service && method.className === workerOf(route) && method.method === verbOf(route) && method.writes));
    return spread(writing, (route) => route.service).map((route) => {
      return {
        fill: { records: route.path.split('/')[1], done: DONE[verbOf(route)] },
        from: 'gateway',
        expected: [`${workerOf(route)}.${verbOf(route)}`],
      };
    });
  },
};

/** The subjects the questions had before P392, asked of the key without the planted pieces, so each keeps its subject and its answer. */
const BEFORE = new Set(['called-backend-route', 'called-gateway-route', 'route-with-screens', 'heard-event', 'unheard-event', 'backend-of-kind', 'renamed-field', 'kept-field', 'client-via', 'service-class', 'constant', 'write-method', 'action-method', 'renamed-route-files', 'renamed-event-files']);
const withoutPlanted = (key) => ({ ...key, routes: key.routes.filter((route) => route.planted !== true), events: key.events.filter((event) => event.planted !== true) });

/** Services whose code has the classes the methods are on: the Lambda functions have none. */
const hasClasses = (key, service) => ['nestjs', 'express'].includes(key.services.find((each) => each.name === service)?.kind);

const fieldSubjects = (key, keep, answer) =>
  key.fields.filter(keep).map((field) => {
    const route = key.routes.find((each) => each.id === field.route);
    return { fill: { caller: field.caller, route: declared(route), service: route.service }, from: 'gateway', expected: answer };
  });

const filled = (prompt, fill) => prompt.replace(/\{(\w+)\}/g, (whole, name) => (fill[name] === undefined ? whole : fill[name]));

/** Every question of the templates, made concrete against one key. A template with no such subject is an error: the key cannot answer it. */
export const questionsFor = (key, templates = readTemplates()) => {
  const plain = withoutPlanted(key);
  return templates.map((template) => {
    const subjects = SUBJECTS[template.subject]?.(BEFORE.has(template.subject) ? plain : key, template);
    if (subjects === undefined) throw new Error(`${template.id}: no subject named ${template.subject}`);
    const subject = subjects[template.index];
    if (subject === undefined) throw new Error(`${template.id}: ${template.subject} has ${subjects.length} candidates, none at index ${template.index}`);
    const repo = key.services.find((service) => service.name === subject.from)?.repo ?? subject.from;
    return {
      id: template.id,
      kind: template.kind,
      group: template.group,
      pilot: template.pilot === true,
      scorer: template.scorer,
      from: repo,
      prompt: `${filled(template.prompt, subject.fill)}\n\n${ANSWER_FORMATS[template.scorer]}`,
      expected: subject.expected,
      // Find the bug (P392): the twins, marked as false positives when named, and what it takes to see the defect.
      ...(subject.decoys === undefined ? {} : { decoys: subject.decoys }),
      ...(subject.context === undefined ? {} : { context: subject.context }),
    };
  });
};
