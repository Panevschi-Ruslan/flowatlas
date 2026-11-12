import type { EntryAdapter, EntryHandler, EntryNode, ExtractContext } from '@flowatlas/core';
import { declarationOf, evaluateExpression, hasAnyDependency, makeEntryId, packageOfSpecifier, startLineOf } from '@flowatlas/core';
import type { CallExpression, Node as TsNode, ObjectLiteralExpression } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { fileOfNode, handlerOfFunction, inlineHandlerOf, repoFunctionOf, repoSources, unwrapValue } from './shared.js';
import { unwrapWork } from './wrapped-work.js';

const ADAPTER = 'mcp-server';

/** The SDKs an MCP server is written with, any one of which turns the reader on. */
const MCP_PACKAGES = ['@modelcontextprotocol/sdk', '@modelcontextprotocol/server'];

/** The class whose methods register what a client may ask for. */
const SERVER_CLASS = 'McpServer';

/** The class a resource read by a family of URIs is registered with (P277). */
const TEMPLATE_CLASS = 'ResourceTemplate';

type Primitive = 'tool' | 'prompt' | 'resource';

/**
 * What a client of an MCP server calls by name, and the method that registers
 * each: a tool it calls, a prompt it gets, a resource it reads. The name is
 * the first argument and the function that answers is the last, in the older
 * spelling (`tool(name, description?, schema?, cb)`) and the newer
 * (`registerTool(name, config, cb)`) alike.
 *
 * A `Map`, because it is asked about every method called on a server, and a
 * plain object answers `toString` with the language's own value (R130).
 */
const PRIMITIVES: ReadonlyMap<string, Primitive> = new Map([
  ['tool', 'tool'],
  ['registerTool', 'tool'],
  ['prompt', 'prompt'],
  ['registerPrompt', 'prompt'],
  ['resource', 'resource'],
  ['registerResource', 'resource'],
]);

/** The member of a definition a registration dispatches to, written `defineX({...}).handler(fn)` or `{ handler }`. */
const HANDLER_MEMBER = 'handler';

/**
 * An MCP server's tools, prompts and resources (P270).
 *
 * A client - an assistant, an editor, another service - connects to the
 * server and asks for one of these by the name it was registered under, with
 * arguments the registration describes. That is a way in exactly as a
 * procedure of a tree is: a named thing a caller asks for, over a transport
 * the server was handed, with code behind it. So each is an `rpc` entry keyed
 * `mcp:<kind>:<name>`, with the function that answers it as its handler; a
 * resource is keyed by the URI a client reads it with (P277), a template's
 * URI a pattern every URI it matches reaches. Each carries `meta.call`, the
 * kind, so the procedure join matches a client's `callTool({ name })` to it
 * (P277) and refuses a tool asked for as a prompt.
 *
 * A registration on anything else is not one: the receiver must be an
 * `McpServer`, by its type where the checker has the SDK, and where it has not
 * by the source - a value made with `new McpServer(...)`, or annotated with
 * the type, imported from the SDK.
 *
 * A name decided at run time is read as far as the source states it (P277).
 * A template over a value - `find${collection}` - is a pattern named by its
 * written parts, with a row saying which part the run decides. A member of a
 * record - `registerTool(item.wireName, ...)` in a loop over a registry - is
 * read from the records the repository writes with that member as text beside
 * the definition the registration dispatches to (the member of the same value
 * the registration reads: `item.tool`), each definition a way in with its
 * handler behind it, as sure as the guess that the run registers it; the row
 * at the registration stays, saying which names were read and that any other
 * comes from the configuration.
 */
export const mcpServerAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasAnyDependency(pkg, MCP_PACKAGES),
  extractEntries: (ctx) => {
    const entries = new Map<string, EntryNode>();
    const records = recordIndex(ctx);
    for (const sourceFile of repoSources(ctx)) {
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        for (const entry of registrationOf(call, ctx, records)) {
          const known = entries.get(entry.id);
          if (known === undefined) {
            entries.set(entry.id, entry);
            continue;
          }
          // Two registrations dispatching to one definition: both are where it is served.
          const sites = new Set([...registeredAtOf(known), ...registeredAtOf(entry)]);
          known.meta = { ...known.meta, registeredAt: [...sites].sort() };
        }
      }
    }
    return [...entries.values()];
  },
};

