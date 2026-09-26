import { forEachCall } from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { localClient, VERB_CALLS, type RequestClient } from '../clients.js';

/**
 * Whether a class this repository declares is one of its HTTP clients.
 *
 * A class wrapping `fetch` behind `get` and `post` is the ordinary way to write
 * a front end, and until now the browser side of this tool had no way to be told
 * so and no way to work it out — which is why a repository writing all ninety-seven
 * of its requests through one such class produced two request nodes, both of them
 * incidental bare `fetch` calls somewhere else (R87).
 *
 * Two answers are possible and they are not exclusive, so both are here.
 *
 * **Recognising it.** A class is a client when one of its own verb-named members
 * reaches the network — through a client already described, or through another
 * member of the same class that does. That is evidence rather than a name: a
 * cache with `get` and `delete` reaches nothing, and is not read as a client
 * however it is named. The chain is followed because that is how these classes
 * are written — `post` calls `deduplicate`, which calls `fetch`, which calls the
 * browser's — and each link is a member of one class, so following it costs one
 * walk over one declaration and never leaves the file.
 *
 * **Declaring it.** {@link localClientOf} is handed the names a project wrote
 * under `adapters.frontend.localClientClasses`, and a class it names is a client
 * whatever the walk found. Recognition is better when it works and worse when it
 * guesses; declaring always works and nobody writes it. So the reader recognises
 * where it can, obeys the configuration where it is given, and — the part that
 * is not optional either way — says out loud where it can see a client-shaped
 * class and cannot prove it, instead of producing the silence this whole batch
 * is about.
 */
export interface ClassReading {
  /** Whether a body reaches the network through a client already described. */
  reaches(body: TsNode): boolean;
  /** Class names a project declared as its own clients, and their subclasses. */
  declared: readonly string[];
}

/** What reading a local class made of it. */
export type LocalClientReading =
  /** The class is a client, and these are the verbs it answers to. */
  | { readonly kind: 'client'; readonly client: RequestClient; readonly via: 'declared' | 'recognised' }
  /**
   * The class is spelled like a client and could not be proved to be one.
   *
   * It declares the verb that was called, and no path from that verb to a
   * transport could be followed — a helper module in between, a base class whose
   * source is elsewhere, a transport handed to the constructor, dependencies
   * that are not installed. Where it really is a client, the request is real and
   * its address is written at the call site; what is missing is permission to
   * believe it, and that is a sentence for a person to read rather than a guess
   * for this reader to make.
   */
  | { readonly kind: 'unread'; readonly typeName: string }
  /** Nothing about the class suggests a client, which is nearly every class. */
  | undefined;

/** How far a verb is followed through a class's own members before giving up. */
const MEMBER_DEPTH = 4;

/**
 * The body of every member of a class that has one, by the member's name.
 *
 * Both spellings, because both are ordinary and the commonest client classes in
 * the wild use the second: `post(path, body) { … }` is a method, and
 * `post = (path, body) => …` is a property holding an arrow, which is what a
 * class written to be passed around as an instance uses so that `this` survives
 * being torn off. Private members are included — the hop from `post` to a
 * private `send` is exactly the hop that has to be followed.
 */
const memberBodiesOf = (cls: ClassDeclaration): Map<string, TsNode> => {
  const bodies = new Map<string, TsNode>();
  for (const member of cls.getMembers()) {
    if (Node.isMethodDeclaration(member)) {
      const body = member.getBody();
      if (body !== undefined) bodies.set(member.getName(), body);
      continue;
    }
    if (!Node.isPropertyDeclaration(member)) continue;
    const written = member.getInitializer();
    if (written === undefined) continue;
    if (Node.isArrowFunction(written) || Node.isFunctionExpression(written)) {
      bodies.set(member.getName(), written.getBody());
    }
  }
  return bodies;
};

/** The member of this class a `this.something(…)` call names, when it names one. */
const memberCalled = (call: TsNode): string | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  return Node.isThisExpression(callee.getExpression()) ? callee.getName() : undefined;
};

