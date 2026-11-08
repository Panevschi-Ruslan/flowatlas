import { join, posix } from 'node:path';
import { exportKey, generatedName, parameterKey, type PathStep, type PositionedDocument, type Unresolved } from '@flowatlas/core';
import {
  FileReading,
  isRecord,
  readOutputs,
  readParameters,
  readResources,
  readServiceFile,
  RESOURCE_KINDS,
  ServiceFileUnreadable,
  Template,
  textOf,
  Unread,
  type Declares,
  type Deployed,
  type DeploymentParts,
  type Exported,
  type ResourceReader,
} from '@flowatlas/serverless';
import { apiLookup, apiReference, readApis } from './apis.js';
import { deployConfigOf, TEMPLATE_FILES, type DeployConfig } from './config.js';
import { parameterFilesBeside, readParameterFile } from './parameter-files.js';
import { functionEventReaders, readEvents } from './events.js';
import { FUNCTION_TYPES, readDestinations, readFunction, readFunctionUrlConfig, withGlobals, type FunctionSite } from './functions.js';
import { expandLoops, Resolver, type ParameterFrom } from './intrinsics.js';
import { localPath, TemplateReading, type DeclaredFunction } from './reading.js';
import { readStateMachine, readStepFunctionsStateMachine } from './state-machines.js';

/**
 * One SAM template, read into the parts of a deployment (P246).
 *
 * The template is read as the transform and CloudFormation would read it,
 * as far as its files go: the parameters given values (`samconfig.toml`, the
 * service's options, a parent template), the conditions decided, the loops
 * written out, `Globals` merged; then the functions it declares, under the
 * names it gives them or stand-ins for the names the platform will; their
 * events; the routes of its APIs; its state machines; the plain CloudFormation
 * resources beside them, through the Serverless reader's table; and each
 * nested application in the repository, read the same way under the
 * parameters handed to it. Every part is the shape Terraform's reading of the
 * same deployment has.
 *
 * A plain CloudFormation template (P248) is read by the same code: it is a
 * SAM template with none of the transform's types, no `Globals` and no API
 * made for events, so what is left - functions, mappings, permissions, APIs
 * written as resources, rules, subscriptions, notifications, state machines -
 * is read exactly as it is in a SAM template. What another template of the
 * repository exports is handed in, so `Fn::ImportValue` of it is what it names.
 */

/** What the transform adds to CloudFormation's types: what each declares and the property naming it. */
export const SAM_KINDS: ReadonlyMap<string, Declares> = new Map<string, Declares>([
  ...RESOURCE_KINDS,
  ['AWS::Serverless::Function', { kind: 'function', name: 'FunctionName', ref: 'name' }],
  ['AWS::Serverless::StateMachine', { kind: 'workflow', name: 'Name', ref: 'arn' }],
  ['AWS::Serverless::SimpleTable', { kind: 'table', name: 'TableName', ref: 'name' }],
]);

/** The transform a template is written for, as its `Transform` names it. */
export const SAM_TRANSFORM = 'AWS::Serverless-2016-10-31';

/** Transforms that change nothing this reads, or that this reads itself. */
const READ_TRANSFORMS = new Set([SAM_TRANSFORM, 'AWS::LanguageExtensions']);

/** Types the transform makes nested templates of, and the property naming the template. */
const NESTED: ReadonlyMap<string, string> = new Map([
  ['AWS::Serverless::Application', 'Location'],
  ['AWS::CloudFormation::Stack', 'TemplateURL'],
]);

/** How deep nested templates are followed. */
const MOST_NESTED = 4;

/**
 * What a template is written for (P248): the SAM transform, which adds its
 * types, `Globals` and the API it makes for events; or CloudFormation alone,
 * whose resources the rest of this reads the same way in both.
 */
export type Dialect = 'sam' | 'cloudformation';

/** Every export a reading met, by its key: where each was declared, and what it is. */
export type ExportSink = Map<string, Array<{ readonly file: string; readonly exported: Exported }>>;

