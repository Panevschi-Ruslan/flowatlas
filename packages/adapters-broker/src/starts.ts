import { builtinModules } from 'node:module';
import { STARTED } from '@flowatlas/aws';
import {
  AWAITING_META,
  ENVELOPE_META,
  forwardedFrom,
  makeDeployedReference,
  makeLeafId,
  originsOf,
  REACHES_META,
  SITE_LEAF_TYPES,
  STARTS_META,
  type AwaitedAddress,
  type CallPattern,
  type Confidence,
  type LocatorContext,
  type StartedEntry,
  type TypeRef,
  packageOfSpecifier,
} from '@flowatlas/core';
import type { Holder, PassContext } from '@flowatlas/extract-scopes';
import { Node, type CallExpression, type Node as TsNode, type ParameterDeclaration, type SourceFile } from 'ts-morph';
import { addressOf, collapsed, messageValue, readAddress, readWritten, type AddressedElement } from './address.js';
import { STARTING_CLIENTS, type StartingClient } from './adapters/aws.js';
import type { BrokerSpec } from './adapters/types.js';
import type { ReceiverEvidence } from './call-site.js';
import { isResolved } from './channel-name.js';
import { rowAbout, type RowSite } from './row-site.js';
import { importOf } from './stated-origin.js';

/**
 * Calls that start something by the name it is deployed under (P24).
 *
 * A start is read by the reader that reads a publish, through the same
 * patterns, locators and address: what differs is what the address names. A
 * publish names a channel, which anyone may take from; a start names exactly
 * one workflow or one function, which the deployment owns. So the call is drawn
 * as a producer holding a reference to that entry (`meta.reaches`), and the
 * linker joins it by name across services, exactly as it joins a workflow's
 * step to the function the step invokes.
 *
 * Where the name is a parameter of the function the call is written in - a
 * helper whose source is read - it is decided by whoever calls the helper, and
 * is read at each of those calls instead, the way a request made inside a
 * shared client belongs to whoever asked for it.
 */

/** A pattern that starts something, as the reader is handed one. */
export type StartPattern = CallPattern & { readonly starts: StartedEntry };

export const isStartPattern = (pattern: CallPattern): pattern is StartPattern => pattern.starts !== undefined;

const lineColOf = (node: TsNode): { line: number; column: number } =>
  node.getSourceFile().getLineAndColumnAtPos(node.getStart());

/** What one element of the address names, once a `names` table has had its say. */
type Named =
  | { readonly names: readonly string[]; readonly declared: boolean }
  | { readonly unread: AddressedElement };

/**
 * The deployed names an element reaches.
 *
 * What the code says is looked up in the table first - the value it reads as,
 * or the expression as written, which is all there is when the value cannot be
 * read - and a name found there is somebody's statement. A name the table does
 * not hold is the name as read, which is a name only where it was read.
 */
const namedBy = (element: AddressedElement, table: Readonly<Record<string, string>> = {}): Named => {
  const { resolution, written } = element;
  const stated = (said: string | undefined): string | undefined =>
    said !== undefined && Object.hasOwn(table, said) ? table[said] : undefined;
  const byWriting = stated(written);
  if (byWriting !== undefined) return { names: [byWriting], declared: true };
  if (!isResolved(resolution)) return { unread: element };
  const names = resolution.names.map((name) => stated(name) ?? name);
  return { names, declared: resolution.names.some((name) => stated(name) !== undefined) };
};

const NOUNS: Readonly<Record<StartedEntry['entry'], string>> = { workflow: 'workflow', invoke: 'function' };

const isBuiltin = (specifier: string): boolean =>
  specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0] ?? specifier);

/**
 * A package a binding is imported from whose source nothing here reads: one
 * that is not installed at all, or one installed with its declared types only.
 */
interface UnreadPackage {
  readonly pkg: string;
  /** Where it is declared, when it is installed: declaration files, never source. */
  readonly declarations: readonly TsNode[];
}

const unreadPackageOf = (binding: TsNode): UnreadPackage | undefined => {
  if (!Node.isIdentifier(binding)) return undefined;
  const imported = importOf(binding);
  if (imported === undefined || isBuiltin(imported.module)) return undefined;
  const pkg = packageOfSpecifier(imported.module);
  if (pkg === undefined) return undefined;
  const symbol = binding.getSymbol();
  const declarations = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
  return declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile()) ? { pkg, declarations } : undefined;
};

