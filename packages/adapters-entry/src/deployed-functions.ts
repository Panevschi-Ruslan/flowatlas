import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import {
  hasAnyDependency,
  makeEntryId,
  makeHttpEntryKey,
  makeInvokeEntryKey,
  makeUnnamedInvokeKey,
  type Confidence,
  type DeployedFunction,
  type DeployedHandler,
  type Deployment,
  type DeploymentReader,
  type EntryAdapter,
  type EntryHandler,
  type EntryNode,
  type EntryWrapping,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { terraformReader, unreadDeploymentOf } from '@flowatlas/terraform';
import { Node, ts, type Node as TsNode, type SourceFile } from 'ts-morph';
import { builtByFactory, fileOfNode, isWrittenFunction, repoFunctionOf, unwrapValue } from './shared.js';

export const DEPLOYED_FUNCTIONS = 'aws-lambda';

/**
 * The readers of deployment descriptions, in the order they are asked.
 *
 * The adapter below is written against `DeploymentReader`, which names no
 * format, so a second reader - a SAM template, a Serverless Framework file, a
 * CDK synthesis - is a row here and nothing else. Only Terraform is read today.
 */
export const DEPLOYMENT_READERS: readonly DeploymentReader[] = [terraformReader];

/** Packages a repository of Lambda handlers declares, any one of which gives it away. */
export const LAMBDA_PACKAGES: readonly string[] = ['@types/aws-lambda', 'aws-lambda', '@middy/core'];

/** The deployment readers that find something in a repository. */
export const deploymentReadersFor = (repoDir: string, config?: Parameters<DeploymentReader['declares']>[1]): DeploymentReader[] =>
  DEPLOYMENT_READERS.filter((reader) => reader.declares(repoDir, config));

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

/** What `tsconfig.json` says about where compiled output goes, per directory. */
interface OutputMapping {
  /** Repo-relative directory compiled files are written to. */
  readonly outDir: string;
  /** Repo-relative directory the sources they come from are under. */
  readonly rootDir: string;
  readonly tsconfig: string;
}

const readTsconfig = (path: string): { outDir?: string; rootDir?: string } | undefined => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  const parsed = ts.parseConfigFileTextToJson(path, text);
  const options = (parsed.config as { compilerOptions?: { outDir?: unknown; rootDir?: unknown } } | undefined)?.compilerOptions;
  if (options === undefined) return {};
  return {
    ...(typeof options.outDir === 'string' ? { outDir: options.outDir } : {}),
    ...(typeof options.rootDir === 'string' ? { rootDir: options.rootDir } : {}),
  };
};

/**
 * The source directory compiled output came from, by the tsconfig that wrote it.
 *
 * A function packaged from `dist/returns` runs code compiled from somewhere,
 * and the only statement of where is the `outDir` and `rootDir` of the tsconfig
 * that compiled it. Every tsconfig from the directory up to the repository is
 * asked, nearest first. Without a `rootDir` the compiler takes the common root
 * of its inputs, which is the tsconfig's own directory, or its `src` where that
 * exists and the directory itself does not answer.
 */