export interface TemplateReadOptions {
  readonly repoDir: string;
  /** Repo-relative path of the template. */
  readonly file: string;
  /** What the deployment is run with (`services[].infra.options`). */
  readonly options: Readonly<Record<string, string>>;
  /** Absolute paths of every file read beside it, filled as they are. */
  readonly loaded: Set<string>;
  /** What the other templates of the repository export, by key, for `Fn::ImportValue` (P248) and a parameter of the account (P253). */
  readonly imports?: (key: string) => Exported | Unread | undefined;
  /** Where the exports of this template, and of those it nests, are put as they are read. */
  readonly exports?: ExportSink;
  /** The files the configuration reads a deployment with (`services[].infra.vars`), repo-relative: a parameter file among them gives every template its values (P253). */
  readonly vars?: readonly string[];
  /** Every template of the repository, so a parameter file beside one is told from one beside several. */
  readonly templates?: readonly string[];
  /** What a parent template hands it, when it is nested. */
  readonly parent?: {
    readonly scope: string;
    readonly parameters: Readonly<Record<string, string | Unread>>;
    readonly region?: string;
    readonly chain: readonly string[];
    readonly dialect: Dialect;
  };
}

/**
 * What a template is deployed with (P248): the `samconfig` that deploys it -
 * the one in its directory or above it whose `template_file` names it, else
 * the one in its directory where it has the name the CLI looks for and the
 * file names none - over the options; the options alone for a template no
 * `samconfig` deploys, as `aws cloudformation deploy` would be run with them.
 */
const configFor = (repoDir: string, file: string, options: Readonly<Record<string, string>>): DeployConfig => {
  const own = posix.dirname(file) === '' ? '.' : posix.dirname(file);
  for (let dir = own; ; dir = posix.dirname(dir)) {
    const config = deployConfigOf(repoDir, dir, options);
    if (config.file !== undefined) {
      if (config.template !== undefined ? localPath(dir, config.template) === file : dir === own && TEMPLATE_FILES.includes(posix.basename(file))) return config;
      // A file that does not parse names nothing; the template it sits beside is still the one it was written for.
      if (config.unreadable !== undefined && dir === own) return config;
    }
    if (dir === '.' || dir === '') return deployConfigOf(repoDir, own, options, false);
  }
};

/**
 * The parameter files a template is deployed with (P253): the ones its
 * `samconfig` names, else the one beside it whose name says it is its own -
 * two such are a row, and neither is read - and, after those, every parameter
 * file the configuration names. Each file read is stamped with the template.
 */
const deployValues = (parts: DeploymentParts, options: TemplateReadOptions, config: DeployConfig): { named: Record<string, string>[]; vars: Record<string, string>[] } => {
  const { repoDir, file } = options;
  const read = (path: string, named: boolean): Record<string, string> | undefined => {
    options.loaded.add(join(repoDir, path));
    const found = readParameterFile(repoDir, path);
    if ('values' in found) return { ...found.values };
    if (named) {
      parts.rows.push({
        file: config.file ?? file,
        line: 1,
        symbol: `${file}#Parameters`,
        reason: 'infra-file-unparsed',
        message: `the parameter file ${path} is not read: ${found.unreadable}`,
        hint: 'The template is read with the values the rest of its configuration gives. Point the override at a JSON file of ParameterKey and ParameterValue.',
      });
    }
    return undefined;
  };
  const vars = (options.vars ?? []).filter((path) => path.endsWith('.json') && 'values' in readParameterFile(repoDir, path));
  const fromVars = vars.map((path) => read(path, false)).filter((values): values is Record<string, string> => values !== undefined);
  const named = config.parameterFiles ?? [];
  if (named.length > 0) return { named: named.map((path) => read(path, true)).filter((values): values is Record<string, string> => values !== undefined), vars: fromVars };
  if (vars.length > 0) return { named: [], vars: fromVars };
  const beside = parameterFilesBeside(repoDir, file, options.templates ?? [file]);
  if (beside.length > 1) {
    parts.rows.push({
      file,
      line: 1,
      symbol: `${file}#Parameters`,
      reason: 'parameter-file-ambiguous',
      message: `${file} has ${beside.length} parameter files beside it (${beside.join(', ')}), each the values of a deployment of its own, and nothing says which is deployed; none is read`,
      hint: 'Name the one to read under services[].infra.vars, or in its samconfig as parameter_overrides = "file://<file>".',
    });
    for (const path of beside) options.loaded.add(join(repoDir, path));
    return { named: [], vars: [] };
  }
  return { named: beside.map((path) => read(path, true)).filter((values): values is Record<string, string> => values !== undefined), vars: [] };
};

