import type { CallExpression, ClassDeclaration, Node as TsNode, Project } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';

/**
 * A stream's frames handed on through a subject (P362).
 *
 * A screen seldom holds its `EventSource` itself. A service of the front end's
 * own opens it, pushes each frame into a subject - `this._event$.next(data)` -
 * and exposes the subject as an observable (`readonly event$ =
 * this._event$.asObservable()`, a getter, or the subject itself left public).
 * The screens subscribe to that, through the service they are handed or the
 * one instance a module makes, often through operators first:
 * `this.stream.event$.pipe(filter(…), takeUntil(…)).subscribe(() => this.load())`.
 * The function the frames arrive at is then the service's, which chooses
 * nothing; the screens that do are a subscription away.
 *
 * This follows that subscription, for every reader of a screen alike: from
 * the function a stream's frames arrive at, to the subjects it pushes them
 * into (in place, or one method of its own deep), to what exposes each, to
 * every `subscribe` on it in the repository, past `pipe` and `asObservable`.
 * Each is a function its reader records as one more consumer of the stream.
 * A subject pushed into that nothing subscribes to is said so; a service that
 * nothing injects or makes is said too, since its stream is never opened and
 * nothing subscribed to it ever runs.
 */

/** The methods an observable is handed on through, on its way to a subscription. */
const HANDED_ON: ReadonlySet<string> = new Set(['pipe', 'asObservable']);

/** The method a value is pushed into a subject by. */
const PUSH = 'next';

/** The method a screen subscribes by. */
const SUBSCRIBE = 'subscribe';

/** A class whose instances are subjects: rxjs's `Subject`, `BehaviorSubject`, `ReplaySubject`, and a project's own by that ending. */
const SUBJECT_CLASS = /Subject$/;

const peel = (node: TsNode): TsNode => {
  let at = node;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at) || Node.isSatisfiesExpression(at)) at = at.getExpression();
  return at;
};

/** One subscription to what a stream's frames are pushed into. */
export interface SubjectSubscription {
  /** The `subscribe` call. */
  readonly subscribe: CallExpression;
  /** What it subscribes to, as `Holder.member`: `BoardStreamService.event$`. */
  readonly through: string;
  /** Why it never runs, where the service it subscribes through is made by nothing. */
  readonly unreached?: string;
  /**
   * The first class outside the subject's own the subscription reaches it
   * through: the requests made from it are the ones that feed this
   * subscription, where it makes any - one instance of a generic stream class.
   */
  readonly entry?: ClassDeclaration;
}

/** What a stream's frames are pushed into, and who subscribes. */
export interface SubjectRelay {
  /** The subjects pushed into, as `Holder.member`. */
  readonly subjects: readonly string[];
  readonly subscriptions: readonly SubjectSubscription[];
  /** Why the service holding the subject never runs, where nothing makes it. */
  readonly unreached?: string;
}

/** Whether a declaration holds a subject: made with `new …Subject(…)`, or typed as one. */
const holdsSubject = (declaration: TsNode): boolean => {
  const initializer = Node.isPropertyDeclaration(declaration) || Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  if (initializer !== undefined) {
    const value = peel(initializer);
    if (Node.isNewExpression(value) && SUBJECT_CLASS.test(value.getExpression().getText())) return true;
  }
  const type = declaration.getType();
  const name = type.getSymbol()?.getName() ?? type.getAliasSymbol()?.getName();
  return name !== undefined && SUBJECT_CLASS.test(name);
};

/** The declaration a receiver of `.next(…)` names: a field of the class it is written in, or a name declared in its module. */
const subjectDeclarationOf = (receiver: TsNode, owner: ClassDeclaration | undefined): TsNode | undefined => {
  const at = peel(receiver);
  if (Node.isPropertyAccessExpression(at) && Node.isThisExpression(peel(at.getExpression()))) {
    const field = owner?.getProperty(at.getName());
    return field !== undefined && holdsSubject(field) ? field : undefined;
  }
  if (Node.isIdentifier(at)) {
    const declaration = at.getSymbol()?.getDeclarations()[0];
    if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
    // A subject made inside a function lives as long as one call of it; only one a module or class holds is subscribed to elsewhere.
    if (declaration.getFirstAncestor((each) => Node.isFunctionLikeDeclaration(each) || Node.isArrowFunction(each)) !== undefined) return undefined;
    return holdsSubject(declaration) ? declaration : undefined;
  }
  return undefined;
};

