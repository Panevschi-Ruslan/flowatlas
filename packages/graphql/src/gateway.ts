import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readYaml, type PathStep } from '@flowatlas/core';
import type { ObjectLiteralExpression, Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import type { Composition } from './federation.js';
import type { SchemaSummary } from './schema.js';

/**
 * What a gateway or a router says of the graph it serves (P241): which
 * subgraphs it sends to, at which addresses, and where its composition is.
 *
 * In code, Apollo Gateway is `new ApolloGateway({ supergraphSdl, serviceList })`,
 * handed to `new ApolloServer({ gateway })` or to NestJS's
 * `ApolloGatewayDriver`. Its `supergraphSdl` is one of:
 *
 * - `new IntrospectAndCompose({ subgraphs: [{ name, url }] })`, or federation
 *   1's `serviceList`: the subgraphs named here, composed at start from what
 *   each answers;
 * - a supergraph, read from a file or written in place: the composition
 *   itself;
 * - nothing, a function, or an `UplinkSupergraphManager`: a supergraph the
 *   registry hands over at run time, which nothing here can read.
 *
 * A router is a binary read from its files instead: rover's
 * `supergraph.yaml` (each subgraph's `routing_url` and where its schema is)
 * and the router's own `router.yaml` (the path it serves, addresses it
 * overrides).
 */

/** An address as written: in full, rooted at a setting, or not readable. */
export type Address =
  | { readonly kind: 'literal'; readonly url: string }
  | { readonly kind: 'setting'; readonly env: string; readonly path: string; readonly fallback?: string }
  | { readonly kind: 'unread'; readonly written: string };

/** One subgraph a gateway names, and where it is named. */
export interface SubgraphRoute {
  readonly name: string;
  readonly address: Address;
  /** Where it is named: a node of the source, or a line of a file. */
  readonly at: TsNode | { readonly file: string; readonly line: number };
  /** Where its schema is, for a router composing from files: a path relative to the configuration. */
  readonly schemaFile?: string;
  /** Its schema is held by the registry (`graphref`) and is not read. */
  readonly registry?: string;
}

/** Why a gateway's composition cannot be read, said precisely (D9). */
export type UnreadDetail = 'managed' | 'built-at-start' | 'not-committed' | 'registry';

export type GatewayReading =
  | { readonly kind: 'subgraphs'; readonly subgraphs: readonly SubgraphRoute[]; readonly at: TsNode; readonly via: string }
  | { readonly kind: 'supergraph'; readonly text: string; readonly file?: string; readonly at: TsNode; readonly taken?: true }
  | { readonly kind: 'rover'; readonly file: string; readonly at: TsNode }
  | { readonly kind: 'unread'; readonly detail: UnreadDetail; readonly why: string; readonly at: TsNode };

const property = (options: ObjectLiteralExpression, key: string): TsNode | undefined => {
  const found = options.getProperty(key);
  if (found !== undefined && Node.isPropertyAssignment(found)) return found.getInitializer();
  if (found !== undefined && Node.isShorthandPropertyAssignment(found)) {
    for (const declaration of found.getValueSymbol()?.getDeclarations() ?? []) {
      if (Node.isVariableDeclaration(declaration)) return declaration.getInitializer();
    }
    return found.getNameNode();
  }
  return undefined;
};

/** What a name is bound to, through constants and imports, or the node itself. */
const followed = (node: TsNode | undefined, depth = 0): TsNode | undefined => {
  if (node === undefined || depth > 6) return node;
  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node)) return followed(node.getExpression(), depth + 1);
  if (!Node.isIdentifier(node)) return node;
  const symbol = node.getSymbol();
  for (const declaration of (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer !== undefined) return followed(initializer, depth + 1);
    }
  }
  return node;
};

