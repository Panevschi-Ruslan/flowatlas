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
};

/** Services whose code has the classes the methods are on: the Lambda functions have none. */
const hasClasses = (key, service) => ['nestjs', 'express'].includes(key.services.find((each) => each.name === service)?.kind);

const fieldSubjects = (key, keep, answer) =>
  key.fields.filter(keep).map((field) => {
    const route = key.routes.find((each) => each.id === field.route);
    return { fill: { caller: field.caller, route: declared(route), service: route.service }, from: 'gateway', expected: answer };
  });

const filled = (prompt, fill) => prompt.replace(/\{(\w+)\}/g, (whole, name) => (fill[name] === undefined ? whole : fill[name]));

/** Every question of the templates, made concrete against one key. A template with no such subject is an error: the key cannot answer it. */
export const questionsFor = (key, templates = readTemplates()) =>
  templates.map((template) => {
    const subjects = SUBJECTS[template.subject]?.(key, template);
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
    };
  });