/** The functions a handler's work is done in: itself, and a method of its own class it calls on `this`, one call deep. */
const bodiesOf = (handler: TsNode, owner: ClassDeclaration | undefined): TsNode[] => {
  const bodies = [handler];
  if (owner === undefined) return bodies;
  for (const call of handler.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = peel(call.getExpression());
    if (!Node.isPropertyAccessExpression(callee) || !Node.isThisExpression(peel(callee.getExpression()))) continue;
    const method = owner.getMethod(callee.getName());
    const body = method?.getBody();
    if (body !== undefined && !bodies.includes(body)) bodies.push(body);
  }
  return bodies;
};

/** The subjects a handler pushes what it is handed into. */
export const subjectsPushedBy = (handler: TsNode, owner: ClassDeclaration | undefined): TsNode[] => {
  const found: TsNode[] = [];
  for (const body of bodiesOf(handler, owner)) {
    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = peel(call.getExpression());
      if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== PUSH || call.getArguments().length === 0) continue;
      const declaration = subjectDeclarationOf(callee.getExpression(), owner);
      if (declaration !== undefined && !found.includes(declaration)) found.push(declaration);
    }
  }
  return found;
};

/** Whether a node refers to one of the declarations given: `this.field`, or a name. */
const refersTo = (node: TsNode, declarations: readonly TsNode[]): boolean => {
  if (Node.isPropertyAccessExpression(node) || Node.isIdentifier(node)) {
    const name = Node.isPropertyAccessExpression(node) ? node.getNameNode() : node;
    const declaration = name.getSymbol()?.getDeclarations()[0];
    return declaration !== undefined && declarations.includes(declaration);
  }
  return false;
};

/** The name a member or a name is known by. */
const nameOfDeclaration = (declaration: TsNode): string =>
  (declaration as unknown as { getName?: () => string | undefined }).getName?.() ?? declaration.getText().slice(0, 40);

/** One way the subject is reached: a declaration whose value is it, or is made of what reaches it. */
interface Exposure {
  readonly declaration: TsNode;
  /** The class it is a member of, or the file it is declared in, by name. */
  readonly holder: string;
  /**
   * The first class outside the subject's own that the way passes through,
   * where it does: a wrapper holding one instance of a generic stream class
   * (`private readonly stream = new LiveStream<T>()`) and re-exposing its
   * observable, whose own requests are the ones feeding this instance.
   */
  readonly entry?: ClassDeclaration;
  /** Why it never runs: the subject's class, or a class re-exposing it, is made by nothing. */
  readonly unreached?: string;
}

/** The class a node is written in, where it is. */
const classAround = (node: TsNode): ClassDeclaration | undefined => node.getFirstAncestor((each): each is ClassDeclaration => Node.isClassDeclaration(each));

/**
 * The declaration a reference to a way of reaching the subject gives its value
 * to, where it re-exposes it: a field initialised with it, a field assigned it
 * in the class, a getter or a method handed nothing that answers with it, a
 * name of the module - past casts, `!`, `asObservable()` and `pipe(…)`.
 */