/** What a template gives the one it is nested in: its outputs, by name. */
export interface TemplateResult {
  readonly outputs: ReadonlyMap<string, Deployed | Unread>;
}

const EMPTY: TemplateResult = { outputs: new Map() };

/** The transforms a template names, as a list. */
export const transformsOf = (document: unknown): string[] => {
  const written = isRecord(document) ? document['Transform'] : undefined;
  const list = Array.isArray(written) ? written : written === undefined ? [] : [written];
  return list.map((item) => (isRecord(item) ? (textOf(item['Name']) ?? 'a macro') : (textOf(item) ?? 'a macro')));
};

export const readTemplate = (parts: DeploymentParts, options: TemplateReadOptions): TemplateResult => {
  const { repoDir, file } = options;
  let document: PositionedDocument;
  try {
    document = readServiceFile(join(repoDir, file));
  } catch (cause) {
    parts.rows.push({
      file,
      line: cause instanceof ServiceFileUnreadable ? cause.line : 1,
      reason: 'infra-file-unparsed',
      message: `${file} is not read: ${cause instanceof Error ? cause.message : String(cause)}`,
      hint: 'Nothing in this template is read. If it is valid, this is a defect in the reader: report it with the line.',
    });
    return EMPTY;
  }
  const written = isRecord(document.value) ? document.value : {};
  const dir = posix.dirname(file) === '' ? '.' : posix.dirname(file);
  // A template nested in one of the transform's is read as the transform reads it.
  const dialect: Dialect = options.parent?.dialect === 'sam' || transformsOf(written).includes(SAM_TRANSFORM) ? 'sam' : 'cloudformation';
  // `sam deploy` deploys a plain template too, the one its samconfig names; a nested one is handed its parent's parameters instead.
  const config: DeployConfig = options.parent === undefined ? configFor(repoDir, file, options.options) : { parameters: {}, from: {} };
  if (config.file !== undefined) options.loaded.add(join(repoDir, config.file));
  if (config.unreadable !== undefined && config.file !== undefined) {
    parts.rows.push({
      file: config.file,
      line: config.unreadable.line,
      reason: 'infra-file-unparsed',
      message: `${config.file} is not read: ${config.unreadable.message}`,
      hint: 'The template is read with no stack name and no parameter overrides. If the file is valid, this is a defect in the reader: report it with the line.',
    });
  }

  const given: Record<string, { value: string | Unread; from: ParameterFrom }> = {};
  for (const [name, value] of Object.entries(options.parent?.parameters ?? {})) given[name] = { value, from: 'parent' };
  // A parameter file, under the samconfig's overrides, the configuration's files and the options (P253).
  const files = options.parent === undefined ? deployValues(parts, options, config) : { named: [], vars: [] };
  for (const values of files.named) for (const [name, value] of Object.entries(values)) given[name] = { value, from: 'file' };
  for (const [name, value] of Object.entries(config.parameters)) if (config.from[name] !== 'option') given[name] = { value, from: 'file' };
  for (const values of files.vars) for (const [name, value] of Object.entries(values)) given[name] = { value, from: 'file' };
  for (const [name, value] of Object.entries(config.parameters)) if (config.from[name] === 'option') given[name] = { value, from: 'option' };
  const region = config.region ?? options.parent?.region;
  const stackName = options.parent === undefined ? config.stackName : undefined;
  const resolver = new Resolver({
    document: written,
    given,
    pseudo: {
      ...(region === undefined ? {} : { 'AWS::Region': region }),
      ...(stackName === undefined ? {} : { 'AWS::StackName': stackName }),
      'AWS::Partition': 'aws',
      'AWS::URLSuffix': 'amazonaws.com',
    },
    configFile: config.file ?? 'samconfig.toml',
  });
  // A SAM template is one to a directory, as the CLI finds it; plain templates are often several, each kept apart by its name.
  const scope = options.parent?.scope ?? (dialect === 'cloudformation' ? `${file.replace(/\.[^./]+$/, '')}.` : dir === '.' ? '' : `${dir}/`);
  const row = (path: readonly PathStep[], symbol: string, rest: Omit<Unresolved, 'file' | 'line' | 'symbol'>): void => {
    for (let depth = path.length; depth >= 0; depth -= 1) {
      const at = document.at(path.slice(0, depth));
      if (at !== undefined) {
        parts.rows.push({ file, line: at.line, symbol, ...rest });
        return;
      }
    }
    parts.rows.push({ file, line: 1, symbol, ...rest });
  };

  for (const transform of transformsOf(written)) {
    if (READ_TRANSFORMS.has(transform)) continue;
    row(['Transform'], `${file}#Transform`, {
      reason: 'deployment-plugin-unread',
      message: `${file} is rewritten by ${transform} when it is deployed, which is not run here; what it adds is not read`,
      hint: 'The template is read as it is written. Declare in it what the macro would add, or expect that missing from the map.',
    });
  }

  // The resources, the loops written out and each read under the conditions it is declared under.
  const expanded = expandLoops(written['Resources'], resolver, ['Resources']);
  for (const loop of expanded.repeated) {
    row(loop.path, `${scope}Resources.${loop.loop}`, {
      reason: 'construct-repeated-unread',
      message: `the resources of the loop ${loop.loop} are declared once per element of a collection the files do not settle (${loop.because.text}), so none of them is read`,
      hint: 'Write the collection out, or give the parameter it reads a value, and each is read under its own name.',
    });
  }
  const resources: Record<string, unknown> = {};
  const conditional = new Map<string, string>();
  const transformed = new Set<string>();
  for (const [logicalId, resource] of Object.entries(expanded.resources)) {
    if (!isRecord(resource)) continue;
    // A type of the transform in a template that does not name it is one CloudFormation refuses.
    if (dialect === 'cloudformation' && String(resource['Type']).startsWith('AWS::Serverless::')) {
      transformed.add(String(resource['Type']));
      continue;
    }
    const decided = resolver.resourceCondition(resource);
    if (decided === false) continue;
    if (decided instanceof Unread) conditional.set(logicalId, textOf(resource['Condition']) ?? 'a condition');
    resources[logicalId] = { ...resource, Properties: resolver.resolve(resource['Properties'] ?? {}) };
  }
  if (transformed.size > 0 || (dialect === 'cloudformation' && written['Globals'] !== undefined)) {
    const what = [...[...transformed].sort(), ...(written['Globals'] === undefined ? [] : ['Globals'])].join(', ');
    row(transformed.size > 0 ? ['Resources'] : ['Globals'], `${file}#Transform`, {
      reason: 'deployment-plugin-unread',
      message: `${file} declares ${what}, which only the SAM transform reads, and names no Transform: ${SAM_TRANSFORM}; CloudFormation refuses it, and none of it is read`,
      hint: `Add Transform: ${SAM_TRANSFORM} to the template, and it is read as a SAM template.`,
    });
  }
  const globals: Record<string, Record<string, unknown>> = {};
  const writtenGlobals = dialect === 'sam' ? resolver.resolve(written['Globals']) : undefined;
  if (isRecord(writtenGlobals)) for (const [kind, value] of Object.entries(writtenGlobals)) if (isRecord(value)) globals[kind] = value;

  // Every function first, by logical id, because everything else points at one.
  const functionIds = Object.entries(resources)
    .filter(([, resource]) => isRecord(resource) && FUNCTION_TYPES.has(String(resource['Type'])))
    .map(([logicalId]) => logicalId);
  const functions = new Map<string, DeclaredFunction>();
  const outputs = new Map<string, ReadonlyMap<string, Deployed | Unread>>();
  const template: Template = new Template(
    resources,
    (logicalId) => {
      // A function by its logical id, as `functionNamed` asks behind a NUL.
      const own = functions.get(logicalId.startsWith('\u0000') ? logicalId.slice(1) : logicalId);
      if (own !== undefined) return typeof own.name === 'string' ? { kind: 'function', name: own.name, function: own.index, ...(own.generated ? { generated: true } : {}) } : own.name;
      // The URL the transform declares for a function, `<function>Url`: its own address (P54).
      const url = logicalId.endsWith('Url') ? functions.get(logicalId.slice(0, -'Url'.length)) : undefined;
      if (url !== undefined) return typeof url.name === 'string' ? { kind: 'url', name: url.name } : url.name;
      return undefined;
    },
    {
      ...(region === undefined ? {} : { region }),
      ...(stackName === undefined ? {} : { stackName }),
    },
    file,
    {
      at: ['Resources'],
      scope,
      kinds: SAM_KINDS,
      functionOf: (logicalId) => functions.get(logicalId)?.index,
      attributeOf: (logicalId, attribute) => (attribute.startsWith('Outputs.') ? outputs.get(logicalId)?.get(attribute.slice('Outputs.'.length)) : undefined),
      paths: expanded.paths,
      ...(options.imports === undefined ? {} : { imported: options.imports }),
    },
  );
  const functionIndex = new Map<string, number>();
  const fileReading = new FileReading(parts, file, document, template, functionIndex);
  const reading = new TemplateReading(fileReading, resolver, config, dir, scope, globals, repoDir, options.loaded);
  for (const [logicalId, condition] of conditional) reading.conditional.set(logicalId, condition);

  // Nested templates first: what they output is what this one's resources may point at.
  for (const resource of template.resources.values()) {
    const property = NESTED.get(resource.type);
    if (property === undefined) continue;
    outputs.set(resource.logicalId, readNested(parts, reading, resource, property, options, dialect));
  }

  const base = parts.functions.length;
  functionIds.forEach((logicalId, offset) => {
    const resource = template.resources.get(logicalId);
    if (resource === undefined) return;
    const properties = resource.type === 'AWS::Serverless::Function' ? withGlobals(globals['Function'], resource.properties) : resource.properties;
    const declares = SAM_KINDS.get(resource.type) as Declares;
    const nameWritten = properties[declares.name];
    const generated = nameWritten === undefined || nameWritten === null;
    const name = generated ? generatedName(resource.address) : (() => {
      const text = template.text(nameWritten);
      return typeof text === 'string' ? text : new Unread(text.text, text.variable);
    })();
    functionIndex.set(logicalId, base + offset);
    functions.set(logicalId, { resource: { ...resource, properties }, index: base + offset, name, generated });
  });
  for (const fn of functions.values()) reading.functions.set(fn.resource.logicalId, fn);

  const sites: FunctionSite[] = [...functions.values()].map((fn) => ({
    fn,
    properties: fn.resource.properties,
    written: isRecord(expanded.resources[fn.resource.logicalId]) ? (expanded.resources[fn.resource.logicalId] as Record<string, unknown>) : {},
  }));
  for (const site of sites) readFunction(reading, site);
  const apis = apiLookup(reading);
  const readers = functionEventReaders(apis);
  for (const site of sites) {
    const { fn } = site;
    readEvents(reading, site.properties['Events'], readers, {
      to: { kind: 'function', function: fn.index },
      function: fn.index,
      label: typeof fn.name === 'string' && !fn.generated ? fn.name : fn.resource.address,
      logicalId: fn.resource.logicalId,
      path: [...fn.resource.path, 'Properties'],
      address: fn.resource.address,
    });
    readFunctionUrlConfig(reading, site);
    readDestinations(reading, site);
  }
  readApis(reading);
  readResources(fileReading, ownReaders(reading));
  for (const resource of template.ofType('AWS::StepFunctions::StateMachine')) readStepFunctionsStateMachine(reading, resource);

  for (const [logicalId, condition] of conditional) {
    const resource = template.resources.get(logicalId);
    if (resource === undefined) continue;
    fileReading.row(resource.path, resource.address, {
      reason: 'construct-conditional',
      level: 'info',
      message: `${resource.address} is declared under the condition ${condition}, which the files do not settle; it is read as declared, and what reaches it is drawn heuristic`,
      hint: 'Give the parameters the condition reads a value - a Default, samconfig.toml, or services[].infra.options - and it is decided.',
    });
  }
  const writtenOutputs = resolver.resolve(written['Outputs']);
  if (options.exports !== undefined) exportsOf(reading, writtenOutputs, options.exports);
  // A template deployed as a stack of its own publishes its outputs for
  // other stacks to read; a nested one's answer its parent (P249).
  if (options.parent === undefined) {
    readOutputs(fileReading, writtenOutputs, { at: ['Outputs'], scope, ...(stackName === undefined ? {} : { stackName }), apiOf: apiReference(reading) });
  }
  // The parameters of the account it writes, by their names, nested or not: a parameter is the account's, not the stack's (P253).
  readParameters(fileReading, { apiOf: apiReference(reading) });
  return { outputs: outputsOf(reading, writtenOutputs) };
};