const registeredAtOf = (entry: EntryNode): string[] => {
  const sites = entry.meta?.['registeredAt'];
  return Array.isArray(sites) ? sites.filter((site): site is string => typeof site === 'string') : [];
};

/** Whether a name is one of the SDK's classes, by the import that binds it. */
const isSdkClassName = (name: TsNode, className: string): boolean => {
  if (!Node.isIdentifier(name)) return false;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isImportSpecifier(declaration)) continue;
    const statement = declaration.getImportDeclaration();
    const pkg = packageOfSpecifier(statement.getModuleSpecifierValue());
    if (pkg !== undefined && MCP_PACKAGES.includes(pkg) && declaration.getName() === className) return true;
  }
  return false;
};

/** Whether a receiver is an MCP server: by its type, or by how the source made or annotated it. */
const isServer = (receiver: TsNode): boolean => {
  const symbol = receiver.getType().getSymbol();
  if (symbol?.getName() === SERVER_CLASS) {
    const declared = symbol.getDeclarations()[0]?.getSourceFile().getFilePath() ?? '';
    if (declared.includes('/@modelcontextprotocol/')) return true;
  }
  const value = unwrapValue(receiver);
  const declaration = Node.isIdentifier(value)
    ? value.getSymbol()?.getDeclarations()[0]
    : Node.isPropertyAccessExpression(value)
      ? value.getSymbol()?.getDeclarations()[0]
      : undefined;
  if (declaration === undefined) return false;
  if (
    Node.isVariableDeclaration(declaration) ||
    Node.isParameterDeclaration(declaration) ||
    Node.isPropertyDeclaration(declaration)
  ) {
    const annotated = declaration.getTypeNode();
    if (annotated !== undefined && Node.isTypeReference(annotated) && isSdkClassName(annotated.getTypeName(), SERVER_CLASS)) return true;
    const initializer = declaration.getInitializer();
    const made = initializer === undefined ? undefined : unwrapValue(initializer);
    return made !== undefined && Node.isNewExpression(made) && isSdkClassName(made.getExpression(), SERVER_CLASS);
  }
  return false;
};

/** A name as the source writes it: whole, a pattern with the parts the run decides, or nothing. */
type WrittenName =
  | { readonly kind: 'whole'; readonly name: string }
  | { readonly kind: 'pattern'; readonly name: string; readonly decided: readonly string[] };

/** The placeholder a part decided at run time is written as in a pattern key, `find{collection}`. */
const placeholder = (part: TsNode): string => `{${part.getText().replace(/\s+/g, ' ').slice(0, 40)}}`;

/**
 * The name a registration writes (P277): text, or a template whose written
 * parts are text and whose other parts are decided at run time. A template
 * with no written text names nothing.
 */
const writtenNameOf = (written: TsNode): WrittenName | undefined => {
  const evaluated = evaluateExpression(written);
  if (evaluated.resolved && typeof evaluated.value === 'string') return { kind: 'whole', name: evaluated.value };
  const at = unwrapValue(written);
  if (!Node.isTemplateExpression(at)) return undefined;
  let name = at.getHead().getLiteralText();
  let text = name;
  const decided: string[] = [];
  for (const span of at.getTemplateSpans()) {
    const part = span.getExpression();
    const value = evaluateExpression(part);
    if (value.resolved && (typeof value.value === 'string' || typeof value.value === 'number')) {
      name += String(value.value);
      text += String(value.value);
    } else {
      name += placeholder(part);
      decided.push(part.getText());
    }
    name += span.getLiteral().getLiteralText();
    text += span.getLiteral().getLiteralText();
  }
  if (decided.length === 0) return { kind: 'whole', name };
  return text === '' ? undefined : { kind: 'pattern', name, decided };
};

