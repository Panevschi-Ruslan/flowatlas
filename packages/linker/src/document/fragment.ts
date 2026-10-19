/**
 * One operation out of a written document, with exactly the parts of the
 * document it uses (P118): for a tool that answers about one route and a
 * prompt that hands one on, where the whole document would be most of the
 * answer and none of the question.
 */
import type { SpecOperation, WrittenSpec } from './written.js';

const at = (document: unknown, pointer: readonly string[]): unknown => {
  let found = document;
  for (const step of pointer) {
    if (found === null || typeof found !== 'object') return undefined;
    found = (found as Record<string, unknown>)[step];
  }
  return found;
};

/** Every local `$ref` a value makes, as the keys from the top of the document. */
const refsIn = (value: unknown, out: string[][] = []): string[][] => {
  if (Array.isArray(value)) {
    for (const item of value) refsIn(item, out);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ref' && typeof item === 'string' && item.startsWith('#/')) out.push(item.slice(2).split('/').map((step) => step.replace(/~1/g, '/').replace(/~0/g, '~')));
    else refsIn(item, out);
  }
  return out;
};

const put = (into: Record<string, unknown>, pointer: readonly string[], value: unknown): void => {
  let node = into;
  for (const step of pointer.slice(0, -1)) {
    const next = (node[step] ?? {}) as Record<string, unknown>;
    node[step] = next;
    node = next;
  }
  node[pointer[pointer.length - 1] as string] = value;
};

/**
 * A document holding one operation and what it refers to, followed to the end:
 * an OpenAPI path item with that verb, or an AsyncAPI operation with its
 * channel and message, and the components either reaches. Keys keep the
 * document's order.
 */
export const specFragment = (spec: WrittenSpec, operation: SpecOperation): Record<string, unknown> => {
  const fragment: Record<string, unknown> = {};
  const head = spec.kind === 'openapi' ? 'openapi' : 'asyncapi';
  fragment[head] = spec.document[head];
  put(fragment, operation.pointer, at(spec.document, operation.pointer));
  const seen = new Set<string>([operation.pointer.join('/')]);
  let frontier = refsIn(at(spec.document, operation.pointer));
  while (frontier.length > 0) {
    const next: string[][] = [];
    for (const pointer of frontier) {
      const key = pointer.join('/');
      if (seen.has(key)) continue;
      seen.add(key);
      const value = at(spec.document, pointer);
      if (value === undefined) continue;
      put(fragment, pointer, value);
      next.push(...refsIn(value));
    }
    frontier = next;
  }
  return fragment;
};

/**
 * The operation a person or an agent names: `GET /orders/{id}`, `get
 * /orders/:id`, `/orders/{id}` (every verb of it), a channel's address, or an
 * operation's key. Several when a path has several verbs.
 */
export const findOperations = (spec: WrittenSpec, asked: string): SpecOperation[] => {
  const said = asked.trim();
  const exact = spec.operations.filter((operation) => operation.key === said || operation.node === said);
  if (exact.length > 0) return exact;
  const [maybeVerb = '', ...rest] = said.split(/\s+/);
  const verb = rest.length > 0 && /^[A-Za-z]+$/.test(maybeVerb) ? maybeVerb.toUpperCase() : undefined;
  const path = rest.length > 0 && verb !== undefined ? rest.join(' ') : said;
  const route = path.replace(/\{[^}/]*\}|:[^/]+/g, ':param').replace(/\/+$/, '') || '/';
  return spec.operations.filter((operation) => {
    if (operation.kind === 'http') {
      const written = operation.route ?? '';
      const cut = written.indexOf(':');
      return written.slice(cut + 1) === route && (verb === undefined || written.slice(0, cut) === verb);
    }
    const address = operation.channel?.replace(/^channel:/, '');
    return address === path && (verb === undefined || verb === operation.kind.toUpperCase());
  });
};
