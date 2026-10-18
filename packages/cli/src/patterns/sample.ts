import { dirname, join, relative } from 'node:path';
import {
  isBelowDir,
  isParsed,
  matchPatternAt,
  toPosixPath,
  parseConfig,
  parsePattern,
  withCompiledRules,
  type CompiledRule,
  type FlowatlasConfig,
  type GraphEdge,
  type GraphNode,
  type PatternFit,
  type PatternRule,
  type RepoGraph,
  type ServiceConfig,
} from '@flowatlas/core';
import { createRepoProject, extractRepo } from '@flowatlas/extractor-nestjs';
import { Node, Project, ts, type CallExpression, type Decorator, type SourceFile } from 'ts-morph';
import { createRegistry, EXTRA_PASSES } from '../build/extractor.js';

/**
 * One rule run over one piece of code, by the reader the build runs (P121).
 *
 * The code is a statement a project writes - `bus.emit({ topic: 'x', data })`
 * - or, for a handler's decorator, a decorated method. It is put in a file of
 * its own with what it needs to type-check around it: the names it uses and
 * does not declare become `any`, the receiver the rule is about becomes a
 * value of the type the rule names (a stub class, so the reader's own type
 * check is what passes or fails), and a function the rule names from a
 * package is imported from it. Then the real reader reads that file with the
 * rule compiled into its configuration, exactly as the build would, in
 * memory: nothing is written anywhere.
 *
 * With a service, the file is put beside a file of that service that already
 * uses the rule's type, inside the service's own program, so the type is the
 * real one; still in memory, still nothing written.
 */

/** What one reading drew because of the rule, in the words a person checks a test with. */
export interface Drawn {
  /** The kind of node: `producer`, `consumer`, `http_out`, `ui_api_call`, `db_query`. */
  readonly node: string;
  readonly label: string;
  /** The channels it is on; empty for a channel that could not be read. */
  readonly channels?: readonly string[];
  readonly verb?: string | null;
  readonly url?: string | null;
  readonly table?: string | null;
  /** What a start reaches, by its deployed name. */
  readonly names?: readonly string[];
}

export interface SampleRow {
  readonly reason: string;
  readonly message?: string;
}

export interface SampleRun {
  /** What the rule drew. */
  readonly drawn: readonly Drawn[];
  /** The rows the reading left in the sample. */
  readonly rows: readonly SampleRow[];
  /** The source text each hole caught, at the first call the pattern fits. */
  readonly captures: Readonly<Record<string, string>>;
  /** How far the pattern fitted the first call it was held against, when none fitted. */
  readonly nearest?: PatternFit;
}

export interface SampleOptions {
  /** The configuration the rule is read beside: its written descriptions shadow a rule as in a build. */
  readonly config?: FlowatlasConfig;
  /** Type the code against this service's real program. */
  readonly service?: { readonly service: ServiceConfig; readonly repoDir: string; readonly configDir: string };
  /** The code is a whole file, read as it is, rather than one statement or member. */
  readonly asFile?: boolean;
}

const SAMPLE_ROOT = '/flowatlas-pattern-sample';
const SAMPLE_FILE = 'sample.ts';

const firstType = (rule: PatternRule): string | undefined =>
  typeof rule.on.receiverType === 'string' ? rule.on.receiverType : rule.on.receiverType?.[0];

/** Whether the code is a class member - a decorated method - rather than a statement. */
const isMember = (rule: PatternRule): boolean => rule.kind === 'consume-decorator';

/** The text of the file the code is read in, with what it needs around it. */
const wrap = (rule: PatternRule, code: string, preamble: readonly string[], members: readonly string[], asFile = false): string =>
  asFile
    ? [...preamble, code, ''].join('\n')
    : [
        ...preamble,
        'export class PatternSample {',
        ...members.map((member) => `  ${member}`),
        ...(isMember(rule) ? [code] : ['  run(): void {', `    ${code};`, '  }']),
        '}',
        '',
      ].join('\n');