/**
 * The outputs a template exports (`Export.Name`), into the sink, so another
 * template of the repository importing one by its name is handed what it
 * names (P248). A function is handed on by its name: its position is this
 * reading's, and the importer's is another.
 */
const exportsOf = (reading: TemplateReading, written: unknown, sink: ExportSink): void => {
  const put = (key: string, value: unknown): void => {
    const found = reading.deployedOf(value);
    const deployed: Deployed | undefined =
      found === undefined || found instanceof Unread || found.imported !== undefined
        ? undefined
        : { kind: found.kind, name: found.name, ...(found.changes === true ? { changes: true } : {}), ...(found.generated === true ? { generated: true } : {}) };
    const exported: Exported = { ...(deployed === undefined ? {} : { deployed }), text: reading.template.text(value) };
    sink.set(key, [...(sink.get(key) ?? []), { file: reading.file.file, exported }]);
  };
  for (const output of isRecord(written) ? Object.values(written) : []) {
    if (!isRecord(output) || !isRecord(output['Export'])) continue;
    const name = reading.template.text(output['Export']['Name']);
    if (typeof name === 'string') put(exportKey(name), output['Value']);
  }
  // A parameter of the account another template of the repository resolves (P253).
  for (const parameter of reading.template.ofType('AWS::SSM::Parameter')) {
    const name = parameter.properties['Name'] === undefined ? undefined : reading.template.text(parameter.properties['Name']);
    if (typeof name === 'string') put(parameterKey(name), parameter.properties['Value']);
  }
};