/** `process.env.NAME` or `process.env['NAME']`: the setting it reads. */
const settingRead = (node: TsNode): string | undefined => {
  if (Node.isPropertyAccessExpression(node) && node.getExpression().getText() === 'process.env') return node.getName();
  if (Node.isElementAccessExpression(node) && node.getExpression().getText() === 'process.env') {
    const argument = node.getArgumentExpression();
    if (argument !== undefined && (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))) return argument.getLiteralValue();
  }
  // NestJS's `config.get('ORDERS_URL')` reads the same environment.
  if (Node.isCallExpression(node) && /\.(get|getOrThrow)$/.test(node.getExpression().getText()) && /config/i.test(node.getExpression().getText())) {
    const [argument] = node.getArguments();
    if (argument !== undefined && (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))) return argument.getLiteralValue();
  }
  return undefined;
};

/** The address an expression writes: a literal, a setting, a setting with a path after it or a fallback. */
export const addressOf = (written: TsNode | undefined): Address => {
  const node = followed(written);
  if (node === undefined) return { kind: 'unread', written: '' };
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return { kind: 'literal', url: node.getLiteralValue() };
  const env = settingRead(node);
  if (env !== undefined) return { kind: 'setting', env, path: '' };
  if (Node.isBinaryExpression(node) && ['??', '||'].includes(node.getOperatorToken().getText())) {
    const left = addressOf(node.getLeft());
    const right = followed(node.getRight());
    if (left.kind === 'setting' && right !== undefined && (Node.isStringLiteral(right) || Node.isNoSubstitutionTemplateLiteral(right))) return { ...left, fallback: right.getLiteralValue() };
    return left;
  }
  if (Node.isTemplateExpression(node) && node.getHead().getLiteralText() === '') {
    const [first, ...rest] = node.getTemplateSpans();
    const inner = first === undefined ? undefined : addressOf(first.getExpression());
    if (first !== undefined && inner?.kind === 'setting' && rest.length === 0) return { ...inner, path: first.getLiteral().getLiteralText() };
  }
  return { kind: 'unread', written: node.getText().slice(0, 80) };
};

/** An address written in a file: `${env.NAME}/graphql` in a router's or rover's configuration. */
export const addressOfText = (text: string): Address => {
  const setting = /^\$\{env\.([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}(.*)$/.exec(text.trim());
  if (setting !== null) return { kind: 'setting', env: setting[1] as string, path: setting[3] ?? '', ...(setting[2] === undefined ? {} : { fallback: setting[2] }) };
  return text.includes('${') ? { kind: 'unread', written: text } : { kind: 'literal', url: text };
};

/** The subgraphs an array of `{ name, url }` names, through constants and spreads. */
const subgraphsIn = (value: TsNode | undefined): SubgraphRoute[] => {
  const list = followed(value);
  if (list === undefined || !Node.isArrayLiteralExpression(list)) return [];
  return list.getElements().flatMap((element): SubgraphRoute[] => {
    if (Node.isSpreadElement(element)) return subgraphsIn(element.getExpression());
    const item = followed(element);
    if (item === undefined || !Node.isObjectLiteralExpression(item)) return [];
    const name = followed(property(item, 'name'));
    if (name === undefined || !(Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name))) return [];
    return [{ name: name.getLiteralValue(), address: addressOf(property(item, 'url')), at: item }];
  });
};

/** One part of a path a `readFileSync` reads: a literal, `__dirname`, `process.cwd()`, or `join` / `resolve` of those. */
const segmentOf = (node: TsNode, sourceDir: string, repoDir: string): string | undefined => {
  const value = followed(node);
  if (value === undefined) return undefined;
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) return value.getLiteralValue();
  const text = value.getText();
  if (text === '__dirname' || text === 'import.meta.dirname') return sourceDir;
  if (text === 'process.cwd()') return repoDir;
  if (Node.isCallExpression(value) && /(^|\.)(join|resolve)$/.test(value.getExpression().getText())) {
    const parts = value.getArguments().map((argument) => segmentOf(argument, sourceDir, repoDir));
    return parts.some((part) => part === undefined) || parts.length === 0 ? undefined : join(...(parts as string[]));
  }
  return undefined;
};

/**
 * The files a `readFileSync` may read: a path built from the source's own
 * directory is the one; a relative path is read against where the process
 * starts, which is usually the repository, or else the file. Undefined where
 * a part of the path is not written down.
 */