/** Every call and decorator of a file, in order. */
const sitesOf = (file: SourceFile): Array<CallExpression | Decorator> => {
  const sites: Array<CallExpression | Decorator> = [];
  file.forEachDescendant((node) => {
    if (Node.isCallExpression(node) || Node.isDecorator(node)) sites.push(node);
  });
  return sites;
};

/** The calls of a file the pattern fits as written, types aside. */
const fittingSites = (rule: PatternRule, file: SourceFile): { site: CallExpression | Decorator; match: PatternFit }[] => {
  const parsed = parsePattern(rule.pattern);
  if (!isParsed(parsed)) return [];
  return sitesOf(file).flatMap((site) => {
    if (Node.isDecorator(site) !== parsed.decorator) return [];
    const match = matchPatternAt(parsed, site);
    return match.matched ? [{ site, match }] : [];
  });
};

/** The names the code uses and nothing declares, read off the checker's own complaints. */
const undeclared = (file: SourceFile): { values: Set<string>; members: Set<string> } => {
  const values = new Set<string>();
  const members = new Set<string>();
  for (const diagnostic of file.getPreEmitDiagnostics()) {
    const text = ts.flattenDiagnosticMessageText(diagnostic.getMessageText() as string | ts.DiagnosticMessageChain, ' ');
    const name = text.match(/'([^']+)'/)?.[1];
    if (name === undefined) continue;
    const code = diagnostic.getCode();
    // Cannot find name; did you mean; no value for a shorthand property.
    if (code === 2304 || code === 2552 || code === 18004 || code === 2663) values.add(name);
    // A property of `this` the wrapper class does not have.
    else if (code === 2339 && /type 'PatternSample'/.test(text)) members.add(name);
  }
  return { values, members };
};

/** The receiver a fitting call is made on, as the code spells its root: `bus`, or `this.bus`. */
const receiverRoot = (site: CallExpression | Decorator): { name: string; onThis: boolean } | undefined => {
  if (Node.isDecorator(site)) return undefined;
  let at: Node = site.getExpression();
  if (!Node.isPropertyAccessExpression(at)) return undefined;
  at = at.getExpression();
  // Down a chain to where it starts: `client.queue('x').add()` starts at `client`.
  for (let step = 0; step < 16; step += 1) {
    if (Node.isCallExpression(at)) at = at.getExpression();
    else if (Node.isPropertyAccessExpression(at) && !Node.isThisExpression(at.getExpression())) at = at.getExpression();
    else break;
  }
  if (Node.isIdentifier(at)) return { name: at.getText(), onThis: false };
  if (Node.isPropertyAccessExpression(at) && Node.isThisExpression(at.getExpression())) return { name: at.getName(), onThis: true };
  return undefined;
};

/** The declarations the code is read with in memory. */
const memoryPreamble = (rule: PatternRule, fitting: ReturnType<typeof fittingSites>, unknown: ReturnType<typeof undeclared>) => {
  const preamble: string[] = [];
  const members: string[] = [];
  const type = firstType(rule);
  const named = new Set<string>();
  if (type !== undefined) {
    // A class of the rule's type, every member of which hands back another:
    // the receiver of a chain is the type too, and the reader's own type check
    // is what decides whether the rule applies.
    preamble.push(`declare class ${type} { [member: string]: (...args: any[]) => ${type}; }`);
    named.add(type);
  }
  const imported = [rule.on.function, rule.on.factory].filter((name): name is string => name !== undefined);
  for (const name of imported) {
    named.add(name);
    preamble.push(rule.on.module === undefined ? `declare function ${name}(...args: any[]): any;` : `import { ${name} } from '${rule.on.module}';`);
  }
  const root = fitting.map((each) => receiverRoot(each.site)).find((found) => found !== undefined);
  for (const name of unknown.values) {
    if (named.has(name)) continue;
    const typed = root !== undefined && !root.onThis && root.name === name && type !== undefined;
    // A value and a type of the name both, since either is what the code may use it as.
    preamble.push(`declare const ${name}: ${typed ? type : 'any'};`, `type ${name} = any;`);
  }
  for (const name of unknown.members) {
    const typed = root !== undefined && root.onThis && root.name === name && type !== undefined;
    members.push(`${name}: ${typed ? type : 'any'};`);
  }
  return { preamble, members };
};