/** The resources the transform adds, each read by this reader; the rest go through the Serverless reader's table. */
const ownReaders = (reading: TemplateReading): ReadonlyMap<string, ResourceReader> =>
  new Map<string, ResourceReader>([
    // Read above, with their events.
    ['AWS::Serverless::Function', () => undefined],
    ['AWS::Lambda::Function', () => undefined],
    ['AWS::Serverless::Api', () => undefined],
    ['AWS::Serverless::HttpApi', () => undefined],
    ['AWS::Serverless::Application', () => undefined],
    ['AWS::CloudFormation::Stack', () => undefined],
    ['AWS::Serverless::StateMachine', (resource) => readStateMachine(reading, resource)],
    // A table the transform makes with one key and nothing else: no stream, and a name or a stand-in.
    ['AWS::Serverless::SimpleTable', (resource, file) => {
      const found = file.template.named(resource.logicalId);
      if (found !== undefined && !(found instanceof Unread)) file.generatedRow(found, resource.path);
    }],
    ['AWS::Serverless::LayerVersion', (resource, file) => layerNote(file, resource)],
    ['AWS::Lambda::LayerVersion', (resource, file) => layerNote(file, resource)],
  ]);

/** A layer's code is read as code where it is in the repository; what imports it from `/opt` is not joined to it. */
const layerNote = (file: FileReading, resource: { path: readonly PathStep[]; address: string }): void =>
  file.row(resource.path, resource.address, {
    reason: 'layer-not-followed',
    level: 'info',
    message: `${resource.address} is a layer, whose code functions load from /opt when they run; an import of it is not followed to its sources`,
    hint: 'Its sources are still read as code. Import shared code by a path or a package the repository resolves, and the call is followed.',
  });

