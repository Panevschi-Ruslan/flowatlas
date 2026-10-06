import { readFileSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';
import type { InfraModuleConfig, Unresolved } from '@flowatlas/core';
import { attributeOf, blocksOf, type Attribute, type Block, type Body, type Expression, type HclFile, type Position } from '../hcl/ast.js';
import { HclSyntaxError, parseHcl, parseHclExpression, templateText } from '../hcl/parse.js';
import { evaluate, iterate, orderedKeys, withNames, type Scope } from '../eval/evaluate.js';
import {
  asText,
  describe,
  equal,
  failure,
  fromJson,
  list,
  NULL,
  num,
  object,
  str,
  unknown,
  type Because,
  type Instance,
  type ModuleInstance,
  type Value,
  type Written,
} from '../eval/values.js';
import { dirOf, infrastructureFiles, isWithin } from './files.js';
import { describedModule, isLocalSource } from './sources.js';

export interface LoadOptions {
  /** Absolute path of the repository. */
  readonly repoDir: string;
  /** Variable files chosen by the configuration, repo-relative; `undefined` when none was. */
  readonly varFiles?: readonly string[];
  /** Descriptions of modules whose source is elsewhere, configured ones first. */
  readonly descriptions: readonly InfraModuleConfig[];
}

/** What reading a repository's configuration produced. */
export interface Configuration {
  /** One per root module: a directory nothing in the repository calls as a module. */
  readonly roots: readonly ModuleInstance[];
  /** Every module instance reachable from a root, each root first. */
  modules(): readonly ModuleInstance[];
  /** The state a root module keeps, as an address another deployment reads it by. */
  stateOf(root: ModuleInstance): string | undefined;
  /** What could not be read, including what walking the module tree raised. */
  readonly rows: readonly Unresolved[];
}

/** Arguments of a module call that configure the call rather than feed the module. */
const CALL_META = new Set(['source', 'version', 'count', 'for_each', 'providers', 'depends_on']);

/** Where a module's blocks come from, shared by every instance of it. */
interface ModuleSource {
  /** Repo-relative directory the blocks are declared in. */
  readonly dir: string;
  readonly variables: ReadonlyMap<string, { readonly default?: Expression; readonly block?: Block }>;
  readonly locals: ReadonlyMap<string, Attribute>;
  readonly outputs: ReadonlyMap<string, Expression>;
  readonly outputSites: ReadonlyMap<string, Position>;
  /** `managed.type.name` or `data.type.name`. */
  readonly resources: ReadonlyMap<string, Block>;
  readonly calls: ReadonlyMap<string, Block>;
  readonly terraform: readonly Block[];
  /** The description it was built from, when it is a described module. */
  readonly described?: InfraModuleConfig;
}

interface Tfvars {
  readonly file: string;
  readonly values: ReadonlyMap<string, Value>;
}

const AUTO_VARS = /(?:^|\/)(?:terraform\.tfvars|terraform\.tfvars\.json|[^/]+\.auto\.tfvars|[^/]+\.auto\.tfvars\.json)$/;

/**
 * A value marked with the argument it was read from, unless it already carries
 * one: `via` names where a value came from first, so a function's `filename`
 * that is an archive's `output_path` still says it is the archive's.
 */
const withVia = (value: Value, instance: Instance, attribute: string): Value => {
  if ('via' in value && value.via !== undefined) return value;
  switch (value.kind) {
    case 'string':
    case 'number':
    case 'bool':
    case 'null':
    case 'list':
    case 'object':
      return { ...value, via: { target: instance, attribute } };
    default:
      return value;
  }
};

/** Reads one source the way every module of this repository is read. */
const sourceOf = (dir: string, files: readonly HclFile[], described?: InfraModuleConfig): ModuleSource => {
  const variables = new Map<string, { default?: Expression; block?: Block }>();
  const locals = new Map<string, Attribute>();
  const outputs = new Map<string, Expression>();
  const outputSites = new Map<string, Position>();
  const resources = new Map<string, Block>();
  const calls = new Map<string, Block>();
  const terraform: Block[] = [];
  for (const file of files) {
    for (const block of file.body.blocks) {
      const [first, second] = block.labels;
      if (block.type === 'variable' && first !== undefined) {
        const fallback = attributeOf(block.body, 'default');
        variables.set(first, { block, ...(fallback === undefined ? {} : { default: fallback.expression }) });
      } else if (block.type === 'locals') {
        for (const attribute of block.body.attributes) locals.set(attribute.name, attribute);
      } else if (block.type === 'output' && first !== undefined) {
        const value = attributeOf(block.body, 'value');
        if (value !== undefined) outputs.set(first, value.expression);
        outputSites.set(first, block.pos);
      } else if (block.type === 'resource' && first !== undefined && second !== undefined) {
        resources.set(`managed.${first}.${second}`, block);
      } else if (block.type === 'data' && first !== undefined && second !== undefined) {
        resources.set(`data.${first}.${second}`, block);
      } else if (block.type === 'module' && first !== undefined) {
        calls.set(first, block);
      } else if (block.type === 'terraform') {
        terraform.push(block);
      }
    }
  }
  return { dir, variables, locals, outputs, outputSites, resources, calls, terraform, ...(described === undefined ? {} : { described }) };
};

/** The identity of a state backend, as both sides of a remote-state read spell it. */
const IDENTITY_KEYS = ['bucket', 'key', 'prefix', 'path', 'organization', 'storage_account_name', 'container_name', 'workspace_key_prefix'];

export const stateAddress = (backend: string, settings: ReadonlyMap<string, Value>): string | undefined => {
  const parts: string[] = [];
  for (const key of IDENTITY_KEYS) {
    const value = settings.get(key);
    if (value === undefined) continue;
    const text = asText(value);
    if (text === undefined) return undefined;
    parts.push(`${key}=${text}`);
  }
  const workspaces = settings.get('workspaces');
  if (workspaces?.kind === 'object') {
    const name = workspaces.entries.get('name');
    const text = name === undefined ? undefined : asText(name);
    if (text !== undefined) parts.push(`workspace=${text}`);
  }
  return parts.length === 0 ? undefined : `${backend}:${parts.join(',')}`;
};

class Context {
  readonly rows: Unresolved[] = [];
  readonly #reported = new Set<string>();
  readonly #described = new Map<InfraModuleConfig, ModuleSource>();

  constructor(
    readonly options: LoadOptions,
    readonly sources: ReadonlyMap<string, ModuleSource>,
    readonly tfvars: readonly Tfvars[],
    readonly rootDirs: readonly string[],
  ) {}

  row(key: string, row: Unresolved): void {
    if (this.#reported.has(key)) return;
    this.#reported.add(key);
    this.rows.push(row);
  }

  described(description: InfraModuleConfig, site: Position): ModuleSource {
    const cached = this.#described.get(description);
    if (cached !== undefined) return cached;
    const sourceName = Array.isArray(description.source) ? description.source[0] : description.source;
    const expression = (raw: string | number | boolean | null, what: string): Expression | undefined => {
      if (typeof raw !== 'string') return { type: 'literal', value: raw, pos: site };
      try {
        return parseHclExpression(raw, `the description of ${String(sourceName)}`);
      } catch (error) {
        if (!(error instanceof HclSyntaxError)) throw error;
        this.row(`description:${String(sourceName)}:${what}`, {
          file: site.file,
          line: site.line,
          reason: 'infra-module-description-invalid',
          message: `${what} in the description of ${String(sourceName)} is not an expression: ${error.reason}`,
          hint: 'Each value in adapters.infra.modules is an expression in the module language: a string literal is written with its quotes, "\\"AWS_PROXY\\"".',
          symbol: String(sourceName),
        });
        return undefined;
      }
    };
    const variables = new Map<string, { default?: Expression }>();
    for (const [name, raw] of Object.entries(description.variables)) {
      const parsed = expression(raw, `variable ${name}`);
      if (parsed !== undefined) variables.set(name, { default: parsed });
    }
    const resources = new Map<string, Block>();
    for (const [address, args] of Object.entries(description.resources)) {
      const parts = address.split('.');
      const data = parts[0] === 'data';
      const [type, name] = data ? parts.slice(1) : parts;
      if (type === undefined || name === undefined) continue;
      const attributes: Attribute[] = [];
      for (const [argument, raw] of Object.entries(args)) {
        const parsed = expression(raw, `${address}.${argument}`);
        if (parsed !== undefined) attributes.push({ name: argument, expression: parsed, source: String(raw), pos: site });
      }
      resources.set(`${data ? 'data' : 'managed'}.${type}.${name}`, {
        type: data ? 'data' : 'resource',
        labels: [type, name],
        body: { attributes, blocks: [] },
        pos: site,
      });
    }
    const outputs = new Map<string, Expression>();
    for (const [name, raw] of Object.entries(description.outputs)) {
      const parsed = expression(raw, `output ${name}`);
      if (parsed !== undefined) outputs.set(name, parsed);
    }
    const source: ModuleSource = {
      dir: dirOf(site.file),
      variables,
      locals: new Map(),
      outputs,
      outputSites: new Map(),
      resources,
      calls: new Map(),
      terraform: [],
      described: description,
    };
    this.#described.set(description, source);
    return source;
  }

  /** The value of a root module's variable, from its default and its variable files. */
  rootVariable(module: Module, name: string): Value {
    const declared = module.source.variables.get(name);
    if (declared === undefined) return failure(`no variable ${JSON.stringify(name)} is declared in ${module.source.dir || 'the repository root'}`);
    const scope: Scope = { module };
    let base: Value | undefined = declared.default === undefined ? undefined : evaluate(declared.default, scope);
    const rootDir = module.source.dir;
    const owned = this.tfvars.filter((vars) => this.ownerOf(vars.file) === rootDir || this.ownerOf(vars.file) === undefined);
    for (const vars of owned) {
      if (dirOf(vars.file) !== rootDir || !AUTO_VARS.test(vars.file)) continue;
      const set = vars.values.get(name);
      if (set !== undefined) base = set;
    }
    const chosen = this.options.varFiles;
    if (chosen !== undefined) {
      for (const file of chosen) {
        const set = this.tfvars.find((vars) => vars.file === posix.normalize(file))?.values.get(name);
        if (set !== undefined) base = set;
      }
      return base ?? this.#unset(name);
    }
    const candidates = owned.filter((vars) => !(dirOf(vars.file) === rootDir && AUTO_VARS.test(vars.file)));
    const setting = candidates.filter((vars) => vars.values.has(name));
    if (setting.length > 0) {
      const values = setting.map((vars) => vars.values.get(name) as Value);
      const first = values[0] as Value;
      if (values.every((value) => equal(value, first) === true)) return first;
      const files: Record<string, string> = {};
      setting.forEach((vars, index) => {
        files[vars.file] = describe(values[index] as Value);
      });
      return unknown(
        'variable-disputed',
        `var.${name} is ${setting.map((vars, index) => `${describe(values[index] as Value)} in ${vars.file}`).join(' and ')}`,
        { variable: name, module: '', files },
      );
    }
    return base ?? this.#unset(name);
  }

  #unset(name: string): Value {
    return unknown('variable-unset', `var.${name} has no default and no variable file sets it`, {
      variable: name,
      module: '',
    });
  }

  /** The root module a variable file belongs to: the deepest one above it, if any. */
  ownerOf(file: string): string | undefined {
    const dir = dirOf(file);
    const owners = this.rootDirs.filter((root) => isWithin(dir, root)).sort((a, b) => b.length - a.length);
    return owners[0];
  }
}

/** An input a caller hands a module: where it is written, and its value when first asked for. */
interface Input {
  readonly written: Written;
  readonly value: () => Value;
}

/** One instance of a module. See `ModuleInstance`. */
class Module implements ModuleInstance {
  readonly #variables = new Map<string, Value>();
  readonly #locals = new Map<string, Value>();
  readonly #computing = new Set<string>();
  readonly #groups = new Map<string, { value: Value; instances: Instance[] }>();
  readonly #calls = new Map<string, { value: Value; modules: Module[] }>();
  readonly #arguments = new Map<Instance, Map<string, Value | undefined>>();

  constructor(
    readonly context: Context,
    readonly source: ModuleSource,
    readonly address: string,
    readonly root: Module | undefined,
    readonly pathModule: string,
    /** Inputs the caller hands over, evaluated when first asked for. */
    readonly inputs: ReadonlyMap<string, Input> | undefined,
    /** Where the call that created a described module is written. */
    readonly site: Position | undefined,
    readonly depth: number,
  ) {}

  get dir(): string {
    return this.source.dir;
  }

  get rootDir(): string {
    return (this.root ?? this).source.dir;
  }

  variable(name: string): Value {
    const cached = this.#variables.get(name);
    if (cached !== undefined) return cached;
    const value = this.#variable(name);
    this.#variables.set(name, value);
    return value;
  }

  #variable(name: string): Value {
    const input = this.inputs?.get(name);
    if (input !== undefined) return input.value();
    const declared = this.source.variables.get(name);
    if (this.root === undefined) return this.context.rootVariable(this, name);
    if (declared?.default !== undefined) return evaluate(declared.default, { module: this });
    // An input a described module was not handed is null, which is what a
    // module's optional inputs default to; a description that needs another
    // default says so under `variables`.
    if (this.source.described !== undefined) return NULL;
    if (declared === undefined) return failure(`${this.address} declares no variable ${JSON.stringify(name)}`);
    return unknown('variable-unset', `var.${name} of ${this.address} is given no value and has no default`, {
      variable: name,
      module: this.address,
    });
  }

  local(name: string): Value {
    const cached = this.#locals.get(name);
    if (cached !== undefined) return cached;
    const attribute = this.source.locals.get(name);
    if (attribute === undefined) return failure(`no local ${JSON.stringify(name)}`);
    if (this.#computing.has(name)) return failure(`local.${name} refers to itself`);
    this.#computing.add(name);
    const value = evaluate(attribute.expression, { module: this });
    this.#computing.delete(name);
    this.#locals.set(name, value);
    return value;
  }

  outputNames(): readonly string[] {
    return [...this.source.outputs.keys()].sort();
  }

  outputAt(name: string): Position | undefined {
    return this.source.outputSites.get(name) ?? this.site;
  }

  output(name: string): Value {
    const expression = this.source.outputs.get(name);
    if (expression === undefined) {
      if (this.source.described !== undefined) {
        return unknown('output-undescribed', `the output ${name} of ${this.address} is not described`);
      }
      return failure(`${this.address || 'the module'} has no output ${JSON.stringify(name)}`);
    }
    const key = `output:${name}`;
    if (this.#computing.has(key)) return failure(`output ${name} refers to itself`);
    this.#computing.add(key);
    const value = evaluate(expression, { module: this });
    this.#computing.delete(key);
    return value;
  }

  #prefix(): string {
    return this.address === '' ? '' : `${this.address}.`;
  }

  /** How a repeated block repeats, as the instances it stands for. */
  #expand(
    block: Block,
    make: (key: string | number | undefined, eachValue: Value | undefined, keyUnknown: Because | undefined) => Value,
  ): Value {
    const forEach = attributeOf(block.body, 'for_each');
    const count = attributeOf(block.body, 'count');
    if (forEach !== undefined) {
      const collection = evaluate(forEach.expression, { module: this });
      if (collection.kind === 'unknown' || collection.kind === 'ref') {
        const because: Because =
          collection.kind === 'unknown'
            ? { ...collection.because, text: `for_each = ${forEach.source} is not known: ${collection.because.text}` }
            : { reason: 'computed', text: `for_each = ${forEach.source} is known only once the deployment exists` };
        return make(undefined, undefined, because);
      }
      if (collection.kind === 'null') return object(new Map());
      if (collection.kind === 'object') {
        return object(new Map(orderedKeys(collection.entries).map((key) => [key, make(key, collection.entries.get(key), undefined)])));
      }
      if (collection.kind === 'list') {
        const entries = new Map<string, Value>();
        for (const item of collection.items) {
          const key = asText(item);
          if (key === undefined) return failure(`for_each over ${describe(collection)} needs strings`);
          entries.set(key, make(key, item, undefined));
        }
        return object(entries);
      }
      return failure(`for_each needs a map or a set, not ${describe(collection)}`);
    }
    if (count !== undefined) {
      const n = evaluate(count.expression, { module: this });
      if (n.kind === 'unknown') {
        return make(undefined, undefined, { ...n.because, text: `count = ${count.source} is not known: ${n.because.text}` });
      }
      if (n.kind !== 'number') return failure(`count needs a number, not ${describe(n)}`);
      return list(Array.from({ length: Math.max(0, Math.trunc(n.value)) }, (_, index) => make(index, undefined, undefined)));
    }
    return make(undefined, undefined, undefined);
  }

  group(mode: 'managed' | 'data', type: string, name: string): Value | undefined {
    const key = `${mode}.${type}.${name}`;
    const cached = this.#groups.get(key);
    if (cached !== undefined) return cached.value;
    const block = this.source.resources.get(key);
    if (block === undefined) return undefined;
    const instances: Instance[] = [];
    const base = `${this.#prefix()}${mode === 'data' ? 'data.' : ''}${type}.${name}`;
    const value = this.#expand(block, (instanceKey, eachValue, keyUnknown) => {
      const suffix = keyUnknown !== undefined ? '[?]' : instanceKey === undefined ? '' : typeof instanceKey === 'number' ? `[${instanceKey}]` : `[${JSON.stringify(instanceKey)}]`;
      const instance: Instance = {
        mode,
        type,
        name,
        block,
        module: this,
        address: `${base}${suffix}`,
        ...(instanceKey === undefined ? {} : { key: instanceKey }),
        ...(keyUnknown === undefined ? {} : { keyUnknown }),
        ...(eachValue === undefined ? {} : { eachValue }),
      };
      instances.push(instance);
      return { kind: 'instance', instance };
    });
    this.#groups.set(key, { value, instances });
    return value;
  }

  instances(): readonly Instance[] {
    const out: Instance[] = [];
    for (const key of this.source.resources.keys()) {
      const [mode, type, ...rest] = key.split('.');
      this.group(mode as 'managed' | 'data', type as string, rest.join('.'));
      out.push(...(this.#groups.get(key)?.instances ?? []));
    }
    return out;
  }

  scopeOf(instance: Instance): Scope {
    if (instance.keyUnknown !== undefined) {
      const because = instance.keyUnknown;
      const blank: Value = { kind: 'unknown', because };
      return { module: this, each: { key: blank, value: blank }, count: blank };
    }
    if (typeof instance.key === 'string') {
      return { module: this, each: { key: str(instance.key), value: instance.eachValue ?? str(instance.key) } };
    }
    if (typeof instance.key === 'number') return { module: this, count: num(instance.key) };
    return { module: this };
  }

  argument(instance: Instance, name: string): Value | undefined {
    let cache = this.#arguments.get(instance);
    if (cache === undefined) {
      cache = new Map();
      this.#arguments.set(instance, cache);
    }
    if (cache.has(name)) return cache.get(name);
    const attribute = attributeOf(instance.block.body, name);
    if (attribute === undefined) {
      cache.set(name, undefined);
      return undefined;
    }
    const marker = `${instance.address}#${name}`;
    if (this.#computing.has(marker)) return failure(`${instance.address}.${name} refers to itself`);
    this.#computing.add(marker);
    const value = withVia(evaluate(attribute.expression, this.scopeOf(instance)), instance, name);
    this.#computing.delete(marker);
    cache.set(name, value);
    return value;
  }

  nested(instance: Instance, name: string): readonly Value[] {
    const scope = this.scopeOf(instance);
    const out: Value[] = blocksOf(instance.block.body, name).map((block) => bodyValue(block.body, scope));
    for (const dynamic of blocksOf(instance.block.body, 'dynamic')) {
      if (dynamic.labels[0] !== name) continue;
      const forEach = attributeOf(dynamic.body, 'for_each');
      const content = blocksOf(dynamic.body, 'content')[0];
      if (forEach === undefined || content === undefined) continue;
      const iterator = attributeOf(dynamic.body, 'iterator')?.expression;
      const iteratorName = iterator?.type === 'variable' ? iterator.name : (iterator === undefined ? undefined : templateText(iterator)) ?? name;
      const pairs = iterate(evaluate(forEach.expression, scope));
      if (!Array.isArray(pairs)) {
        out.push(pairs);
        continue;
      }
      for (const [key, value] of pairs) {
        const bound = object(new Map([['key', key], ['value', value]]));
        out.push(bodyValue(content.body, withNames(scope, new Map([[iteratorName, bound]]))));
      }
    }
    return out;
  }

  call(name: string): Value | undefined {
    const cached = this.#calls.get(name);
    if (cached !== undefined) return cached.value;
    const block = this.source.calls.get(name);
    if (block === undefined) return undefined;
    const modules: Module[] = [];
    const resolved = this.#resolveCall(name, block);
    const value =
      'because' in resolved
        ? resolved
        : this.#expand(block, (key, eachValue, keyUnknown) => {
            const suffix = keyUnknown !== undefined ? '[?]' : key === undefined ? '' : typeof key === 'number' ? `[${key}]` : `[${JSON.stringify(key)}]`;
            const address = `${this.#prefix()}module.${name}${suffix}`;
            const callScope: Scope =
              keyUnknown !== undefined
                ? { module: this, each: { key: { kind: 'unknown', because: keyUnknown }, value: { kind: 'unknown', because: keyUnknown } }, count: { kind: 'unknown', because: keyUnknown } }
                : typeof key === 'string'
                  ? { module: this, each: { key: str(key), value: eachValue ?? str(key) } }
                  : typeof key === 'number'
                    ? { module: this, count: num(key) }
                    : { module: this };
            const inputs = new Map<string, Input>();
            for (const attribute of block.body.attributes) {
              if (CALL_META.has(attribute.name)) continue;
              let memo: Value | undefined;
              inputs.set(attribute.name, {
                written: { expression: attribute.expression, scope: callScope },
                value: () => {
                  memo ??= evaluate(attribute.expression, callScope);
                  return memo;
                },
              });
            }
            const pathModule =
              resolved.described === undefined ? posix.relative(this.rootDir || '.', resolved.dir || '.') || '.' : this.pathModule;
            const child = new Module(
              this.context,
              resolved,
              address,
              this.root ?? this,
              pathModule,
              inputs,
              resolved.described === undefined ? undefined : block.pos,
              this.depth + 1,
            );
            modules.push(child);
            return { kind: 'module', module: child };
          });
    this.#calls.set(name, { value, modules });
    return value;
  }

  /** The source a call names, or an unknown saying why it cannot be read. */
  #resolveCall(name: string, block: Block): ModuleSource | Extract<Value, { kind: 'unknown' }> {
    const sourceAttribute = attributeOf(block.body, 'source');
    const written = sourceAttribute === undefined ? undefined : templateText(sourceAttribute.expression);
    const where = `${this.#prefix()}module.${name}`;
    if (written === undefined) {
      return { kind: 'unknown', because: { reason: 'module-source-unread', text: `the source of ${where} is not a literal` } };
    }
    if (this.depth > 16) {
      return { kind: 'unknown', because: { reason: 'module-depth', text: `${where} is nested too deeply to follow` } };
    }
    if (isLocalSource(written)) {
      const dir = posix.normalize(posix.join(this.source.dir || '.', written)).replace(/\/$/, '');
      const target = this.context.sources.get(dir === '.' ? '' : dir);
      if (target !== undefined) return target;
      this.context.row(`missing:${block.pos.file}:${block.pos.line}`, {
        file: block.pos.file,
        line: block.pos.line,
        reason: 'infra-module-missing',
        message: `${where} names ${written}, and there is no configuration there`,
        hint: 'Check the path: a local module source is relative to the directory of the file calling it.',
        symbol: where,
      });
      return { kind: 'unknown', because: { reason: 'module-missing', text: `${where} names ${written}, which holds no configuration` } };
    }
    const description = describedModule(written, this.context.options.descriptions);
    if (description !== undefined) return this.context.described(description, block.pos);
    const inputs = block.body.attributes.filter((attribute) => !CALL_META.has(attribute.name)).map((attribute) => attribute.name);
    // A module whose inputs carry a handler, a function's name, a route, or a
    // queue, topic, rule or subscription is a module a way in or a subscriber
    // is declared through, and leaving it undescribed leaves those out of the
    // graph; anything else is infrastructure this reading has no use for, and
    // is said once at the level that says so.
    const relevant = inputs.some((input) =>
      /handler|function|lambda|route|http_method|path_part|integration|invoke|queue|topic|rule|bus|subscription|target|schedule|pipe/i.test(input),
    );
    this.context.row(`undescribed:${block.pos.file}:${block.pos.line}`, {
      file: block.pos.file,
      line: block.pos.line,
      reason: 'infra-module-undescribed',
      ...(relevant ? {} : { level: 'info' as const }),
      message: `${where} comes from ${written}, which is not in this repository and is not described, so nothing it declares is read; it is given ${inputs.length === 0 ? 'no inputs' : inputs.join(', ')}`,
      hint: `Describe it under adapters.infra.modules: its source, and each resource it declares as "type.name" with its arguments written over var.<input>${relevant ? ' — for example "aws_lambda_function.this": { "function_name": "var.function_name", "handler": "var.handler" }' : ''}.`,
      symbol: written,
      meta: { module: where, source: written, inputs },
    });
    return { kind: 'unknown', because: { reason: 'module-undescribed', text: `${where} comes from ${written}, which is not described` } };
  }

  children(): readonly Module[] {
    const out: Module[] = [];
    for (const name of this.source.calls.keys()) {
      this.call(name);
      out.push(...(this.#calls.get(name)?.modules ?? []));
    }
    return out;
  }

  written(kind: 'var' | 'local', name: string): Written | undefined {
    if (kind === 'local') {
      const attribute = this.source.locals.get(name);
      return attribute === undefined ? undefined : { expression: attribute.expression, scope: { module: this } };
    }
    const input = this.inputs?.get(name);
    if (input !== undefined) return input.written;
    // A root module's variable is whatever its variable files say, which is a
    // value and not an expression of this repository.
    if (this.root === undefined) return undefined;
    const fallback = this.source.variables.get(name)?.default;
    return fallback === undefined ? undefined : { expression: fallback, scope: { module: this } };
  }

  readFile(path: string): string | undefined {
    const absolute = isAbsolute(path) ? path : join(this.context.options.repoDir, this.rootDir, path);
    try {
      return readFileSync(absolute, 'utf8');
    } catch {
      return undefined;
    }
  }
}

/** A nested block as an object of its arguments and, below them, its own nested blocks. */
const bodyValue = (body: Body, scope: Scope): Value => {
  const entries = new Map<string, Value>();
  for (const attribute of body.attributes) entries.set(attribute.name, evaluate(attribute.expression, scope));
  const byType = new Map<string, Value[]>();
  for (const block of body.blocks) {
    byType.set(block.type, [...(byType.get(block.type) ?? []), bodyValue(block.body, scope)]);
  }
  for (const [type, values] of byType) if (!entries.has(type)) entries.set(type, list(values));
  return object(entries);
};

const readTfvars = (repoDir: string, file: string, rows: Unresolved[]): Tfvars | undefined => {
  let text: string;
  try {
    text = readFileSync(join(repoDir, file), 'utf8');
  } catch {
    return undefined;
  }
  if (file.endsWith('.json')) {
    try {
      const parsed = fromJson(JSON.parse(text));
      return { file, values: parsed.kind === 'object' ? parsed.entries : new Map() };
    } catch {
      rows.push({ file, line: 1, reason: 'infra-file-unparsed', message: `${file} is not JSON`, hint: 'Correct the file; nothing in it was read.' });
      return undefined;
    }
  }
  try {
    const parsed = parseHcl(text, file);
    const values = new Map<string, Value>();
    const nowhere = { module: undefined as unknown as ModuleInstance } as Scope;
    for (const attribute of parsed.body.attributes) values.set(attribute.name, evaluate(attribute.expression, nowhere));
    return { file, values };
  } catch (error) {
    if (!(error instanceof HclSyntaxError)) throw error;
    rows.push({ file, line: error.line, reason: 'infra-file-unparsed', message: `${file} does not parse: ${error.reason}`, hint: 'Correct the syntax; nothing in this file was read.' });
    return undefined;
  }
};

/**
 * Reads a repository's configuration: every directory of it, which of them are
 * root modules, and the module tree below each root.
 *
 * A root module is a directory nothing in the repository calls as a module.
 * That is the definition Terraform itself uses when it is run in a directory,
 * and the only one the files alone can answer.
 */
export const loadConfiguration = (options: LoadOptions): Configuration => {
  const rows: Unresolved[] = [];
  const all = infrastructureFiles(options.repoDir);
  const byDir = new Map<string, HclFile[]>();
  for (const file of all) {
    if (file.endsWith('.tf.json')) {
      rows.push({
        file,
        line: 1,
        reason: 'infra-file-unread',
        level: 'info',
        message: `${file} is configuration written as JSON, which is not read`,
        hint: 'Only the native syntax is read. Anything this file declares is missing from the graph.',
      });
      continue;
    }
    if (!file.endsWith('.tf')) continue;
    let text: string;
    try {
      text = readFileSync(join(options.repoDir, file), 'utf8');
    } catch {
      continue;
    }
    try {
      const parsed = parseHcl(text, file);
      const dir = dirOf(file);
      byDir.set(dir, [...(byDir.get(dir) ?? []), parsed]);
    } catch (error) {
      if (!(error instanceof HclSyntaxError)) throw error;
      rows.push({
        file,
        line: error.line,
        reason: 'infra-file-unparsed',
        message: `${file} does not parse at line ${error.line}: ${error.reason}`,
        hint: 'Nothing in this file was read. If it is valid, this is a defect in the reader: please report it with the line.',
      });
    }
  }

  const sources = new Map<string, ModuleSource>();
  for (const [dir, files] of byDir) sources.set(dir, sourceOf(dir, files));

  const called = new Set<string>();
  for (const source of sources.values()) {
    for (const block of source.calls.values()) {
      const attribute = attributeOf(block.body, 'source');
      const written = attribute === undefined ? undefined : templateText(attribute.expression);
      if (written === undefined || !isLocalSource(written)) continue;
      const target = posix.normalize(posix.join(source.dir || '.', written)).replace(/\/$/, '');
      if (target !== source.dir) called.add(target === '.' ? '' : target);
    }
  }
  const rootDirs = [...sources.keys()].filter((dir) => !called.has(dir)).sort();

  const tfvars = all
    .filter((file) => /\.tfvars(?:\.json)?$/.test(file))
    .map((file) => readTfvars(options.repoDir, file, rows))
    .filter((vars): vars is Tfvars => vars !== undefined);

  const context = new Context(options, sources, tfvars, rootDirs);
  const roots = rootDirs.map(
    (dir) => new Module(context, sources.get(dir) as ModuleSource, '', undefined, '.', undefined, undefined, 0),
  );

  const modules = (): ModuleInstance[] => {
    const out: ModuleInstance[] = [];
    const visit = (module: Module): void => {
      out.push(module);
      for (const child of module.children()) visit(child);
    };
    for (const root of roots) visit(root);
    return out;
  };

  return {
    roots,
    modules,
    // Rows a module call raises are found while the tree is walked, so the list
    // is read when it is asked for rather than when loading finished.
    get rows() {
      return [...rows, ...context.rows];
    },
    stateOf: (root) => {
      const module = root as Module;
      for (const block of module.source.terraform) {
        const backend = blocksOf(block.body, 'backend')[0];
        if (backend !== undefined) {
          const settings = bodyValue(backend.body, { module });
          if (settings.kind !== 'object') return undefined;
          return stateAddress(backend.labels[0] ?? 'local', settings.entries);
        }
        const cloud = blocksOf(block.body, 'cloud')[0];
        if (cloud !== undefined) {
          const settings = bodyValue(cloud.body, { module });
          if (settings.kind !== 'object') return undefined;
          const workspaces = settings.entries.get('workspaces');
          const flat = new Map(settings.entries);
          if (workspaces?.kind === 'list' && workspaces.items[0]?.kind === 'object') flat.set('workspaces', workspaces.items[0]);
          return stateAddress('remote', flat);
        }
      }
      return undefined;
    },
  };
};