const ruleConfig = (base: FlowatlasConfig | undefined, compiled: CompiledRule): FlowatlasConfig => {
  const config = base ?? parseConfig({});
  // The rule alone, beside what the configuration writes by hand: another
  // rule of the project's would answer for calls this one is being tested on.
  return withCompiledRules({ ...config, patterns: [] }, [compiled]);
};

/** What a reading drew because of the rule, read off its graph. */
const drawnOf = (graph: RepoGraph, describedBy: string): Drawn[] => {
  const outOf = new Map<string, GraphEdge[]>();
  const into = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    outOf.set(edge.from, [...(outOf.get(edge.from) ?? []), edge]);
    into.set(edge.to, [...(into.get(edge.to) ?? []), edge]);
  }
  const label = (id: string): string => graph.nodes.find((node) => node.id === id)?.label ?? id;
  return graph.nodes
    .filter((node: GraphNode) => node.meta?.['describedBy'] === describedBy)
    .map((node): Drawn => {
      const meta = node.meta ?? {};
      if (node.type === 'producer' || node.type === 'consumer') {
        const channels =
          node.type === 'producer'
            ? (outOf.get(node.id) ?? []).filter((edge) => edge.type === 'emits').map((edge) => label(edge.to))
            : (into.get(node.id) ?? []).filter((edge) => edge.type === 'consumes').map((edge) => label(edge.from));
        const reaches = meta['reaches'];
        const names = Array.isArray(reaches) ? reaches.map((each) => String(each).replace(/^[a-z]+:/, '')) : undefined;
        return { node: node.type, label: node.label, channels, ...(names === undefined ? {} : { names }) };
      }
      if (node.type === 'http_out' || node.type === 'ui_api_call') {
        const url = (meta['path'] ?? meta['url'] ?? null) as string | null;
        return { node: node.type, label: node.label, verb: (meta['method'] ?? null) as string | null, url };
      }
      if (node.type === 'db_query') return { node: node.type, label: node.label, table: (meta['table'] ?? null) as string | null };
      return { node: node.type, label: node.label };
    });
};

/** Runs one compiled rule over one piece of code. */
export const runSample = async (rule: PatternRule, compiled: CompiledRule, code: string, options: SampleOptions = {}): Promise<SampleRun> => {
  const config = ruleConfig(options.config, compiled);
  const inService = options.service;
  const project = inService === undefined
    ? new Project({
        useInMemoryFileSystem: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, experimentalDecorators: true, strict: false, skipLibCheck: true, noLib: false },
      })
    : createRepoProject({ rootDir: inService.repoDir, repo: inService.service.name, service: inService.service, config, configDir: inService.configDir });
  const dir = inService === undefined ? SAMPLE_ROOT : sampleDirIn(project, inService.repoDir, firstType(rule));
  // Spelled as the compiler spells the files beside it, forward slashes on
  // every OS (P199), so its directory compares equal to theirs.
  const path = toPosixPath(join(dir, inService === undefined ? SAMPLE_FILE : '.flowatlas-pattern-sample.ts'));

  // First as written, to find what it leaves undeclared and which call the
  // rule is about; then with those declared.
  const bare = project.createSourceFile(path, wrap(rule, code, [], [], options.asFile), { overwrite: true });
  const fitting = fittingSites(rule, bare);
  const unknown = undeclared(bare);
  const { preamble, members } =
    inService === undefined ? memoryPreamble(rule, fitting, unknown) : servicePreamble(project, path, rule, fitting, unknown);
  const file = project.createSourceFile(path, wrap(rule, code, preamble, members, options.asFile), { overwrite: true });

  const graph = await extractRepo({
    rootDir: inService?.repoDir ?? SAMPLE_ROOT,
    repo: inService?.service.name ?? 'sample',
    ...(inService === undefined ? {} : { service: inService.service }),
    config,
    project,
    registry: createRegistry(),
    extraPasses: EXTRA_PASSES,
    generatedAt: '1970-01-01T00:00:00.000Z',
  });
  const sampleFile = relative(inService?.repoDir ?? SAMPLE_ROOT, path).split('\\').join('/');
  const inSample = (each: { file?: string | undefined }): boolean => each.file === sampleFile;
  const sampleGraph: RepoGraph = { ...graph, nodes: graph.nodes.filter(inSample) };
  const fits = fittingSites(rule, file);
  const parsed = parsePattern(rule.pattern);
  const nearest =
    fits.length > 0 || !isParsed(parsed) ? undefined : sitesOf(file).map((site) => matchPatternAt(parsed, site)).sort((a, b) => b.steps.length - a.steps.length)[0];
  if (inService !== undefined) project.removeSourceFile(file);
  return {
    drawn: drawnOf({ ...sampleGraph, edges: graph.edges }, compiled.describedBy),
    rows: graph.unresolved.filter(inSample).map((row) => ({ reason: row.reason, ...(row.message === undefined ? {} : { message: row.message }) })),
    captures: fits[0]?.match.captures ?? {},
    ...(nearest === undefined ? {} : { nearest }),
  };
};