const reExposedBy = (reference: TsNode): TsNode | undefined => {
  let at: TsNode = reference;
  for (let step = 0; step < 8; step += 1) {
    const parent = at.getParent();
    if (parent === undefined) return undefined;
    if (Node.isParenthesizedExpression(parent) || Node.isNonNullExpression(parent) || Node.isAsExpression(parent) || Node.isSatisfiesExpression(parent)) {
      at = parent;
      continue;
    }
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === at && HANDED_ON.has(parent.getName())) {
      const call = parent.getParent();
      if (call === undefined || !Node.isCallExpression(call) || call.getExpression() !== parent) return undefined;
      at = call;
      continue;
    }
    if (Node.isPropertyDeclaration(parent) && parent.getInitializer() === at) return parent;
    if (Node.isVariableDeclaration(parent) && parent.getInitializer() === at) {
      // Only a name a module holds lives past one call.
      return parent.getFirstAncestor((each) => Node.isFunctionLikeDeclaration(each) || Node.isArrowFunction(each)) === undefined ? parent : undefined;
    }
    if (Node.isBinaryExpression(parent) && parent.getRight() === at && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
      const left = peel(parent.getLeft());
      if (!Node.isPropertyAccessExpression(left) || !Node.isThisExpression(peel(left.getExpression()))) return undefined;
      return classAround(parent)?.getProperty(left.getName());
    }
    if (Node.isReturnStatement(parent) || (Node.isArrowFunction(parent) && parent.getBody() === at)) {
      const fn = parent.getFirstAncestor((each) => Node.isFunctionLikeDeclaration(each) || Node.isArrowFunction(each));
      if (fn !== undefined && Node.isGetAccessorDeclaration(fn)) return fn;
      if (fn !== undefined && Node.isMethodDeclaration(fn) && fn.getParameters().length === 0) return fn;
      return undefined;
    }
    return undefined;
  }
  return undefined;
};

/** The `subscribe` a reference to an exposure ends in, past `pipe` and `asObservable`, with each `pipe` on the way. */
const subscriptionFrom = (reference: TsNode): CallExpression | undefined => {
  let at: TsNode = reference;
  // A method that answers with the subject is called to get it: `stream.events()`.
  const called = at.getParent();
  if (called !== undefined && Node.isCallExpression(called) && called.getExpression() === at) at = called;
  for (let step = 0; step < 8; step += 1) {
    let parent = at.getParent();
    while (parent !== undefined && (Node.isParenthesizedExpression(parent) || Node.isNonNullExpression(parent) || Node.isAsExpression(parent))) {
      at = parent;
      parent = parent.getParent();
    }
    if (parent === undefined || !Node.isPropertyAccessExpression(parent) || parent.getExpression() !== at) return undefined;
    const call = parent.getParent();
    if (call === undefined || !Node.isCallExpression(call) || call.getExpression() !== parent) return undefined;
    if (parent.getName() === SUBSCRIBE) return call;
    if (!HANDED_ON.has(parent.getName())) return undefined;
    at = call;
  }
  return undefined;
};

/** Whether a source file is the repository's own code. */
const ownSource = (path: string, repoDir: string): boolean =>
  !path.includes('/node_modules/') && !path.endsWith('.d.ts') && path.replace(/\\/g, '/').startsWith(repoDir.replace(/\\/g, '/'));

/**
 * Why a class is never made, where nothing makes it: no constructor of the
 * repository is handed it, no `inject(…)` asks for it, no `new` builds it, and
 * no list of providers or `useClass` names it. Undefined where something does.
 */
export const classNeverMade = (declaration: ClassDeclaration, project: Project, repoDir: string): string | undefined => {
  const name = declaration.getName();
  if (name === undefined) return undefined;
  for (const source of project.getSourceFiles()) {
    if (!ownSource(source.getFilePath(), repoDir) || !source.getFullText().includes(name)) continue;
    for (const identifier of source.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier.getText() !== name || identifier.getParent() === declaration) continue;
      const symbol = identifier.getSymbol();
      const target = (symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol)?.getDeclarations()[0];
      if (target !== declaration) continue;
      const parent = identifier.getParent();
      if (parent === undefined) continue;
      if (Node.isNewExpression(parent) && parent.getExpression() === identifier) return undefined;
      if (Node.isCallExpression(parent) && parent.getArguments()[0] === identifier) return undefined;
      if (Node.isArrayLiteralExpression(parent) || Node.isPropertyAssignment(parent)) return undefined;
      // `constructor(private readonly stream: BoardStreamService)`
      const parameter = identifier.getFirstAncestor((each) => Node.isParameterDeclaration(each));
      if (parameter !== undefined && Node.isParameterDeclaration(parameter) && Node.isConstructorDeclaration(parameter.getParent())) return undefined;
    }
  }
  return `nothing injects or makes ${name}: no constructor is handed it, no inject() asks for it and no new builds it`;
};