const absentPackageOf = (binding: TsNode): string | undefined => {
  const unread = unreadPackageOf(binding);
  return unread !== undefined && unread.declarations.length === 0 ? unread.pkg : undefined;
};

/**
 * Whether an argument names something the way a start names what it starts: a
 * string written out, or a member of an enum - one this repository declares,
 * or one from a package that is not here, which is all that can be said of it.
 */
const namesSomething = (argument: TsNode): boolean => {
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) return true;
  if (!Node.isPropertyAccessExpression(argument)) return false;
  const declaration = argument.getSymbol()?.getDeclarations()[0];
  if (declaration !== undefined) return Node.isEnumMember(declaration);
  return absentPackageOf(argument.getExpression()) !== undefined;
};

/** The binding a call is made through, and the function it calls, as the package exports it. */
const calleeOf = (call: CallExpression): { binding: TsNode; fn: string } => {
  const callee = call.getExpression();
  if (Node.isPropertyAccessExpression(callee)) return { binding: callee.getExpression(), fn: callee.getName() };
  return { binding: callee, fn: importOf(callee)?.exported ?? callee.getText() };
};

/** Where in its arguments a call names something: an argument, or one key inside a record written out. */
const namedIn = (call: CallExpression): { index: number; key?: string; said: TsNode } | undefined => {
  for (const [index, argument] of call.getArguments().entries()) {
    if (namesSomething(argument)) return { index, said: argument };
    if (!Node.isObjectLiteralExpression(argument)) continue;
    for (const property of argument.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const value = property.getInitializer();
      if (value !== undefined && namesSomething(value)) return { index, key: property.getName().replace(/^['"]|['"]$/g, ''), said: value };
    }
  }
  return undefined;
};

/** A name a record's id is read as: `id`, `runId`, `execution_id`, an `arn`. */
const ID_NAME = /^(?:id|arn)$|(?:Id|ID|_id|Arn|ARN)$/;

/**
 * An id this call is handed that the same package produced earlier in the
 * body: `start({ runId: run.id })` after `const run = await create(...)`, both
 * from one package. The shape of a helper that records what to start in one
 * call and starts it in the next.
 */
const earlierRecord = (call: CallExpression, pkg: string): { producer: CallExpression; value: TsNode } | undefined => {
  for (const origin of originsOf(call)) {
    const last = origin.read.at(-1);
    if (last === undefined || !ID_NAME.test(last)) continue;
    if (unreadPackageOf(calleeOf(origin.call).binding)?.pkg === pkg) return { producer: origin.call, value: origin.value };
  }
  return undefined;
};

/** How far into a package's declaration files a reader looks for the client they reach. */
const MOST_DECLARATION_FILES = 16;

/**
 * The SDK client that starts something which a declaration file reaches:
 * imported by it, or by a file it imports from within its own package.
 */
const clientReachedFrom = (start: SourceFile): StartingClient | undefined => {
  const seen = new Set<SourceFile>();
  const queue = [start];
  while (queue.length > 0 && seen.size < MOST_DECLARATION_FILES) {
    const file = queue.shift() as SourceFile;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const statement of [...file.getImportDeclarations(), ...file.getExportDeclarations()]) {
      const module = statement.getModuleSpecifierValue();
      if (module === undefined) continue;
      const named = Node.isImportDeclaration(statement)
        ? statement.getNamedImports().map((each) => each.getName())
        : statement.getNamedExports().map((each) => each.getName());
      const client = STARTING_CLIENTS.find(
        (each) => module === each.package || module === each.v2.module || (module === each.v2.package && named.includes(each.v2.name)),
      );
      if (client !== undefined) return client;
      const next = module.startsWith('.') ? statement.getModuleSpecifierSourceFile() : undefined;
      if (next !== undefined) queue.push(next);
    }
  }
  return undefined;
};

/** Each declaration file's answer, once: every call through an installed package asks it again. */
const reached = new WeakMap<SourceFile, StartingClient | null>();

/** The SDK client that starts something which a package's declared types reach. */
const startingClientOf = (declarations: readonly TsNode[]): StartingClient | undefined => {
  for (const declaration of declarations) {
    const file = declaration.getSourceFile();
    if (!reached.has(file)) reached.set(file, clientReachedFrom(file) ?? null);
    const client = reached.get(file);
    if (client) return client;
  }
  return undefined;
};

/** Why a call into a package nothing reads looks like a start, and what it would start. */
interface StartLook {
  readonly why: string;
  readonly target: StartedEntry['entry'];
}

/**
 * What makes a call into a package nothing here reads look like a start, in
 * order: the first shape that holds is the row, and a call none holds is not
 * one. A call handed a string or an enum member is not a shape of its own:
 * error builders, response mappers and code converters are handed exactly
 * that, and start nothing.
 *
 * An earlier record is asked only of a package that is not installed. One
 * installed with its types is more often a vendor's client, whose
 * create-then-act pairs are not starts; what says one is, there, is a client
 * that starts things in its types.
 */
const START_SHAPES: readonly {
  readonly installed: boolean;
  readonly look: (call: CallExpression, unread: UnreadPackage) => StartLook | undefined;
}[] = [
  {
    installed: false,
    look: (call, { pkg }) => {
      const record = earlierRecord(call, pkg);
      if (record === undefined) return undefined;
      return {
        why: `it is handed ${record.value.getText().slice(0, 60)}, read off what ${calleeOf(record.producer).fn} returned earlier in the same body`,
        target: 'workflow',
      };
    },
  },
  {
    installed: true,
    look: (_call, { declarations }) => {
      const client = startingClientOf(declarations);
      if (client === undefined) return undefined;
      return {
        why: `the types it is declared with reach ${client.client}, which ${client.entry === 'workflow' ? 'starts workflows' : 'invokes functions'}`,
        target: client.entry,
      };
    },
  },
];

/** The first shape that holds of a call, among those asked of its package. */
const lookOf = (call: CallExpression, unread: UnreadPackage): StartLook | undefined => {
  const installed = unread.declarations.length > 0;
  for (const shape of START_SHAPES) {
    const look = shape.installed === installed ? shape.look(call, unread) : undefined;
    if (look !== undefined) return look;
  }
  return undefined;
};

/**
 * The description a row offers: where the name is written, read off an earlier
 * record where the call is handed one, and a `names` entry for what is written
 * there when it is not a string.
 */
const descriptionOf = (call: CallExpression, pkg: string, fn: string, target: StartedEntry['entry']): Record<string, unknown> => {
  const record = earlierRecord(call, pkg);
  const named = namedIn(record?.producer ?? call);
  const path = named?.key === undefined ? [] : [named.key];
  const locator =
    record !== undefined
      ? { kind: 'origin-call-argument', call: calleeOf(record.producer).fn, path, ...(named?.index ? { index: named.index } : {}) }
      : named?.key !== undefined
        ? { kind: 'argument-property', index: named.index, key: named.key }
        : { kind: 'argument', index: named?.index ?? 0 };
  const said = named?.said;
  const literal = said === undefined || Node.isStringLiteral(said) || Node.isNoSubstitutionTemplateLiteral(said);
  return {
    module: pkg,
    function: fn,
    target,
    name: [locator],
    ...(literal ? {} : { names: { [said.getText()]: '<deployed name>' } }),
  };
};

export interface StartReader {
  /** Draws a call a pattern says starts something, wherever its name is decided. */
  read(call: CallExpression, pattern: StartPattern, spec: BrokerSpec, holder: Holder, context: LocatorContext, evidence: ReceiverEvidence): void;
  /** Says which helper to describe, for a call no pattern matched that has the shape of a start. */
  notice(call: CallExpression, holder: Holder): void;
}

/** The parameter of the function a call is written in that a value is, when it is one. */
const parameterOf = (value: TsNode): ParameterDeclaration | undefined => {
  const declaration = Node.isIdentifier(value) ? value.getSymbol()?.getDeclarations()[0] : undefined;
  return declaration !== undefined && Node.isParameterDeclaration(declaration) ? declaration : undefined;
};

/**
 * The reader of starts for one repository.
 *
 * `holderAt` is the body a call elsewhere in the repository is written in,
 * for a name read where a helper's caller wrote it.
 */
export const startReader = (ctx: PassContext, holderAt: (site: TsNode) => Holder | undefined): StartReader => {
  /** The kind the call is recorded as: the pattern's, unless the call says otherwise where the pattern looks. */
  const kindOf = (call: CallExpression, pattern: StartPattern, context: LocatorContext): string => {
    const fallback = pattern.kind ?? pattern.starts.entry;
    const at = pattern.starts.kindAt;
    if (at === undefined) return fallback;
    const said = collapsed(readAddress(call, [{ at: at.at }], undefined, context, ctx.config, ''));
    return isResolved(said) ? (at.kinds[said.name] ?? fallback) : fallback;
  };

  /** One start, drawn at the call that decides what it starts. */
  const record = (
    site: CallExpression,
    elements: readonly AddressedElement[],
    holder: Holder,
    pattern: StartPattern,
    kind: string,
    spec: BrokerSpec,
    evidence: ReceiverEvidence,
    payload: TypeRef | undefined,
  ): void => {
    const { starts } = pattern;
    const { line, column } = lineColOf(site);
    const file = holder.file;
    const named = elements.map((element) => namedBy(element, starts.names));
    const names = [...new Set(named.flatMap((each) => ('names' in each ? each.names : [])))];
    const declared = named.some((each) => 'names' in each && each.declared);
    const unread = named.flatMap((each) => ('unread' in each ? [each.unread] : []));
    const awaiting: AwaitedAddress[] = unread.flatMap((element) => (element.awaiting === undefined ? [] : [{ parts: element.awaiting }]));
    // The call is what the code says it is; the name is the code's, unless a
    // table someone wrote gave it.
    const confidence: Confidence = evidence !== 'checked' ? 'heuristic' : declared ? 'declared' : 'static';
    const id = makeLeafId('producer', ctx.repo, file, line, column);
    holder.ensure();
    ctx.builder.addNode({
      id,
      type: 'producer',
      label: `${kind} ${names.length > 0 ? names.join(', ') : '?'}`,
      repo: ctx.repo,
      file,
      line,
      kind,
      meta: {
        kind,
        adapter: spec.name,
        method: pattern.method,
        [STARTS_META]: starts.entry,
        // What the started workflow or function is handed, and how it is
        // handed it, so the two can be compared like a message and its handler.
        [ENVELOPE_META]: STARTED[starts.entry],
        ...(payload === undefined ? {} : { payload }),
        confidence,
        ...(names.length === 0 ? {} : { [REACHES_META]: names.map((name) => makeDeployedReference(starts.entry, name)) }),
        ...(awaiting.length === 0 ? {} : { [AWAITING_META]: awaiting }),
      },
    });
    ctx.builder.addEdge({
      from: holder.id,
      to: id,
      type: 'calls',
      confidence: names.length === 0 || evidence !== 'checked' ? 'heuristic' : 'static',
      file,
      line,
    });
    const noun = NOUNS[starts.entry];
    const at: RowSite = { named: ctx.builder.getNode(holder.id)?.label ?? holder.id, node: id };
    const reported = new Set<string>();
    for (const element of unread) {
      const key = JSON.stringify(element.resolution);
      if (reported.has(key) || isResolved(element.resolution)) continue;
      reported.add(key);
      const { variable, text } = element.resolution;
      ctx.report(
        element.awaiting !== undefined && variable !== undefined
          ? {
              file,
              line,
              reason: 'start-from-environment',
              hint:
                `The ${noun} this starts is the value of the environment variable ${variable}, set where the code is deployed and not in it. ` +
                'Where a function whose deployment is read runs this code, it is completed from the value that function is deployed with and this row goes.',
              ...rowAbout(at, text),
              meta: { variable },
            }
          : {
              file,
              line,
              reason: 'start-name-unread',
              hint:
                `The name of the ${noun} this starts is not written where it can be read. Write the deployed name or its ARN, or a value of the environment the deployment sets; ` +
                'where the code names it some other way, say how in the `names` table of a starter description.',
              ...rowAbout(at, text),
            },
      );
    }
  };

  const read: StartReader['read'] = (call, pattern, spec, holder, context, evidence) => {
    const kind = kindOf(call, pattern, context);
    const { line, column } = lineColOf(call);
    if (pattern.starts.resumes === true) {
      // A token names a run that is waiting, and no workflow: a leaf, and no join.
      const id = makeLeafId('producer', ctx.repo, holder.file, line, column);
      holder.ensure();
      ctx.builder.addNode({
        id,
        type: 'producer',
        label: kind,
        repo: ctx.repo,
        file: holder.file,
        line,
        kind,
        meta: { kind, adapter: spec.name, method: pattern.method, resumes: pattern.starts.entry },
      });
      ctx.builder.addEdge({ from: holder.id, to: id, type: 'calls', confidence: evidence === 'checked' ? 'static' : 'heuristic', file: holder.file, line });
      return;
    }
    const parts = addressOf(pattern);
    const elements = readAddress(call, parts, pattern.payload, context, ctx.config, call.getText().slice(0, 60));
    const [only] = elements;
    const [part] = parts;
    // What the call hands over, read where it is written: past `JSON.stringify`,
    // and, where it is a parameter of a helper, at each call of the helper.
    const message = elements.find((element) => element.payload !== undefined)?.payload;
    const payloadOf = (value: TsNode | undefined): TypeRef | undefined => {
      const ref = value === undefined ? undefined : ctx.types.collectType(value.getType(), value);
      return ref === 'any' || ref === 'unknown' ? undefined : ref;
    };
    const handedIn = message === undefined ? undefined : parameterOf(message);
    if (elements.length === 1 && only?.parameter !== undefined && part !== undefined) {
      const forwarded = forwardedFrom(only.parameter);
      const passed = handedIn === undefined ? [] : forwardedFrom(handedIn).calls;
      let recorded = 0;
      for (const hop of forwarded.calls) {
        const owner = holderAt(hop.site);
        if (owner === undefined || !Node.isCallExpression(hop.site)) continue;
        const argument = passed.find((each) => each.site === hop.site)?.argument;
        const payload = handedIn === undefined ? payloadOf(message) : payloadOf(argument === undefined ? undefined : messageValue(argument));
        record(hop.site, [readWritten(hop.argument, part, ctx.config)], owner, pattern, kind, spec, evidence, payload);
        recorded += 1;
      }
      // A call that may run this function and may run another decides
      // nothing anyone can attribute, so the call here still answers for it.
      if (recorded > 0 && !forwarded.undecided) return;
    }
    record(call, elements, holder, pattern, kind, spec, evidence, payloadOf(message));
  };

  // What the doctor row below needs, worked out once and only if it is asked.
  let deployed: ReadonlySet<string> | undefined;
  let drawn: ReadonlySet<string> | undefined;
  const asked = new Set<string>();

  /**
   * A call from a deployed function into a package whose source is not read,
   * of a shape that starts something (`START_SHAPES`): a start nobody has
   * described. One row per package and function, carrying the description to
   * write - not an edge, because what the helper does is exactly what cannot
   * be read.
   */
  const notice: StartReader['notice'] = (call, holder) => {
    deployed ??= new Set(
      ctx.builder.edges.filter((edge) => edge.type === 'handles' && ctx.builder.getNode(edge.from)?.kind === 'invoke').map((edge) => edge.to),
    );
    if (!deployed.has(holder.id)) return;
    const { binding, fn } = calleeOf(call);
    const unread = unreadPackageOf(binding);
    if (unread === undefined) return;
    const { pkg } = unread;
    const key = `${pkg}\0${fn}`;
    if (asked.has(key)) return;
    const look = lookOf(call, unread);
    if (look === undefined) return;
    const installed = unread.declarations.length > 0;
    const { line } = lineColOf(call);
    // A call another reader already drew - a request, a query - is not unread.
    drawn ??= new Set(
      ctx.builder.nodes
        .filter((node) => (SITE_LEAF_TYPES as readonly string[]).includes(node.type))
        .map((node) => `${node.file}:${node.line}`),
    );
    if (drawn.has(`${holder.file}:${line}`)) return;
    asked.add(key);
    const description = descriptionOf(call, pkg, fn, look.target);
    const other = look.target === 'workflow' ? '`"target": "invoke"` for a function' : '`"target": "workflow"` for a workflow';
    ctx.report({
      file: holder.file,
      line,
      reason: 'starter-undescribed',
      hint:
        `${pkg} is ${installed ? 'installed with its declared types only' : 'not installed'}, so what ${fn} does is not read. It is called from a deployed function and ${look.why}. ` +
        `If it starts a workflow or invokes a function by its deployed name, describe it under adapters.starters as ${JSON.stringify(description)} (${other}); ` +
        (installed ? 'or make its source readable here, as a member of the workspace, so the call inside it is read.' : 'or install the package, so its source is read.'),
      symbol: `${pkg} ${fn}`,
      meta: { package: pkg, function: fn, description },
    });
  };

  return { read, notice };
};