/** The directory of a file of the service that names the rule's type, or the service's own. */
const sampleDirIn = (project: Project, repoDir: string, type: string | undefined): string => {
  if (type === undefined) return repoDir;
  for (const source of project.getSourceFiles()) {
    const path = source.getFilePath();
    // The compiler's path against the OS's directory (P199).
    if (path.includes('/node_modules/') || !isBelowDir(path, repoDir)) continue;
    const imports = source.getImportDeclarations().some((declaration) => declaration.getNamedImports().some((named) => named.getName() === type));
    if (imports || source.getClass(type) !== undefined || source.getInterface(type) !== undefined) return dirname(path);
  }
  return repoDir;
};

/** The declarations the code is read with inside a service: the rule's type from where the service has it. */
const servicePreamble = (
  project: Project,
  path: string,
  rule: PatternRule,
  fitting: ReturnType<typeof fittingSites>,
  unknown: ReturnType<typeof undeclared>,
) => {
  const preamble: string[] = [];
  const members: string[] = [];
  const type = firstType(rule);
  const named = new Set<string>();
  if (type !== undefined) {
    const dir = dirname(path);
    for (const source of project.getSourceFiles()) {
      if (dirname(source.getFilePath()) !== dir || source.getFilePath() === path) continue;
      const declaration = source.getImportDeclarations().find((each) => each.getNamedImports().some((named_) => named_.getName() === type));
      if (declaration !== undefined) {
        preamble.push(`import { ${type} } from '${declaration.getModuleSpecifierValue()}';`);
        named.add(type);
        break;
      }
      if (source.getClass(type) !== undefined || source.getInterface(type) !== undefined) {
        preamble.push(`import { ${type} } from './${source.getBaseNameWithoutExtension()}.js';`);
        named.add(type);
        break;
      }
    }
  }
  const imported = [rule.on.function, rule.on.factory].filter((name): name is string => name !== undefined);
  for (const name of imported) {
    if (!unknown.values.has(name)) continue;
    named.add(name);
    preamble.push(rule.on.module === undefined ? `declare function ${name}(...args: any[]): any;` : `import { ${name} } from '${rule.on.module}';`);
  }
  const root = fitting.map((each) => receiverRoot(each.site)).find((found) => found !== undefined);
  const typedAs = type !== undefined && named.has(type) ? type : 'any';
  for (const name of unknown.values) {
    if (named.has(name)) continue;
    preamble.push(`declare const ${name}: ${root !== undefined && !root.onThis && root.name === name ? typedAs : 'any'};`, `type ${name} = any;`);
  }
  for (const name of unknown.members) members.push(`${name}: ${root !== undefined && root.onThis && root.name === name ? typedAs : 'any'};`);
  return { preamble, members };
};