/**
 * The URI a resource is read by (P277): the text of its second argument, or
 * the template a `new ResourceTemplate('orders://{id}', ...)` is made with,
 * which is a pattern already.
 */
const resourceUriOf = (written: TsNode | undefined): WrittenName | undefined => {
  if (written === undefined) return undefined;
  const at = unwrapValue(written);
  if (Node.isNewExpression(at)) {
    const callee = at.getExpression();
    const [template] = at.getArguments();
    if (!(Node.isIdentifier(callee) && (callee.getText() === TEMPLATE_CLASS || isSdkClassName(callee, TEMPLATE_CLASS))) || template === undefined) {
      return undefined;
    }
    const uri = writtenNameOf(template);
    if (uri === undefined) return undefined;
    return /\{[^}]+\}/.test(uri.name) ? { kind: 'pattern', name: uri.name, decided: uri.kind === 'pattern' ? uri.decided : [] } : uri;
  }
  return writtenNameOf(at);
};

/** The handler behind a function or a function written in place, as an entry carries it. */
const handlerOf = (work: TsNode, label: string, ctx: ExtractContext): { handler?: EntryHandler; via: string } => {
  const answer = unwrapWork(work).work;
  const named = repoFunctionOf(answer);
  const handler = named !== undefined ? handlerOfFunction(named, ctx) : inlineHandlerOf(answer, label, ctx);
  return { ...(handler === undefined ? {} : { handler }), via: named !== undefined ? 'function' : handler === undefined ? 'none' : 'inline' };
};

/** The ways in one call registers: none, one, or one per record it registers under a member's name. */
const registrationOf = (call: CallExpression, ctx: ExtractContext, records: RecordIndex): EntryNode[] => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return [];
  const primitive = PRIMITIVES.get(callee.getName());
  if (primitive === undefined) return [];
  const args = call.getArguments();
  if (args.length < 2) return [];
  if (!isServer(callee.getExpression())) return [];
  const file = fileOfNode(call, ctx);
  const line = startLineOf(call);
  const written = args[0] as TsNode;
  const site = `${file}:${line}`;
  const symbol = `${callee.getName()}(${written.getText().slice(0, 40)})`;
  const name = writtenNameOf(written);
  if (name === undefined) {
    const read = fromRecords(call, written, primitive, ctx, records);
    const names = read.map((entry) => String(entry.meta?.[primitive] ?? '')).sort();
    ctx.builder.addUnresolved({
      file,
      line,
      reason: 'mcp-name-dynamic',
      ...(read.length === 0 ? {} : { level: 'info' as const }),
      message:
        read.length === 0
          ? `${callee.getText()}(${written.getText().slice(0, 40)}, ...) registers a ${primitive} under a name decided at run time, so no way in was drawn for it and nothing says which ${primitive}s the server offers.`
          : `${callee.getText()}(${written.getText().slice(0, 40)}, ...) registers each ${primitive} under the name its record carries: ${read.length} read from the records the repository writes (${names.slice(0, 8).join(', ')}${names.length > 8 ? ', ...' : ''}), each drawn where it is defined; whether each is served, and any other name, is decided at run time by the configuration.`,
      hint:
        read.length === 0
          ? `Register each ${primitive} under a name written as text, so a client's request for it can be named and followed.`
          : `Nothing is wrong with the ${primitive}s read. A name the configuration supplies cannot be followed; register it under a name written as text to have it drawn.`,
      symbol,
      adapter: ADAPTER,
    });
    return read;
  }
  const label = `${primitive} ${name.name}`;
  const { handler, via } = handlerOf(args[args.length - 1] as TsNode, label, ctx);
  // A resource is asked for by its URI, and keyed by it where it is written (P277).
  const uri = primitive === 'resource' ? resourceUriOf(args[1]) : undefined;
  const keyed = uri ?? name;
  const key = `mcp:${primitive}:${keyed.name}`;
  if (keyed.kind === 'pattern' && keyed.decided.length > 0) {
    ctx.builder.addUnresolved({
      file,
      line,
      reason: 'mcp-name-dynamic',
      level: 'info',
      message: `${callee.getText()}(${written.getText().slice(0, 40)}, ...) registers a ${primitive} whose ${uri === undefined ? 'name' : 'URI'} is written in part: ${keyed.decided.map((part) => '${' + part + '}').join(' and ')} ${keyed.decided.length === 1 ? 'is' : 'are'} decided at run time, so it is drawn as the pattern ${keyed.name} and a client's request is joined to it by the written parts alone.`,
      hint: `Nothing is wrong. Register it under ${uri === undefined ? 'a name' : 'a URI'} written as text to have each request joined exactly.`,
      symbol,
      adapter: ADAPTER,
    });
  }
  if (primitive === 'resource' && uri === undefined) {
    ctx.builder.addUnresolved({
      file,
      line,
      reason: 'mcp-name-dynamic',
      message: `${callee.getText()}(${written.getText().slice(0, 40)}, ...) registers a resource whose URI is decided at run time, so it is drawn under its name and no client's request, which names the URI, is joined to it.`,
      hint: 'Write the URI as text, or as a ResourceTemplate written as text, so a client reading it can be joined.',
      symbol,
      adapter: ADAPTER,
    });
  }
  return [
    {
      id: makeEntryId(ctx.repo, 'rpc', key),
      kind: 'rpc',
      label,
      key,
      ...(handler === undefined ? {} : { handler }),
      file,
      line,
      meta: {
        key,
        call: primitive,
        [primitive]: name.name,
        primitive,
        ...(uri === undefined ? {} : { uri: uri.name }),
        ...(keyed.kind === 'pattern' ? { keyPattern: uri === undefined ? 'name-template' : 'uri-template' } : {}),
        adapter: ADAPTER,
        registration: `${SERVER_CLASS}.${callee.getName()}`,
        handlerVia: via,
      },
    },
  ];
};