const pathRead = (node: TsNode, sourceDir: string, repoDir: string): string[] | undefined => {
  const path = segmentOf(node, sourceDir, repoDir);
  if (path === undefined) return undefined;
  return isAbsolute(path) ? [path] : [resolve(repoDir, path), resolve(sourceDir, path)];
};

/** Whether a source writes an `UplinkSupergraphManager`, or reads the registry's key. */
const managed = (sourceFile: SourceFile): boolean => /\bUplinkSupergraphManager\b|\bAPOLLO_KEY\b|\bAPOLLO_GRAPH_REF\b/.test(sourceFile.getFullText());

/** A gateway's options, read for where its composition is. */
const readOptions = (options: ObjectLiteralExpression, at: TsNode, context: { repoDir: string; supergraphs: readonly string[]; rover: readonly string[] }): GatewayReading => {
  const sdl = followed(property(options, 'supergraphSdl'));
  const serviceList = property(options, 'serviceList');
  const sourceFile = at.getSourceFile();
  if (sdl === undefined && serviceList !== undefined) return { kind: 'subgraphs', subgraphs: subgraphsIn(serviceList), at, via: 'serviceList' };
  if (sdl === undefined) {
    return {
      kind: 'unread',
      detail: 'managed',
      why: 'the gateway is given no supergraphSdl and no serviceList, so the supergraph is fetched from the registry at run time (managed federation, APOLLO_KEY and APOLLO_GRAPH_REF)',
      at,
    };
  }
  if (Node.isNewExpression(sdl) && /IntrospectAndCompose$/.test(sdl.getExpression().getText())) {
    const [first] = sdl.getArguments();
    const composeOptions = followed(first);
    const subgraphs = composeOptions !== undefined && Node.isObjectLiteralExpression(composeOptions) ? subgraphsIn(property(composeOptions, 'subgraphs')) : [];
    return { kind: 'subgraphs', subgraphs, at: sdl, via: 'IntrospectAndCompose' };
  }
  if (Node.isNewExpression(sdl) && /UplinkSupergraphManager$/.test(sdl.getExpression().getText())) {
    return { kind: 'unread', detail: 'managed', why: 'the supergraph is fetched from the registry at run time by an UplinkSupergraphManager (managed federation, APOLLO_KEY and APOLLO_GRAPH_REF)', at: sdl };
  }
  if (Node.isStringLiteral(sdl) || Node.isNoSubstitutionTemplateLiteral(sdl)) return { kind: 'supergraph', text: sdl.getLiteralValue(), at: sdl };
  if (Node.isTaggedTemplateExpression(sdl) && Node.isNoSubstitutionTemplateLiteral(sdl.getTemplate())) {
    return { kind: 'supergraph', text: (sdl.getTemplate() as unknown as { getLiteralValue(): string }).getLiteralValue(), at: sdl };
  }
  if (Node.isCallExpression(sdl) && /(^|\.)readFileSync$/.test(sdl.getExpression().getText())) {
    const [path] = sdl.getArguments();
    const candidates = path === undefined ? undefined : pathRead(path, sourceFile.getDirectoryPath(), context.repoDir);
    const found = candidates?.find((candidate) => existsSync(candidate));
    if (found !== undefined) return { kind: 'supergraph', text: readFileSync(found, 'utf8'), file: found, at: sdl };
    // The file is made by a step that composes it, and is not committed: rover's configuration says what goes in.
    const [rover] = context.rover;
    if (rover !== undefined) return { kind: 'rover', file: rover, at: sdl };
    // A path nobody could read: the repository's one supergraph is the one it reads.
    const [only, ...more] = context.supergraphs;
    if (candidates === undefined && only !== undefined && more.length === 0) return { kind: 'supergraph', text: readFileSync(only, 'utf8'), file: only, at: sdl, taken: true };
    return {
      kind: 'unread',
      detail: 'not-committed',
      why: `the supergraph is read from ${candidates?.[0] === undefined ? 'a path built at run time' : 'a file that is not in the repository'}, made by a composition step at build time, and there is no rover configuration beside it to compose from`,
      at: sdl,
    };
  }
  if (managed(sourceFile)) {
    return { kind: 'unread', detail: 'managed', why: 'the supergraph is fetched from the registry at run time (managed federation, APOLLO_KEY and APOLLO_GRAPH_REF)', at: sdl };
  }
  return { kind: 'unread', detail: 'built-at-start', why: 'the supergraph is handed over by code that runs when the gateway starts (a function, or a fetch), so what it composes is not read', at: sdl };
};