/**
 * Every subscription to what the function a stream's frames arrive at pushes
 * them into. `handler` is the function as written (an arrow in place, or a
 * method); `owner` the class it belongs to, where it is a method of one.
 *
 * What reaches the subject is followed as far as it is handed on (P362): a
 * member of the subject's class made of it, and on from there a member of
 * another class made of that - `getCardUpdates() { return this.stream.event$
 * as Observable<CardEvt>; }`, `readonly events$ = this.stream.events$` - to
 * every `subscribe` on any of them.
 */
export const subjectRelayOf = (handler: TsNode, owner: ClassDeclaration | undefined, project: Project, repoDir: string): SubjectRelay => {
  const subjects = subjectsPushedBy(handler, owner);
  if (subjects.length === 0) return { subjects: [], subscriptions: [] };
  const holder = owner?.getName() ?? handler.getSourceFile().getBaseNameWithoutExtension();
  const unreached = owner === undefined ? undefined : classNeverMade(owner, project, repoDir);
  const exposures: Exposure[] = subjects.map((declaration) => ({ declaration, holder, ...(unreached === undefined ? {} : { unreached }) }));
  const neverMade = new Map<ClassDeclaration, string | undefined>();
  const madeBy = (declaration: ClassDeclaration): string | undefined => {
    if (!neverMade.has(declaration)) neverMade.set(declaration, classNeverMade(declaration, project, repoDir));
    return neverMade.get(declaration);
  };
  const sources = project.getSourceFiles().filter((source) => ownSource(source.getFilePath(), repoDir));
  const subscriptions: SubjectSubscription[] = [];
  const seen = new Set<CallExpression>();
  // Each round reads the references to the ways found so far, once.
  for (let round = 0, from = 0; round < 6 && from < exposures.length; round += 1) {
    const current = exposures.slice(from);
    from = exposures.length;
    const declarations = current.map((each) => each.declaration);
    const names = new Set(declarations.map(nameOfDeclaration));
    for (const source of sources) {
      const text = source.getFullText();
      if (![...names].some((name) => text.includes(name))) continue;
      source.forEachDescendant((node) => {
        const parent = node.getParent();
        const isMemberName = parent !== undefined && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node;
        const name = Node.isPropertyAccessExpression(node) ? node.getName() : Node.isIdentifier(node) && !isMemberName ? node.getText() : undefined;
        if (name === undefined || !names.has(name) || !refersTo(node, declarations)) return;
        const exposure = current.find((each) => refersTo(node, [each.declaration]));
        if (exposure === undefined) return;
        const around = classAround(node);
        const entry = exposure.entry ?? (around !== undefined && around !== owner ? around : undefined);
        const subscribe = subscriptionFrom(node);
        if (subscribe !== undefined) {
          if (seen.has(subscribe)) return;
          seen.add(subscribe);
          subscriptions.push({
            subscribe,
            through: `${exposure.holder}.${nameOfDeclaration(exposure.declaration)}`,
            ...(entry === undefined ? {} : { entry }),
            ...(exposure.unreached === undefined ? {} : { unreached: exposure.unreached }),
          });
          return;
        }
        const next = reExposedBy(node);
        if (next === undefined || exposures.some((each) => each.declaration === next)) return;
        const nextClass = classAround(next);
        const nextUnreached = exposure.unreached ?? (nextClass !== undefined && nextClass !== owner ? madeBy(nextClass) : undefined);
        const nextEntry = exposure.entry ?? (nextClass !== undefined && nextClass !== owner ? nextClass : undefined);
        exposures.push({
          declaration: next,
          holder: nextClass?.getName() ?? next.getSourceFile().getBaseNameWithoutExtension(),
          ...(nextEntry === undefined ? {} : { entry: nextEntry }),
          ...(nextUnreached === undefined ? {} : { unreached: nextUnreached }),
        });
      });
    }
  }
  subscriptions.sort((a, b) =>
    a.subscribe.getSourceFile().getFilePath() < b.subscribe.getSourceFile().getFilePath()
      ? -1
      : a.subscribe.getSourceFile().getFilePath() > b.subscribe.getSourceFile().getFilePath()
        ? 1
        : a.subscribe.getStart() - b.subscribe.getStart(),
  );
  return { subjects: subjects.map((subject) => `${holder}.${nameOfDeclaration(subject)}`), subscriptions, ...(unreached === undefined ? {} : { unreached }) };
};