/** One record the repository writes: a member holding a name as text, beside others. */
interface WrittenRecord {
  readonly object: ObjectLiteralExpression;
  readonly name: string;
}

/** The repository's records by the member holding a name as text, read once per member asked about. */
interface RecordIndex {
  withName(member: string): readonly WrittenRecord[];
}

const recordIndex = (ctx: ExtractContext): RecordIndex => {
  const byMember = new Map<string, WrittenRecord[]>();
  let objects: ObjectLiteralExpression[] | undefined;
  return {
    withName: (member) => {
      const known = byMember.get(member);
      if (known !== undefined) return known;
      objects ??= [...repoSources(ctx)].flatMap((source) => source.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression));
      const found: WrittenRecord[] = [];
      for (const object of objects) {
        const property = object.getProperty(member);
        if (property === undefined || !Node.isPropertyAssignment(property)) continue;
        const value = property.getInitializer();
        const text = value === undefined ? undefined : unwrapValue(value);
        if (text === undefined || !(Node.isStringLiteral(text) || Node.isNoSubstitutionTemplateLiteral(text))) continue;
        found.push({ object, name: text.getLiteralText() });
      }
      byMember.set(member, found);
      return found;
    },
  };
};

/** The innermost block or `case` a registration is written in, where the value it reads is taken apart. */
const scopeOf = (call: CallExpression): TsNode | undefined =>
  call.getFirstAncestor((node) => Node.isCaseClause(node) || Node.isBlock(node) || Node.isSourceFile(node));

/**
 * The members of the value a registration names by one of its members, read
 * in the scope it is written in other than the name itself: `item.tool` beside
 * `item.wireName`. The definition the registration dispatches to is one of them.
 */
const membersBeside = (call: CallExpression, owner: TsNode, nameMember: string): Set<string> => {
  const symbol = owner.getSymbol();
  const members = new Set<string>();
  const scope = scopeOf(call);
  if (symbol === undefined || scope === undefined) return members;
  for (const access of scope.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const of = access.getExpression();
    if (!Node.isIdentifier(of) || of.getSymbol() !== symbol || access.getName() === nameMember) continue;
    members.add(access.getName());
  }
  return members;
};