/**
 * The gateway these files make, if they make one: Apollo Gateway in code,
 * directly or through NestJS's `ApolloGatewayDriver` (`gateway:` of
 * `GraphQLModule.forRoot`, or what `forRootAsync`'s `useFactory` returns).
 */
export const readGraphqlGateway = (
  sources: readonly SourceFile[],
  context: { readonly repoDir: string; readonly supergraphs: readonly string[]; readonly rover: readonly string[] },
): GatewayReading | undefined => {
  for (const sourceFile of [...sources].sort((a, b) => (a.getFilePath() < b.getFilePath() ? -1 : 1))) {
    let found: GatewayReading | undefined;
    sourceFile.forEachDescendant((node, traversal) => {
      if (Node.isNewExpression(node) && /(^|\.)ApolloGateway$/.test(node.getExpression().getText())) {
        const options = followed(node.getArguments()[0]);
        found =
          options !== undefined && Node.isObjectLiteralExpression(options)
            ? readOptions(options, node, context)
            : managed(sourceFile) || node.getArguments().length === 0
              ? { kind: 'unread', detail: 'managed', why: 'the gateway is given no supergraphSdl and no serviceList, so the supergraph is fetched from the registry at run time (managed federation, APOLLO_KEY and APOLLO_GRAPH_REF)', at: node }
              : { kind: 'unread', detail: 'built-at-start', why: 'the gateway is given options built at run time, so what it composes is not read', at: node };
        traversal.stop();
        return;
      }
      if (!Node.isCallExpression(node) || !/GraphQLModule\.forRoot(Async)?$/.test(node.getExpression().getText())) return;
      const options = followed(node.getArguments()[0]);
      if (options === undefined || !Node.isObjectLiteralExpression(options)) return;
      const factory = followed(property(options, 'useFactory'));
      const returned = factory !== undefined && (Node.isArrowFunction(factory) || Node.isFunctionExpression(factory)) ? returnedObject(factory) : undefined;
      const config = returned ?? options;
      if (!/ApolloGatewayDriver/.test(property(config, 'driver')?.getText() ?? property(options, 'driver')?.getText() ?? '')) return;
      const gateway = followed(property(config, 'gateway'));
      found =
        gateway !== undefined && Node.isObjectLiteralExpression(gateway)
          ? readOptions(gateway, node, context)
          : { kind: 'unread', detail: 'managed', why: 'the gateway driver is given no gateway options, so the supergraph is fetched from the registry at run time (managed federation, APOLLO_KEY and APOLLO_GRAPH_REF)', at: node };
      traversal.stop();
    });
    if (found !== undefined) return found;
  }
  return undefined;
};

/** The object an arrow or a function returns, when it returns one literal. */
const returnedObject = (fn: TsNode): ObjectLiteralExpression | undefined => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined;
  const body = fn.getBody();
  const value = Node.isBlock(body) ? body.getStatements().filter((statement) => Node.isReturnStatement(statement)).map((statement) => (statement as unknown as { getExpression(): TsNode | undefined }).getExpression())[0] : body;
  const object = followed(value);
  return object !== undefined && Node.isObjectLiteralExpression(object) ? object : undefined;
};

/** Where a YAML document writes something, as a line; the line of the document's start otherwise. */
const lineAt = (at: (path: readonly PathStep[]) => { line: number } | undefined, path: readonly PathStep[]): number => at(path)?.line ?? 1;

/**
 * Rover's `supergraph.yaml`: each subgraph's routing URL and where its schema
 * comes from - a file (read and composed), the subgraph's own endpoint
 * (`subgraph_url`, composed from the subgraph's source), or the registry
 * (`graphref`, not read).
 */