/**
 * Whether a body reaches the network, directly or through the class it is in.
 *
 * The depth limit and the set of names already seen are both needed: a client
 * class routinely has two members calling each other — `post` defers to
 * `deduplicate`, which on one branch calls `fetch` and on another calls `post`
 * back — and without the set that pair never terminates.
 */
const reachesNetwork = (
  body: TsNode,
  members: ReadonlyMap<string, TsNode>,
  reading: ClassReading,
  seen: ReadonlySet<string>,
  depth: number,
): boolean => {
  if (reading.reaches(body)) return true;
  if (depth >= MEMBER_DEPTH) return false;
  let found = false;
  // The same walk the request pass makes, and for the same reason it is not a
  // walk over descendants: `get = (path) => this.send(path, 'GET')` is a body
  // that *is* the call, so the one call in it is not a descendant of anything.
  forEachCall(body, (node) => {
    if (found) return;
    const name = memberCalled(node);
    if (name === undefined || seen.has(name)) return;
    const next = members.get(name);
    if (next === undefined) return;
    found = reachesNetwork(next, members, reading, new Set([...seen, name]), depth + 1);
  });
  return found;
};

/** Every class in an extends chain, the one written first. */
const chainOf = (cls: ClassDeclaration): ClassDeclaration[] => {
  const chain: ClassDeclaration[] = [];
  for (let at: ClassDeclaration | undefined = cls; at !== undefined; at = at.getBaseClass()) {
    if (chain.includes(at)) break;
    chain.push(at);
  }
  return chain;
};

/**
 * Verb-named members of a class and of every class it extends that can be read.
 *
 * Keyed by the verb rather than by the member, so the name is folded the same way
 * the request pass folds the name at a call site and the two cannot disagree.
 */
const verbMembersOf = (chain: readonly ClassDeclaration[]): Map<string, TsNode> => {
  const verbs = new Map<string, TsNode>();
  for (const cls of chain) {
    for (const [name, body] of memberBodiesOf(cls)) {
      const verb = name.toLowerCase();
      if (verb in VERB_CALLS && !verbs.has(verb)) verbs.set(verb, body);
    }
  }
  return verbs;
};

/**
 * What one class declared in this repository turns out to be.
 *
 * Asked of the class a receiver's type resolved to, and answering with a
 * description the request pass reads exactly as it reads `axios` — which is the
 * point of answering with one rather than with a special case.
 */
export const localClientOf = (
  cls: ClassDeclaration,
  reading: ClassReading,
): LocalClientReading => {
  const chain = chainOf(cls);
  const typeName = cls.getName();
  if (typeName === undefined) return undefined;
  const verbs = verbMembersOf(chain);

  const named = chain.some((link) => {
    const name = link.getName();
    return name !== undefined && reading.declared.includes(name);
  });
  if (named) {
    // A project that named the class has settled the question, so nothing is
    // asked about how the verbs reach the network — that is what naming it is
    // for. A class whose verbs are inherited from a base nobody here can read
    // declares none of its own, and answering with no verbs at all would make
    // the configuration a line that changed nothing; every verb is the honest
    // reading of "this class is the client".
    const answered = verbs.size > 0 ? [...verbs.keys()] : Object.keys(VERB_CALLS);
    return { kind: 'client', client: localClient(typeName, answered), via: 'declared' };
  }

  if (verbs.size === 0) return undefined;

  const members = new Map<string, TsNode>();
  for (const link of chain) {
    for (const [name, body] of memberBodiesOf(link)) if (!members.has(name)) members.set(name, body);
  }

  const proved = [...verbs]
    .filter(([name, body]) => reachesNetwork(body, members, reading, new Set([name]), 0))
    .map(([name]) => name);
  if (proved.length > 0) {
    return { kind: 'client', client: localClient(typeName, proved), via: 'recognised' };
  }

  // A class declaring the verbs of a client, whose verbs this reader could not
  // follow to a transport. It may well not be a client — a store with `get` and
  // `delete` lands here — and the row says so as a question rather than as a
  // finding. Producing nothing was the alternative, and producing nothing is the
  // defect: a request through a wrapper nobody described is exactly what the
  // whole of this batch is about, and one sentence naming the class is what
  // turns it into a line of configuration somebody can write.
  return { kind: 'unread', typeName };
};