/**
 * What a record's member holds, where it is a definition with a handler: a
 * chain ending `.handler(fn)` (a builder of the repository's own,
 * `defineTool({...}).handler(fn)`), or an object written with a `handler`.
 * Followed through the name it is held by, across imports.
 */
const definitionOf = (value: TsNode): { site: TsNode; work: TsNode } | undefined => {
  let at = unwrapValue(value);
  let site: TsNode = at;
  if (Node.isIdentifier(at)) {
    const declaration = declarationOf(at);
    if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
    const initializer = declaration.getInitializer();
    if (initializer === undefined) return undefined;
    site = declaration;
    at = unwrapValue(initializer);
    while (Node.isSatisfiesExpression(at)) at = unwrapValue(at.getExpression());
  }
  if (Node.isCallExpression(at)) {
    const callee = at.getExpression();
    const [work] = at.getArguments();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== HANDLER_MEMBER || work === undefined) return undefined;
    // A chain the repository's builder starts, not a value of a package's.
    if (!Node.isCallExpression(unwrapValue(callee.getExpression()))) return undefined;
    const fn = unwrapValue(work);
    return Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || repoFunctionOf(fn) !== undefined ? { site, work } : undefined;
  }
  if (Node.isObjectLiteralExpression(at)) {
    const handler = at.getProperty(HANDLER_MEMBER);
    if (handler === undefined) return undefined;
    if (Node.isMethodDeclaration(handler)) return { site, work: handler };
    const work = Node.isPropertyAssignment(handler) ? handler.getInitializer() : undefined;
    return work === undefined ? undefined : { site, work };
  }
  return undefined;
};

/**
 * The ways in a registration under a record's member reaches (P277): every
 * record the repository writes with that member as text beside a definition
 * held in a member the registration reads of the same value.
 */
const fromRecords = (
  call: CallExpression,
  written: TsNode,
  primitive: Primitive,
  ctx: ExtractContext,
  records: RecordIndex,
): EntryNode[] => {
  const at = unwrapValue(written);
  if (!Node.isPropertyAccessExpression(at)) return [];
  const owner = unwrapValue(at.getExpression());
  if (!Node.isIdentifier(owner)) return [];
  const nameMember = at.getName();
  const callee = call.getExpression();
  const method = Node.isPropertyAccessExpression(callee) ? callee.getName() : '';
  const beside = membersBeside(call, owner, nameMember);
  if (beside.size === 0) return [];
  const registeredAt = `${fileOfNode(call, ctx)}:${startLineOf(call)}`;
  const entries: EntryNode[] = [];
  for (const record of records.withName(nameMember)) {
    for (const member of beside) {
      const property = record.object.getProperty(member);
      const value =
        property === undefined
          ? undefined
          : Node.isPropertyAssignment(property)
            ? property.getInitializer()
            : Node.isShorthandPropertyAssignment(property)
              ? property.getNameNode()
              : undefined;
      const definition = value === undefined ? undefined : definitionOf(value);
      if (definition === undefined) continue;
      const key = `mcp:${primitive}:${record.name}`;
      const label = `${primitive} ${record.name}`;
      const { handler, via } = handlerOf(definition.work, label, ctx);
      entries.push({
        id: makeEntryId(ctx.repo, 'rpc', key),
        kind: 'rpc',
        label,
        key,
        ...(handler === undefined ? {} : { handler }),
        // Served where the configuration has the run register it, which is a guess.
        handlerConfidence: 'heuristic',
        file: fileOfNode(definition.site, ctx),
        line: startLineOf(definition.site),
        meta: {
          key,
          call: primitive,
          [primitive]: record.name,
          primitive,
          adapter: ADAPTER,
          registration: `${SERVER_CLASS}.${method}`,
          registeredAt: [registeredAt],
          namedAt: `${fileOfNode(record.object, ctx)}:${startLineOf(record.object)}`,
          nameFrom: `record.${nameMember}`,
          servedWhen: 'configuration',
          handlerVia: via,
        },
      });
      break;
    }
  }
  return entries;
};