export const readRoverConfig = (text: string, file: string): { subgraphs: SubgraphRoute[] } => {
  const document = readYaml(text);
  const subgraphs = (document.value as { subgraphs?: Record<string, unknown> } | null)?.subgraphs;
  if (subgraphs === undefined || subgraphs === null || typeof subgraphs !== 'object') return { subgraphs: [] };
  return {
    subgraphs: Object.entries(subgraphs).map(([name, raw]): SubgraphRoute => {
      const entry = (raw ?? {}) as { routing_url?: unknown; schema?: { file?: unknown; subgraph_url?: unknown; graphref?: unknown } };
      const routing = typeof entry.routing_url === 'string' ? entry.routing_url : typeof entry.schema?.subgraph_url === 'string' ? entry.schema.subgraph_url : undefined;
      return {
        name,
        address: routing === undefined ? { kind: 'unread', written: '' } : addressOfText(routing),
        at: { file, line: lineAt(document.at, ['subgraphs', name]) },
        ...(typeof entry.schema?.file === 'string' ? { schemaFile: entry.schema.file } : {}),
        ...(typeof entry.schema?.graphref === 'string' ? { registry: entry.schema.graphref } : {}),
      };
    }),
  };
};

/** Apollo Router's `router.yaml`: the path it serves at, and the subgraph addresses it overrides. */
export const readRouterConfig = (text: string, file: string): { path?: string; overrides: ReadonlyArray<{ name: string; address: Address; line: number }>; file: string } => {
  const document = readYaml(text);
  const value = (document.value ?? {}) as { supergraph?: { path?: unknown }; override_subgraph_url?: Record<string, unknown> };
  const overrides = Object.entries(value.override_subgraph_url ?? {}).flatMap(([name, url]) =>
    typeof url === 'string' ? [{ name, address: addressOfText(url), line: lineAt(document.at, ['override_subgraph_url', name]) }] : [],
  );
  return { ...(typeof value.supergraph?.path === 'string' ? { path: value.supergraph.path } : {}), overrides, file };
};

/**
 * One subgraph a gateway names, as the gateway's endpoint carries it: where
 * it is named, and its address in the shape a request's is (`path`,
 * `baseUrlEnv`, `host`), so the linker joins it as it joins a request (D2).
 */
export interface GatewayRouteMeta {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly url?: string;
  readonly path: string;
  readonly baseUrlEnv?: string;
  readonly baseUrlDefault?: string;
  readonly host?: string;
  /** The address as written, where it could not be read. */
  readonly unread?: string;
  /** The subgraph's schema, where the gateway's own files hold it (rover's `schema.file`). */
  readonly schema?: SchemaSummary;
  /** Its schema is the registry's (`graphref`), and is not read. */
  readonly registry?: string;
}

/** What a gateway's endpoint carries under `meta.graphql.gateway` (P241). */
export interface GatewayMeta {
  readonly subgraphs: readonly GatewayRouteMeta[];
  /** The composition, where a supergraph wrote it down; otherwise the linker composes. */
  readonly composition?: Composition;
  /** The file the supergraph or the rover configuration was read from. */
  readonly from?: string;
  /** The supergraph is the repository's one, taken where the code's path could not be read. */
  readonly taken?: true;
  /** Nothing could be read, and why (D9). */
  readonly unread?: { readonly detail: UnreadDetail; readonly why: string };
}

/** An address in the shape a request's is: the path it asks for, and the setting or host it is rooted at. */
export const routeAddress = (address: Address): Pick<GatewayRouteMeta, 'url' | 'path' | 'baseUrlEnv' | 'baseUrlDefault' | 'host' | 'unread'> => {
  if (address.kind === 'unread') return { path: '', unread: address.written };
  if (address.kind === 'setting') return { path: address.path.split(/[?#]/)[0] ?? '', baseUrlEnv: address.env, ...(address.fallback === undefined ? {} : { baseUrlDefault: address.fallback }) };
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)/i.exec(address.url);
  if (match === null) return { url: address.url, path: address.url.split(/[?#]/)[0] ?? '' };
  return { url: address.url, host: (match[2] ?? '').toLowerCase(), path: match[3] ?? '' };
};

/** A path a configuration names, relative to the configuration's own directory. */
export const besideFile = (file: string, path: string): string => (isAbsolute(path) ? path : resolve(dirname(file), path));
