import type { EntryAdapter, EntryNode, ExtractContext } from '@flowatlas/core';
import { evaluateExpression, hasAnyDependency, makeEntryId, packageOfSpecifier, startLineOf } from '@flowatlas/core';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { fileOfNode, handlerOfFunction, inlineHandlerOf, repoFunctionOf, repoSources, unwrapValue } from './shared.js';
import { unwrapWork } from './wrapped-work.js';

const ADAPTER = 'mcp-server';

/** The SDKs an MCP server is written with, any one of which turns the reader on. */
const MCP_PACKAGES = ['@modelcontextprotocol/sdk', '@modelcontextprotocol/server'];

/** The class whose methods register what a client may ask for. */
const SERVER_CLASS = 'McpServer';

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
const PRIMITIVES: ReadonlyMap<string, 'tool' | 'prompt' | 'resource'> = new Map([
  ['tool', 'tool'],
  ['registerTool', 'tool'],
  ['prompt', 'prompt'],
  ['registerPrompt', 'prompt'],
  ['resource', 'resource'],
  ['registerResource', 'resource'],
]);

/**
 * An MCP server's tools, prompts and resources (P270).
 *
 * A client - an assistant, an editor, another service - connects to the
 * server and asks for one of these by the name it was registered under, with
 * arguments the registration describes. That is a way in exactly as a
 * procedure of a tree is: a named thing a caller asks for, over a transport
 * the server was handed, with code behind it. So each is an `rpc` entry keyed
 * `mcp:<kind>:<name>`, with the function that answers it as its handler.
 *
 * A registration on anything else is not one: the receiver must be an
 * `McpServer`, by its type where the checker has the SDK, and where it has not
 * by the source - a value made with `new McpServer(...)`, or annotated with
 * the type, imported from the SDK. A name decided at run time - a loop over a
 * registry of tools, each registered under the name it carries - is a way in
 * nothing can name, and is a row at the registration.
 */
export const mcpServerAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasAnyDependency(pkg, MCP_PACKAGES),
  extractEntries: (ctx) => {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    for (const sourceFile of repoSources(ctx)) {
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const entry = registrationOf(call, ctx);
        if (entry === undefined || seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(entry);
      }
    }
    return entries;
  },
};

/** Whether a name is the SDK's server class, by the import that binds it. */
const isServerClassName = (name: TsNode): boolean => {
  if (!Node.isIdentifier(name)) return false;
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isImportSpecifier(declaration)) continue;
    const statement = declaration.getImportDeclaration();
    const pkg = packageOfSpecifier(statement.getModuleSpecifierValue());
    if (pkg !== undefined && MCP_PACKAGES.includes(pkg) && declaration.getName() === SERVER_CLASS) return true;
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
    if (annotated !== undefined && Node.isTypeReference(annotated) && isServerClassName(annotated.getTypeName())) return true;
    const initializer = declaration.getInitializer();
    const made = initializer === undefined ? undefined : unwrapValue(initializer);
    return made !== undefined && Node.isNewExpression(made) && isServerClassName(made.getExpression());
  }
  return false;
};

/** The way in one call registers, or nothing when it registers none. */
const registrationOf = (call: CallExpression, ctx: ExtractContext): EntryNode | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const primitive = PRIMITIVES.get(callee.getName());
  if (primitive === undefined) return undefined;
  const args = call.getArguments();
  if (args.length < 2) return undefined;
  if (!isServer(callee.getExpression())) return undefined;
  const file = fileOfNode(call, ctx);
  const line = startLineOf(call);
  const written = args[0] as TsNode;
  const evaluated = evaluateExpression(written);
  const name = evaluated.resolved && typeof evaluated.value === 'string' ? evaluated.value : undefined;
  if (name === undefined) {
    ctx.builder.addUnresolved({
      file,
      line,
      reason: 'mcp-name-dynamic',
      message: `${callee.getText()}(${written.getText().slice(0, 40)}, ...) registers a ${primitive} under a name decided at run time, so no way in was drawn for it and nothing says which ${primitive}s the server offers.`,
      hint: `Register each ${primitive} under a name written as text, so a client's request for it can be named and followed.`,
      symbol: `${callee.getName()}(${written.getText().slice(0, 40)})`,
      adapter: ADAPTER,
    });
    return undefined;
  }
  // A wrapper of the repository's own around the answer - `traced('cancel_order',
  // async (...) => ...)` - hands it on, and the work inside is the handler.
  const answer = unwrapWork(args[args.length - 1] as TsNode).work;
  const named = repoFunctionOf(answer);
  const key = `mcp:${primitive}:${name}`;
  const handler = named !== undefined ? handlerOfFunction(named, ctx) : inlineHandlerOf(answer, `${primitive} ${name}`, ctx);
  return {
    id: makeEntryId(ctx.repo, 'rpc', key),
    kind: 'rpc',
    label: `${primitive} ${name}`,
    key,
    ...(handler === undefined ? {} : { handler }),
    file,
    line,
    meta: {
      key,
      [primitive]: name,
      primitive,
      adapter: ADAPTER,
      registration: `${SERVER_CLASS}.${callee.getName()}`,
      handlerVia: named !== undefined ? 'function' : handler === undefined ? 'none' : 'inline',
    },
  };
};