/** A template's outputs, each as the deployed thing its value names. */
const outputsOf = (reading: TemplateReading, written: unknown): Map<string, Deployed | Unread> => {
  const out = new Map<string, Deployed | Unread>();
  if (!isRecord(written)) return out;
  for (const [name, output] of Object.entries(written)) {
    const found = isRecord(output) ? reading.deployedOf(output['Value']) : undefined;
    if (found !== undefined) out.set(name, found);
  }
  return out;
};

/**
 * A nested application or stack: read in place where its template is a file
 * of the repository, with the parameters this one hands it; said where it is
 * published somewhere else, which no file here holds.
 */
const readNested = (parts: DeploymentParts, reading: TemplateReading, resource: { logicalId: string; path: readonly PathStep[]; address: string; properties: Record<string, unknown> }, property: string, options: TemplateReadOptions, dialect: Dialect): ReadonlyMap<string, Deployed | Unread> => {
  const location = resource.properties[property];
  const text = textOf(location);
  const file = text === undefined ? undefined : localPath(reading.dir, text);
  const chain = options.parent?.chain ?? [options.file];
  const unread = (why: string): ReadonlyMap<string, Deployed | Unread> => {
    reading.file.row(resource.path, resource.address, {
      reason: 'nested-deployment-unread',
      message: `${resource.address} deploys a template ${why}, so nothing it declares is read`,
      hint: 'Keep the nested template in the repository and point at it by a path relative to this one; one published elsewhere is read where its own repository is.',
    });
    return new Map();
  };
  if (file === undefined) {
    return unread(isRecord(location) && location['ApplicationId'] !== undefined ? 'published in the Serverless Application Repository' : text === undefined ? 'whose location is not read' : `at ${text}, outside the repository`);
  }
  if (chain.includes(file) || chain.length > MOST_NESTED) return unread(`at ${file}, which ${chain.includes(file) ? 'nests itself' : 'is nested too deeply to follow'}`);
  const parameters: Record<string, string | Unread> = {};
  const handed = isRecord(resource.properties['Parameters']) ? resource.properties['Parameters'] : {};
  for (const [name, value] of Object.entries(handed)) {
    const textValue = reading.template.text(value);
    parameters[name] = textValue;
  }
  options.loaded.add(join(options.repoDir, file));
  return readTemplate(parts, {
    repoDir: options.repoDir,
    file,
    options: options.options,
    loaded: options.loaded,
    ...(options.imports === undefined ? {} : { imports: options.imports }),
    ...(options.exports === undefined ? {} : { exports: options.exports }),
    parent: {
      scope: `${reading.scope}${resource.logicalId}.`,
      parameters,
      ...(reading.template.pseudo.region === undefined ? {} : { region: reading.template.pseudo.region }),
      chain: [...chain, file],
      dialect,
    },
  }).outputs;
};

/** The nested templates a template points at in the repository, so they are not read again as templates of their own. */
export const nestedFilesOf = (document: unknown, dir: string): string[] => {
  const resources = isRecord(document) && isRecord(document['Resources']) ? document['Resources'] : {};
  return Object.values(resources).flatMap((resource) => {
    if (!isRecord(resource)) return [];
    const property = NESTED.get(String(resource['Type']));
    const location = property === undefined || !isRecord(resource['Properties']) ? undefined : textOf(resource['Properties'][property]);
    const file = location === undefined ? undefined : localPath(dir, location);
    return file === undefined ? [] : [file];
  });
};

