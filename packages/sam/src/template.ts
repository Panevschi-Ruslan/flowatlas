import { join, posix } from 'node:path';
import { generatedName, type PathStep, type PositionedDocument, type Unresolved } from '@flowatlas/core';
import {
  FileReading,
  isRecord,
  readResources,
  readServiceFile,
  readStateMachineResource,
  RESOURCE_KINDS,
  ServiceFileUnreadable,
  Template,
  textOf,
  Unread,
  type Declares,
  type Deployed,
  type DeploymentParts,
  type ResourceReader,
} from '@flowatlas/serverless';
import { apiLookup, readApis } from './apis.js';
import { deployConfigOf, type DeployConfig } from './config.js';
import { functionEventReaders, readEvents } from './events.js';
import { FUNCTION_TYPES, readDestinations, readFunction, readFunctionUrlConfig, withGlobals, type FunctionSite } from './functions.js';
import { expandLoops, Resolver, type ParameterFrom } from './intrinsics.js';
import { localPath, TemplateReading, type DeclaredFunction } from './reading.js';
import { readStateMachine } from './state-machines.js';

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

export interface TemplateReadOptions {
  readonly repoDir: string;
  /** Repo-relative path of the template. */
  readonly file: string;
  /** What the deployment is run with (`services[].infra.options`). */
  readonly options: Readonly<Record<string, string>>;
  /** Absolute paths of every file read beside it, filled as they are. */
  readonly loaded: Set<string>;
  /** What a parent template hands it, when it is nested. */
  readonly parent?: {
    readonly scope: string;
    readonly parameters: Readonly<Record<string, string | Unread>>;
    readonly region?: string;
    readonly chain: readonly string[];
  };
}

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
  const config: DeployConfig = options.parent === undefined ? deployConfigOf(repoDir, dir, options.options) : { parameters: {}, from: {} };
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
  for (const [name, value] of Object.entries(config.parameters)) given[name] = { value, from: config.from[name] ?? 'file' };
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
  const scope = options.parent?.scope ?? (dir === '.' ? '' : `${dir}/`);
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
  for (const [logicalId, resource] of Object.entries(expanded.resources)) {
    if (!isRecord(resource)) continue;
    const decided = resolver.resourceCondition(resource);
    if (decided === false) continue;
    if (decided instanceof Unread) conditional.set(logicalId, textOf(resource['Condition']) ?? 'a condition');
    resources[logicalId] = { ...resource, Properties: resolver.resolve(resource['Properties'] ?? {}) };
  }
  const globals: Record<string, Record<string, unknown>> = {};
  const writtenGlobals = resolver.resolve(written['Globals']);
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
    outputs.set(resource.logicalId, readNested(parts, reading, resource, property, options));
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
  for (const resource of template.ofType('AWS::StepFunctions::StateMachine')) readStateMachineResource(fileReading, resource);

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
  return { outputs: outputsOf(reading, resolver.resolve(written['Outputs'])) };
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
const readNested = (parts: DeploymentParts, reading: TemplateReading, resource: { logicalId: string; path: readonly PathStep[]; address: string; properties: Record<string, unknown> }, property: string, options: TemplateReadOptions): ReadonlyMap<string, Deployed | Unread> => {
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
    parent: {
      scope: `${reading.scope}${resource.logicalId}.`,
      parameters,
      ...(reading.template.pseudo.region === undefined ? {} : { region: reading.template.pseudo.region }),
      chain: [...chain, file],
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

