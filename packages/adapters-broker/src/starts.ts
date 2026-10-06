import { builtinModules } from 'node:module';
import {
  AWAITING_META,
  forwardedFrom,
  makeDeployedReference,
  makeLeafId,
  REACHES_META,
  SITE_LEAF_TYPES,
  STARTS_META,
  type AwaitedAddress,
  type CallPattern,
  type Confidence,
  type LocatorContext,
  type StartedEntry,
  packageOfSpecifier,
} from '@flowatlas/core';
import type { Holder, PassContext } from '@flowatlas/extract-scopes';
import { Node, type CallExpression, type Node as TsNode } from 'ts-morph';
import { addressOf, collapsed, readAddress, readWritten, type AddressedElement } from './address.js';
import type { BrokerSpec } from './adapters/types.js';
import type { ReceiverEvidence } from './call-site.js';
import { isResolved } from './channel-name.js';
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

/** The package a binding is imported from, when it is one nothing here can open. */
const absentPackageOf = (binding: TsNode): string | undefined => {
  if (!Node.isIdentifier(binding)) return undefined;
  const imported = importOf(binding);
  if (imported === undefined || isBuiltin(imported.module)) return undefined;
  const pkg = packageOfSpecifier(imported.module);
  if (pkg === undefined) return undefined;
  const symbol = binding.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return (target?.getDeclarations().length ?? 0) === 0 ? pkg : undefined;
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

export interface StartReader {
  /** Draws a call a pattern says starts something, wherever its name is decided. */
  read(call: CallExpression, pattern: StartPattern, spec: BrokerSpec, holder: Holder, context: LocatorContext, evidence: ReceiverEvidence): void;
  /** Says which helper to describe, for a call no pattern matched that has the shape of a start. */
  notice(call: CallExpression, holder: Holder): void;
}

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
              symbol: `${id} -> ${text.slice(0, 60)}`,
              meta: { variable },
            }
          : {
              file,
              line,
              reason: 'start-name-unread',
              hint:
                `The name of the ${noun} this starts is not written where it can be read. Write the deployed name or its ARN, or a value of the environment the deployment sets; ` +
                'where the code names it some other way, say how in the `names` table of a starter description.',
              symbol: `${id} -> ${text.slice(0, 60)}`,
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
    const elements = readAddress(call, parts, undefined, context, ctx.config, call.getText().slice(0, 60));
    const [only] = elements;
    const [part] = parts;
    if (elements.length === 1 && only?.parameter !== undefined && part !== undefined) {
      const forwarded = forwardedFrom(only.parameter);
      let recorded = 0;
      for (const hop of forwarded.calls) {
        const owner = holderAt(hop.site);
        if (owner === undefined || !Node.isCallExpression(hop.site)) continue;
        record(hop.site, [readWritten(hop.argument, part, ctx.config)], owner, pattern, kind, spec, evidence);
        recorded += 1;
      }
      // A call that may run this function and may run another decides
      // nothing anyone can attribute, so the call here still answers for it.
      if (recorded > 0 && !forwarded.undecided) return;
    }
    record(call, elements, holder, pattern, kind, spec, evidence);
  };

  // What the doctor row below needs, worked out once and only if it is asked.
  let deployed: ReadonlySet<string> | undefined;
  let drawn: ReadonlySet<string> | undefined;
  const asked = new Set<string>();

  /**
   * A call into a package that is not here, from a deployed function, handed a
   * name: the shape of a start nobody has described. One row per package and
   * function, carrying the description to write - not an edge, because what
   * the helper does is exactly what cannot be read.
   */
  const notice: StartReader['notice'] = (call, holder) => {
    deployed ??= new Set(
      ctx.builder.edges.filter((edge) => edge.type === 'handles' && ctx.builder.getNode(edge.from)?.kind === 'invoke').map((edge) => edge.to),
    );
    if (!deployed.has(holder.id)) return;
    const callee = call.getExpression();
    const binding = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
    const pkg = absentPackageOf(binding);
    if (pkg === undefined) return;
    const fn = Node.isPropertyAccessExpression(callee) ? callee.getName() : (importOf(binding)?.exported ?? callee.getText());
    const key = `${pkg}\0${fn}`;
    if (asked.has(key)) return;
    const index = call.getArguments().findIndex(namesSomething);
    if (index < 0) return;
    const { line } = lineColOf(call);
    // A call another reader already drew - a request, a query - is not unread.
    drawn ??= new Set(
      ctx.builder.nodes
        .filter((node) => (SITE_LEAF_TYPES as readonly string[]).includes(node.type))
        .map((node) => `${node.file}:${node.line}`),
    );
    if (drawn.has(`${holder.file}:${line}`)) return;
    asked.add(key);
    const argument = call.getArguments()[index] as TsNode;
    const literal = Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument);
    const description = {
      module: pkg,
      function: fn,
      target: 'workflow',
      name: [{ kind: 'argument', index }],
      ...(literal ? {} : { names: { [argument.getText()]: '<deployed name>' } }),
    };
    ctx.report({
      file: holder.file,
      line,
      reason: 'starter-undescribed',
      hint:
        `${pkg} is not installed, so what ${fn} does is not read, and it is called from a deployed function with ${argument.getText().slice(0, 60)}. ` +
        `If it starts a workflow or invokes a function by its deployed name, describe it under adapters.starters as ${JSON.stringify(description)} ` +
        '(`"target": "invoke"` for a function); or install the package, so its source is read.',
      symbol: `${pkg} ${fn}`,
      meta: { package: pkg, function: fn, description },
    });
  };

  return { read, notice };
};