const sourceOfOutput = (repoDir: string, directory: string): { directory: string; tsconfig: string } | undefined => {
  const parts = directory.split('/');
  for (let depth = parts.length; depth >= 0; depth -= 1) {
    const dir = parts.slice(0, depth).join('/');
    for (const name of ['tsconfig.build.json', 'tsconfig.json']) {
      const file = dir === '' ? name : `${dir}/${name}`;
      const read = readTsconfig(join(repoDir, file));
      if (read?.outDir === undefined) continue;
      const mapping: OutputMapping = {
        outDir: posix.normalize(posix.join(dir || '.', read.outDir)).replace(/\/$/, ''),
        rootDir: posix.normalize(posix.join(dir || '.', read.rootDir ?? '.')).replace(/\/$/, ''),
        tsconfig: file,
      };
      if (directory !== mapping.outDir && !directory.startsWith(`${mapping.outDir}/`)) continue;
      const rest = directory.slice(mapping.outDir.length).replace(/^\//, '');
      const bases = read.rootDir === undefined ? [mapping.rootDir, posix.join(mapping.rootDir, 'src')] : [mapping.rootDir];
      for (const base of bases) {
        const candidate = posix.normalize(posix.join(base, rest)).replace(/^\.\//, '').replace(/^\.$/, '');
        if (existsSync(join(repoDir, candidate))) return { directory: candidate, tsconfig: file };
      }
    }
  }
  return undefined;
};

/** The source file a handler's module names inside a directory, if there is one. */
const moduleIn = (repoDir: string, directory: string, module: string): string | undefined => {
  for (const ext of SOURCE_EXTENSIONS) {
    const file = posix.normalize(posix.join(directory || '.', `${module}${ext}`));
    if (existsSync(join(repoDir, file))) return file;
  }
  return undefined;
};

/** What reading a handler's export found. */
interface ResolvedHandler {
  handler?: EntryHandler;
  wrapping: EntryWrapping[];
  confidence?: Confidence;
  meta: Record<string, unknown>;
}

const label = (node: TsNode): string => {
  const text = node.getText().replace(/\s+/g, ' ');
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/**
 * A function this repository declares, or one written in place, when the node
 * stands for one.
 */
const workIn = (node: TsNode): TsNode | undefined => {
  const value = unwrapValue(node);
  if (isWrittenFunction(value)) return value;
  if (Node.isIdentifier(value) && repoFunctionOf(value) !== undefined) return value;
  return undefined;
};

/**
 * The function a handler export wraps, and the chain in front of it.
 *
 * `middy(createLoan).use(jsonBodyParser()).use(httpErrorHandler())` and
 * `withLogging(withAuth(createLoan))` are the two shapes: a chain of method
 * calls on an engine, whose arguments are middleware and whose engine is not,
 * and wrappers called one inside another, each of which is middleware itself.
 * Any call whose argument is a function is read this way, which is what R109
 * does for HTTP middleware, so no library is named here. A method call that is
 * handed the function itself - `middy().use(x).handler(fn)` - names the
 * function and nothing in front of it.
 */
const unwrapChain = (start: TsNode, ctx: ExtractContext): { inner?: TsNode; wrapping: EntryWrapping[] } => {
  const chained: EntryWrapping[] = [];
  const wrappers: EntryWrapping[] = [];
  let inner: TsNode | undefined;
  let expression = unwrapValue(start);
  let viaMethods = false;
  const wrapping = (node: TsNode, source: string, kind: string): EntryWrapping => ({
    label: label(node),
    layer: 'middleware',
    scope: 'route',
    source,
    file: fileOfNode(node, ctx),
    line: node.getStartLineNumber(),
    kind,
  });
  for (let depth = 0; depth < 16 && Node.isCallExpression(expression); depth += 1) {
    const callee = expression.getExpression();
    const args = expression.getArguments();
    if (Node.isPropertyAccessExpression(callee) && Node.isCallExpression(unwrapValue(callee.getExpression()))) {
      viaMethods = true;
      const method = callee.getName();
      const written: EntryWrapping[] = [];
      for (const arg of args) {
        const work = workIn(arg);
        if (work !== undefined && inner === undefined) {
          inner = work;
          continue;
        }
        written.push(wrapping(arg, method, Node.isCallExpression(arg) ? 'call' : 'function'));
      }
      chained.unshift(...written);
      expression = unwrapValue(callee.getExpression());
      continue;
    }
    const first = args[0];
    if (first === undefined) break;
    const work = workIn(first);
    // The engine a chain of methods hangs from is not middleware; a wrapper
    // called on its own is.
    if (!viaMethods) wrappers.push(wrapping(callee, label(callee), 'function'));
    viaMethods = false;
    if (work !== undefined) {
      inner ??= work;
      break;
    }
    expression = unwrapValue(first);
  }
  return { ...(inner === undefined ? {} : { inner }), wrapping: [...wrappers, ...chained] };
};

/** Every source file of the repository whose module path ends with `module`. */
const sourcesNamed = (ctx: ExtractContext, module: string): SourceFile[] => {
  const tail = `/${module}`;
  return ctx.project.getSourceFiles().filter((sourceFile) => {
    const path = sourceFile.getFilePath();
    if (path.includes('/node_modules/')) return false;
    const stem = path.replace(/\.(?:tsx?|mts|cts)$/, '');
    return stem.endsWith(tail);
  });
};

const exportedFrom = (sourceFile: SourceFile, name: string): TsNode | undefined =>
  sourceFile.getExportedDeclarations().get(name)?.[0];

/** The entry handler a deployed function's handler string stands for. */
const resolveHandler = (
  ctx: ExtractContext,
  fn: DeployedFunction,
  handler: DeployedHandler,
  rows: Unresolved[],
): ResolvedHandler => {
  const at = { file: fn.file, line: fn.line };
  const meta: Record<string, unknown> = { handler: handler.written };
  const who = fn.name ?? fn.address;
  let sourceFile: SourceFile | undefined;
  let confidence: Confidence | undefined;

  if (handler.directory !== undefined) {
    let directory = handler.directory;
    if (directory.startsWith('../')) {
      rows.push({
        ...at,
        reason: 'function-source-unread',
        message: `${who} is packaged from ${directory}, outside this repository`,
        hint: 'Configure the repository that holds that directory as a service of its own.',
        symbol: fn.address,
      });
      return { wrapping: [], meta };
    }
    let file = moduleIn(ctx.repoDir, directory, handler.module);
    if (file === undefined) {
      const mapped = sourceOfOutput(ctx.repoDir, directory);
      if (mapped !== undefined) {
        meta['packagedFrom'] = directory;
        meta['compiledBy'] = mapped.tsconfig;
        directory = mapped.directory;
        file = moduleIn(ctx.repoDir, directory, handler.module);
      }
    }
    meta['sourceDirectory'] = directory;
    if (file === undefined) {
      rows.push({
        ...at,
        reason: 'function-handler-not-found',
        message: `${who} runs ${handler.written} from ${directory}, and there is no ${handler.module}.ts there${meta['packagedFrom'] === undefined ? '' : ` (mapped from ${String(meta['packagedFrom'])} by ${String(meta['compiledBy'])})`}`,
        hint: 'Check the handler and the directory the deployment packages. Only TypeScript sources are read.',
        symbol: fn.address,
      });
      return { wrapping: [], meta };
    }
    const absolute = join(ctx.repoDir, file);
    sourceFile = ctx.project.getSourceFile(absolute) ?? ctx.project.addSourceFileAtPathIfExists(absolute);
  } else {
    // Nothing says what the package was built from: the archive is made by a
    // script, or kept in a bucket. The module is looked for by name, and found
    // only if exactly one source file of that name exports the handler.
    const found = sourcesNamed(ctx, handler.module).filter((candidate) => exportedFrom(candidate, handler.export) !== undefined);
    if (found.length !== 1) {
      rows.push({
        ...at,
        reason: found.length === 0 ? 'function-source-unread' : 'function-handler-ambiguous',
        message:
          found.length === 0
            ? `${who} runs ${handler.written}, from a package the files do not say how to build, and no source file ${handler.module}.ts here exports ${handler.export}`
            : `${who} runs ${handler.written}, from a package the files do not say how to build, and ${found.length} source files could be it: ${found.map((candidate) => fileOfNode(candidate, ctx)).join(', ')}`,
        hint: 'Build the package from a directory the configuration names - an archive of a source directory - so the handler is read from where it is.',
        symbol: fn.address,
      });
      return { wrapping: [], meta };
    }
    sourceFile = found[0];
    confidence = 'heuristic';
    meta['handlerFoundBy'] = 'search';
  }

  if (sourceFile === undefined) return { wrapping: [], meta };
  const declaration = exportedFrom(sourceFile, handler.export);
  const file = fileOfNode(sourceFile, ctx);
  if (declaration === undefined) {
    rows.push({
      ...at,
      reason: 'function-handler-not-found',
      message: `${who} runs ${handler.written}, and ${file} exports nothing called ${handler.export}`,
      hint: 'Check the export name in the handler.',
      symbol: fn.address,
    });
    return { wrapping: [], meta };
  }

  const done = (found: EntryHandler, via: string, wrapping: EntryWrapping[] = []): ResolvedHandler => ({
    handler: found,
    wrapping,
    ...(confidence === undefined ? {} : { confidence }),
    meta: { ...meta, handlerVia: via },
  });

  if (Node.isFunctionDeclaration(declaration) && declaration.getName() !== undefined) {
    return done({ file: fileOfNode(declaration, ctx), functionName: declaration.getName() as string, line: declaration.getStartLineNumber() }, 'function');
  }
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    const value = initializer === undefined ? undefined : unwrapValue(initializer);
    if (value !== undefined && isWrittenFunction(value)) {
      return done({ file: fileOfNode(declaration, ctx), functionName: declaration.getName(), line: declaration.getStartLineNumber() }, 'function');
    }
    if (value !== undefined && Node.isIdentifier(value)) {
      const named = repoFunctionOf(value);
      if (named !== undefined) return done({ file: fileOfNode(named.declaration, ctx), functionName: named.name, line: named.line }, 'function');
    }
    if (value !== undefined && Node.isCallExpression(value)) {
      const chain = unwrapChain(value, ctx);
      if (chain.inner !== undefined) {
        if (isWrittenFunction(chain.inner)) {
          const where = chain.inner.getSourceFile().getLineAndColumnAtPos(chain.inner.getStart());
          return done(
            { file: fileOfNode(chain.inner, ctx), line: where.line, column: where.column, label: handler.export, inline: true },
            'inline',
            chain.wrapping,
          );
        }
        const named = repoFunctionOf(chain.inner);
        if (named !== undefined) {
          return done({ file: fileOfNode(named.declaration, ctx), functionName: named.name, line: named.line }, 'wrapped', chain.wrapping);
        }
      }
      const factory = builtByFactory(value);
      if (factory !== undefined) {
        return done({ file: fileOfNode(factory.declaration, ctx), functionName: factory.name, line: factory.line }, 'call');
      }
    }
  }
  rows.push({
    ...at,
    reason: 'function-handler-unread',
    level: 'info',
    message: `${who} runs ${handler.written}, and ${file} builds that export in a way that names no function of this repository`,
    hint: 'A handler is read when it is a function, a function wrapped by calls that take it as their first argument, or a function a factory of this repository returns.',
    symbol: fn.address,
  });
  return { wrapping: [], meta: { ...meta, handlerVia: 'unread' } };
};

/** The rows of a reading, written into the graph under this adapter's name. */
const reportRows = (ctx: ExtractContext, rows: readonly Unresolved[]): void => {
  for (const row of rows) ctx.builder.addUnresolved({ ...row, adapter: DEPLOYED_FUNCTIONS });
};

/**
 * Lambda functions and the API Gateway routes in front of them, from the
 * deployment that declares them.
 *
 * Every function is an `invoke` entry under the name it is deployed with, and it
 * `handles` to the exported symbol its handler names, through any chain of
 * middleware wrapped around it. Every route is an ordinary `http` entry onto the
 * same handler. Detection asks the manifest for a package such a repository
 * declares and, failing that, asks each deployment reader whether the
 * repository holds anything it reads: a repository of nothing but Terraform has
 * no manifest at all, and is still where an API's routes are declared.
 */
export const deployedFunctionsAdapter: EntryAdapter = {
  name: DEPLOYED_FUNCTIONS,
  // The platform invokes the function; nothing of an application the extractor
  // reads stands in front of it.
  outsideApplication: true,
  detect: (pkg, config, repoDir) =>
    hasAnyDependency(pkg, LAMBDA_PACKAGES) || (repoDir !== undefined && deploymentReadersFor(repoDir, config).length > 0),
  extractEntries: (ctx: ExtractContext): EntryNode[] => {
    const readers = deploymentReadersFor(ctx.repoDir, ctx.config);
    if (readers.length === 0) {
      const tool = unreadDeploymentOf(ctx.repoDir);
      ctx.builder.addUnresolved({
        file: 'package.json',
        line: 1,
        reason: 'deployment-unread',
        level: 'info',
        message:
          tool === undefined
            ? 'this repository declares Lambda packages and no deployment description this tool reads, so no function is an entry'
            : `this repository's functions are declared with ${tool}, which is not read yet, so no function is an entry`,
        hint: 'Functions and routes are read from Terraform. The handlers are still read as code; nothing reaches them.',
        adapter: DEPLOYED_FUNCTIONS,
      });
      return [];
    }

    const entries: EntryNode[] = [];
    const roots: Array<Record<string, unknown>> = [];
    for (const reader of readers) {
      const deployment: Deployment = reader.read({ repoDir: ctx.repoDir, service: ctx.service, config: ctx.config });
      const rows: Unresolved[] = [...deployment.rows];

      const resolved = deployment.functions.map((fn) =>
        fn.handler === undefined ? { wrapping: [], meta: {} } : resolveHandler(ctx, fn, fn.handler, rows),
      );
      deployment.functions.forEach((fn, index) => {
        const reading = resolved[index] as ResolvedHandler;
        const key = fn.name === undefined ? makeUnnamedInvokeKey(fn.address) : makeInvokeEntryKey(fn.name);
        entries.push({
          id: makeEntryId(ctx.repo, 'invoke', key),
          kind: 'invoke',
          label: fn.name ?? `${fn.address} (name not read)`,
          key,
          ...(reading.handler === undefined ? {} : { handler: reading.handler }),
          ...(reading.confidence === undefined ? {} : { handlerConfidence: reading.confidence }),
          file: fn.file,
          line: fn.line,
          ...(reading.wrapping.length === 0 ? {} : { wrapping: reading.wrapping }),
          meta: {
            key,
            deployedBy: reader.name,
            ...(fn.name === undefined ? { nameRead: false } : { name: fn.name }),
            ...(fn.runtime === undefined ? {} : { runtime: fn.runtime }),
            ...fn.meta,
            ...reading.meta,
          },
        });
      });

      for (const route of deployment.routes) {
        const target = route.target;
        const local = target !== undefined && 'function' in target ? target.function : undefined;
        const fn = local === undefined ? undefined : deployment.functions[local];
        const reading = local === undefined ? undefined : resolved[local];
        const guards: EntryWrapping[] = (route.guards ?? []).map((guard) => ({
          label: guard.label,
          layer: 'guard',
          scope: 'route',
          source: 'authorizer',
          file: guard.file,
          line: guard.line,
          kind: 'authorizer',
        }));
        const wrapping = [...guards, ...(reading?.wrapping ?? [])];
        const key = makeHttpEntryKey(route.method, route.path);
        entries.push({
          id: makeEntryId(ctx.repo, 'http', key),
          kind: 'http',
          label: `${route.method} ${route.path}`,
          key,
          ...(reading?.handler === undefined ? {} : { handler: reading.handler }),
          ...(reading?.confidence === undefined ? {} : { handlerConfidence: reading.confidence }),
          file: route.file,
          line: route.line,
          ...(wrapping.length === 0 ? {} : { wrapping }),
          meta: {
            method: route.method,
            path: route.path,
            rawPath: route.rawPath,
            deployedBy: reader.name,
            ...(route.api === undefined ? {} : { api: route.api }),
            ...(fn === undefined ? {} : { function: fn.name ?? fn.address }),
            ...(target !== undefined && 'name' in target ? { invokes: target.name } : {}),
            ...(route.root === undefined ? {} : { root: route.root.key, below: route.root.below }),
            ...(route.meta === undefined ? {} : { declaredAs: route.meta['declaredAs'] }),
            ...(target === undefined ? { integration: 'none' } : {}),
          },
        });
      }

      for (const root of deployment.roots) roots.push({ ...root, deployedBy: reader.name });
      reportRows(ctx, rows);
    }

    // What this repository publishes for other repositories' routes to hang
    // from is a fact about the repository rather than about any one entry, and
    // the linker reads it from the repository's own node.
    if (roots.length > 0) {
      ctx.builder.addNode({
        id: `repo:${ctx.repo}`,
        type: 'repo',
        label: ctx.repo,
        repo: ctx.repo,
        meta: { apiRoots: roots },
      });
    }
    return entries;
  },
};
