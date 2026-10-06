import { posix } from 'node:path';
import {
  makeHttpEntryKey,
  normalizePath,
  UNREAD_SPAN,
  type DeployedFunction,
  type DeployedHandler,
  type DeployedRoute,
  type Deployment,
  type PublishedRoot,
  type RouteTarget,
  type Unresolved,
} from '@flowatlas/core';
import { attributeOf } from '../hcl/ast.js';
import { referencesIn } from '../hcl/walk.js';
import { attributeOfInstance, evaluate } from '../eval/evaluate.js';
import { asText, describe, type Because, type Instance, type Value } from '../eval/values.js';
import { stateAddress, type Configuration } from '../configuration/load.js';

/**
 * Functions and the routes in front of them, read out of a configuration.
 *
 * Everything here is about one cloud's resources, which is why it is a module of
 * its own: the loader and the evaluator know the language and nothing about
 * what a resource of a given type means, and this knows what a function, a REST
 * resource tree and an HTTP API route are and nothing about how their arguments
 * were evaluated.
 */

/** Where an instance is declared from the repository's point of view. */
const siteOf = (instance: Instance): { file: string; line: number } => {
  const at = instance.module.site ?? instance.block.pos;
  return { file: at.file, line: at.line };
};

const argument = (instance: Instance, name: string): Value | undefined => instance.module.argument(instance, name);

const textOf = (value: Value | undefined): string | undefined => (value === undefined ? undefined : asText(value));

/** Why a value is not a string, as a `Because`. */
const whyNot = (value: Value | undefined, what: string): Because => {
  if (value === undefined) return { reason: 'absent', text: `${what} is not set` };
  if (value.kind === 'unknown') return value.because;
  if (value.kind === 'ref') return { reason: 'computed', text: `${what} is ${describe(value)}, known only once it has been created` };
  return { reason: 'not-a-string', text: `${what} is ${describe(value)}` };
};

/**
 * Every reference written inside an argument, each evaluated on its own.
 *
 * `"arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${aws_lambda_function.x.arn}/invocations"`
 * is a string nobody can finish, and it names a function as plainly as an
 * argument that is only the reference. Asking each reference separately is how
 * the function is still found.
 */
const referencesOf = (instance: Instance, name: string): Value[] => {
  const attribute = attributeOf(instance.block.body, name);
  if (attribute === undefined) return [];
  const scope = instance.module.scopeOf(instance);
  return [...referencesIn(attribute.expression)].map((reference) => evaluate(reference, scope));
};

const FUNCTION_ARN = /:function:([A-Za-z0-9_-]+)/;

/** The repo-relative form of a path written relative to a root module. */
const repoPath = (instance: Instance, path: string): string => {
  const rootDir = instance.module.root?.dir ?? instance.module.dir;
  return posix.normalize(posix.join(rootDir === '' ? '.' : rootDir, path)).replace(/\/$/, '');
};

/** `{loanId}` is a parameter and `{proxy+}` takes the rest of the path. */
const routeSegment = (part: string): string => (/^\{[^}]+\+\}$/.test(part) ? '*' : part);

const joinSegments = (base: string, part: string): string =>
  `${base.replace(/\/$/, '')}/${part.split('/').filter((segment) => segment !== '').map(routeSegment).join('/')}`;

type PathResult =
  | { readonly kind: 'path'; readonly path: string; readonly api?: string }
  | { readonly kind: 'root'; readonly key: string; readonly below: string }
  | { readonly kind: 'unknown'; readonly because: Because };

const nameOfApi = (instance: Instance): string | undefined => textOf(argument(instance, 'name'));

export class DeploymentReading {
  readonly functions: DeployedFunction[] = [];
  readonly routes: DeployedRoute[] = [];
  readonly roots: PublishedRoot[] = [];
  readonly rows: Unresolved[] = [];
  readonly #functionIndex = new Map<Instance, number>();
  readonly #instances: Instance[];

  constructor(readonly configuration: Configuration) {
    this.#instances = configuration.modules().flatMap((module) => module.instances());
  }

  #ofType(mode: 'managed' | 'data', type: string): Instance[] {
    return this.#instances.filter((instance) => instance.mode === mode && instance.type === type);
  }

  /**
   * What each resource type is read as, in the order they are read.
   *
   * A table rather than a run of loops, so that a resource type the next ticket
   * reads - a state machine, a rule, an event-source mapping - is a row here.
   * Functions come first because a route names one by its position among them.
   */
  readonly #readers: ReadonlyArray<readonly [type: string, read: (instance: Instance) => void]> = [
    ['aws_lambda_function', (instance) => this.#function(instance)],
    ['aws_api_gateway_method', (instance) => this.#restRoute(instance)],
    ['aws_apigatewayv2_route', (instance) => this.#httpRoute(instance)],
    ['aws_api_gateway_rest_api', (instance) => this.#restApi(instance)],
  ];

  read(): Deployment {
    for (const [type, read] of this.#readers) {
      for (const instance of this.#ofType('managed', type)) read(instance);
    }
    this.#publishedRoots();
    return {
      functions: this.functions,
      routes: this.routes,
      roots: this.roots,
      rows: [...this.configuration.rows, ...this.rows],
    };
  }

  #restApi(instance: Instance): void {
    if (argument(instance, 'body') === undefined) return;
    this.rows.push({
      ...siteOf(instance),
      reason: 'api-body-unread',
      level: 'info',
      message: `${instance.address} declares its routes in an OpenAPI body, which is not read`,
      hint: 'Routes declared as resources and methods are read. To read these, describe the service with a document of kind openapi instead.',
      symbol: instance.address,
    });
  }

  // ------------------------------------------------------------- functions

  #function(instance: Instance): void {
    const at = siteOf(instance);
    const nameValue = argument(instance, 'function_name');
    const name = textOf(nameValue);
    const runtime = textOf(argument(instance, 'runtime'));
    const packageType = textOf(argument(instance, 'package_type'));
    const handler = packageType === 'Image' ? undefined : this.#handler(instance, at);
    if (name === undefined) this.#nameRow(instance, at, nameValue);
    if (runtime !== undefined && !runtime.startsWith('nodejs')) {
      this.rows.push({
        ...at,
        reason: 'function-runtime-unread',
        level: 'info',
        message: `${name ?? instance.address} runs on ${runtime}; only Node.js handlers are read, so its body is not`,
        hint: 'The function is still in the graph under its name, and whatever invokes it still joins to it.',
        symbol: instance.address,
      });
    }
    if (packageType === 'Image') {
      this.rows.push({
        ...at,
        reason: 'function-image-unread',
        level: 'info',
        message: `${name ?? instance.address} is deployed as a container image, whose handler is set inside the image`,
        hint: 'The function is in the graph under its name; the code it runs is not pointed at.',
        symbol: instance.address,
      });
    }
    this.#functionIndex.set(instance, this.functions.length);
    this.functions.push({
      ...at,
      ...(name === undefined ? {} : { name }),
      address: instance.address,
      ...(handler === undefined ? {} : { handler }),
      ...(runtime === undefined ? {} : { runtime }),
      meta: {
        declaredAs: instance.address,
        ...(name === undefined ? { nameUnread: whyNot(nameValue, 'function_name').text } : {}),
      },
    });
  }

  #nameRow(instance: Instance, at: { file: string; line: number }, value: Value | undefined): void {
    const because = whyNot(value, 'function_name');
    if (instance.keyUnknown !== undefined) {
      this.rows.push({
        ...at,
        reason: 'function-repeated-unread',
        message: `${instance.address} is one function per element of something not known here, so neither how many there are nor their names are read: ${instance.keyUnknown.text}`,
        hint: because.variable === undefined
          ? 'Give the collection a value the files settle - a default, or a variable file - and each function is read under its own name.'
          : `Give var.${because.variable} a default or set it in a variable file${because.files === undefined ? '' : ', or choose one of the files under services[].infra.vars'}; each function is then read under its own name.`,
        symbol: instance.address,
        meta: { because: because.reason, ...(because.variable === undefined ? {} : { variable: because.variable }) },
      });
      return;
    }
    if (because.reason === 'variable-disputed') {
      const files = Object.keys(because.files ?? {});
      this.rows.push({
        ...at,
        reason: 'function-name-disputed',
        message: `the name of ${instance.address} depends on var.${because.variable ?? '?'}, which the variable files set differently: ${because.text}`,
        hint: `Choose the environment to read under services[].infra.vars, for example ["${files[0] ?? 'env/dev.tfvars'}"]. Until then the function has no name and nothing can join to it.`,
        symbol: instance.address,
        meta: { variable: because.variable, files: because.files },
      });
      return;
    }
    this.rows.push({
      ...at,
      reason: 'function-name-unread',
      message: `the name of ${instance.address} is not read: ${because.text}`,
      hint: because.variable === undefined
        ? 'Nothing can join to a function whose name is not read. Write the name so the files settle it, or describe the module it comes from.'
        : `Give var.${because.variable}${because.module ? ` of ${because.module}` : ''} a value the files settle: a default, or a variable file.`,
      symbol: instance.address,
      meta: { because: because.reason, ...(because.variable === undefined ? {} : { variable: because.variable }) },
    });
  }

  /** The handler string and the directory the deployment packages. */
  #handler(instance: Instance, at: { file: string; line: number }): DeployedHandler | undefined {
    const value = argument(instance, 'handler');
    const written = textOf(value);
    if (written === undefined) {
      if (value?.kind === 'null') return undefined;
      const because = whyNot(value, 'handler');
      this.rows.push({
        ...at,
        reason: 'function-handler-unread',
        message: `the handler of ${instance.address} is not read: ${because.text}`,
        hint: because.variable === undefined
          ? 'Write the handler as a string the files settle, such as "index.handler".'
          : `Give var.${because.variable} a value the files settle.`,
        symbol: instance.address,
      });
      return undefined;
    }
    const dot = written.lastIndexOf('.');
    if (dot <= 0 || dot === written.length - 1) {
      this.rows.push({
        ...at,
        reason: 'function-handler-unread',
        message: `the handler of ${instance.address} is ${JSON.stringify(written)}, which does not say a module and an export`,
        hint: 'A Node.js handler is written "<module>.<export>", such as "index.handler".',
        symbol: instance.address,
      });
      return undefined;
    }
    const source = this.#sourceDirectory(instance);
    return {
      written,
      module: written.slice(0, dot),
      export: written.slice(dot + 1),
      ...(source === undefined ? {} : { directory: source.directory, directoryFrom: source.from }),
    };
  }

  /**
   * The directory a function's package is built from, where the files say.
   *
   * Through an archive the configuration builds (`data.archive_file.x.output_path`
   * as the function's `filename`), or a file the function names directly. A zip
   * built by a script somewhere else is not something the files describe; the
   * adapter then searches for the handler's module by name and says so.
   */
  #sourceDirectory(instance: Instance): { directory: string; from: string } | undefined {
    // The archive is either where the value came from, or - when its output
    // path is not written out, as in a described module - the reference itself.
    const filename = argument(instance, 'filename');
    const archive =
      filename?.kind === 'ref' ? filename.target : filename !== undefined && 'via' in filename ? filename.via?.target : undefined;
    if (archive !== undefined && archive.type === 'archive_file') {
      const dir = textOf(argument(archive, 'source_dir'));
      if (dir !== undefined) return { directory: repoPath(instance, dir), from: `${archive.address}.source_dir` };
      const file = textOf(argument(archive, 'source_file'));
      if (file !== undefined) return { directory: posix.dirname(repoPath(instance, file)), from: `${archive.address}.source_file` };
    }
    return undefined;
  }

  // ---------------------------------------------------------------- routes

  /** The path a REST resource id stands for. */
  #resourcePath(value: Value | undefined, depth = 0): PathResult {
    if (value === undefined) return { kind: 'unknown', because: { reason: 'absent', text: 'the resource is not set' } };
    if (depth > 32) return { kind: 'unknown', because: { reason: 'depth', text: 'the resource tree is too deep to follow' } };
    if (value.kind === 'unknown') return { kind: 'unknown', because: value.because };
    if (value.kind !== 'ref') {
      return { kind: 'unknown', because: { reason: 'literal-id', text: `the resource is ${describe(value)}, an id this reading cannot place` } };
    }
    const target = value.target;
    const attribute = value.attribute.join('.');
    if (target.mode === 'managed' && target.type === 'aws_api_gateway_resource' && attribute === 'id') {
      const parent = this.#resourcePath(argument(target, 'parent_id'), depth + 1);
      const partValue = argument(target, 'path_part');
      const part = textOf(partValue);
      if (part === undefined) return { kind: 'unknown', because: whyNot(partValue, `path_part of ${target.address}`) };
      if (parent.kind === 'unknown') return parent;
      if (parent.kind === 'root') return { kind: 'root', key: parent.key, below: joinSegments(parent.below, part) };
      return { kind: 'path', path: joinSegments(parent.path, part), ...(parent.api === undefined ? {} : { api: parent.api }) };
    }
    if (target.type === 'aws_api_gateway_rest_api' && attribute === 'root_resource_id') {
      const api = nameOfApi(target);
      return { kind: 'path', path: '/', ...(api === undefined ? {} : { api }) };
    }
    if (target.mode === 'data' && target.type === 'aws_api_gateway_resource' && attribute === 'id') {
      const pathValue = argument(target, 'path');
      const path = textOf(pathValue);
      if (path === undefined) return { kind: 'unknown', because: whyNot(pathValue, `path of ${target.address}`) };
      const api = this.#apiName(argument(target, 'rest_api_id'));
      return { kind: 'path', path: joinSegments('/', path), ...(api === undefined ? {} : { api }) };
    }
    if (target.mode === 'data' && target.type === 'aws_ssm_parameter' && (attribute === 'value' || attribute === 'insecure_value')) {
      const nameValue = argument(target, 'name');
      const name = textOf(nameValue);
      if (name === undefined) return { kind: 'unknown', because: whyNot(nameValue, `name of ${target.address}`) };
      return { kind: 'root', key: `parameter:${name}`, below: '/' };
    }
    if (target.mode === 'data' && target.type === 'terraform_remote_state' && value.attribute[0] === 'outputs') {
      const output = value.attribute[1];
      const backend = textOf(argument(target, 'backend')) ?? 'local';
      const settings = argument(target, 'config');
      const address = settings?.kind === 'object' ? stateAddress(backend, settings.entries) : undefined;
      if (output === undefined || address === undefined) {
        return { kind: 'unknown', because: { reason: 'state-unread', text: `the state ${target.address} reads is not one the files settle` } };
      }
      return { kind: 'root', key: `state:${address}#${String(output)}`, below: '/' };
    }
    return { kind: 'unknown', because: { reason: 'unplaced', text: `${describe(value)} is not a resource this reading can place` } };
  }

  #apiName(value: Value | undefined): string | undefined {
    if (value?.kind !== 'ref') return undefined;
    const target = value.target;
    if (target.type === 'aws_api_gateway_rest_api' || target.type === 'aws_apigatewayv2_api') return nameOfApi(target);
    return undefined;
  }

  /** The function a URI, an ARN or a name stands for. */
  #targetOf(instance: Instance, argumentName: string): RouteTarget | Because | undefined {
    const value = argument(instance, argumentName);
    const candidates = value === undefined ? [] : [value, ...referencesOf(instance, argumentName)];
    for (const candidate of candidates) {
      const found = this.#functionOf(candidate);
      if (found !== undefined) return found;
    }
    const text = textOf(value);
    const named = text === undefined ? undefined : FUNCTION_ARN.exec(text)?.[1];
    if (named !== undefined) return { name: named };
    if (value === undefined) return undefined;
    return whyNot(value, `${argumentName} of ${instance.address}`);
  }

  #functionOf(value: Value, depth = 0): RouteTarget | undefined {
    if (depth > 8) return undefined;
    const via = 'via' in value ? value.via : undefined;
    const target = value.kind === 'ref' ? value.target : value.kind === 'instance' ? value.instance : via?.target;
    if (target === undefined) return undefined;
    if (target.type === 'aws_lambda_function' && target.mode === 'managed') {
      const index = this.#functionIndex.get(target);
      return index === undefined ? undefined : { function: index };
    }
    if (target.type === 'aws_lambda_function' && target.mode === 'data') {
      const name = textOf(argument(target, 'function_name'));
      return name === undefined ? undefined : { name };
    }
    if (target.type === 'aws_lambda_alias') {
      const inner = argument(target, 'function_name');
      return inner === undefined ? undefined : this.#functionOf(inner, depth + 1);
    }
    return undefined;
  }

  #guards(instance: Instance, typeArgument: string): { label: string; file: string; line: number }[] {
    const kind = textOf(argument(instance, typeArgument));
    if (kind === undefined || kind === 'NONE') return [];
    const authorizer = argument(instance, 'authorizer_id');
    const named = authorizer?.kind === 'ref' ? textOf(attributeOfInstance(authorizer.target, 'name')) : undefined;
    const at = siteOf(instance);
    return [{ label: named ?? kind, ...at }];
  }

  #pushRoute(
    instance: Instance,
    method: string,
    path: PathResult,
    rawPath: string,
    target: RouteTarget | Because | undefined,
    api: string | undefined,
    guards: { label: string; file: string; line: number }[],
  ): void {
    const at = siteOf(instance);
    if (path.kind === 'unknown') {
      this.rows.push({
        ...at,
        reason: 'route-path-unread',
        message: `the path of ${method} ${instance.address} is not read: ${path.because.text}`,
        hint: path.because.variable === undefined
          ? 'A route whose path is not read cannot be joined to anything that calls it.'
          : `Give var.${path.because.variable} a value the files settle.`,
        symbol: instance.address,
      });
      return;
    }
    if (target !== undefined && !('function' in target) && !('name' in target)) {
      this.rows.push({
        ...at,
        reason: 'route-target-unread',
        message: `which function answers ${method} ${path.kind === 'path' ? path.path : `${UNREAD_SPAN}${path.below}`} is not read: ${target.text}`,
        hint: 'Point the integration at a function the files declare, or at one by a name they settle.',
        symbol: instance.address,
      });
    }
    const resolvedTarget = target !== undefined && ('function' in target || 'name' in target) ? target : undefined;
    const fullPath = path.kind === 'path' ? normalizePath(path.path) : normalizePath(`${UNREAD_SPAN}${path.below}`);
    const routeApi = path.kind === 'path' ? (path.api ?? api) : api;
    this.routes.push({
      ...at,
      method,
      path: fullPath,
      rawPath,
      ...(routeApi === undefined ? {} : { api: routeApi }),
      ...(resolvedTarget === undefined ? {} : { target: resolvedTarget }),
      ...(path.kind === 'root' ? { root: { key: path.key, below: normalizePath(path.below) } } : {}),
      ...(guards.length === 0 ? {} : { guards }),
      meta: { declaredAs: instance.address, key: makeHttpEntryKey(method, fullPath) },
    });
  }

  #restRoute(instance: Instance): void {
    const verb = textOf(argument(instance, 'http_method'));
    const at = siteOf(instance);
    if (verb === undefined) {
      this.rows.push({
        ...at,
        reason: 'route-path-unread',
        message: `the verb of ${instance.address} is not read: ${whyNot(argument(instance, 'http_method'), 'http_method').text}`,
        hint: 'Write the verb as a string the files settle.',
        symbol: instance.address,
      });
      return;
    }
    const method = verb.toUpperCase() === 'ANY' ? 'ALL' : verb.toUpperCase();
    const resource = argument(instance, 'resource_id');
    const path = this.#resourcePath(resource);
    const api = this.#apiName(argument(instance, 'rest_api_id'));
    const integration = this.#ofType('managed', 'aws_api_gateway_integration').find((candidate) => {
      const sameResource = this.#sameValue(argument(candidate, 'resource_id'), resource);
      const theirVerb = textOf(argument(candidate, 'http_method'));
      return sameResource && theirVerb !== undefined && theirVerb.toUpperCase() === verb.toUpperCase();
    });
    const type = integration === undefined ? undefined : textOf(argument(integration, 'type'));
    const proxied = type === undefined || type === 'AWS_PROXY' || type === 'AWS';
    const target = integration === undefined || !proxied ? undefined : this.#targetOf(integration, 'uri');
    const rawPath = path.kind === 'path' ? path.path : path.kind === 'root' ? path.below : '?';
    this.#pushRoute(instance, method, path, rawPath, target, api, this.#guards(instance, 'authorization'));
  }

  #sameValue(a: Value | undefined, b: Value | undefined): boolean {
    if (a === undefined || b === undefined) return false;
    if (a.kind === 'ref' && b.kind === 'ref') return a.target === b.target && a.attribute.join('.') === b.attribute.join('.');
    const ta = textOf(a);
    return ta !== undefined && ta === textOf(b);
  }

  #httpRoute(instance: Instance): void {
    const at = siteOf(instance);
    const apiValue = argument(instance, 'api_id');
    const apiTarget = apiValue?.kind === 'ref' ? apiValue.target : undefined;
    if (apiTarget !== undefined && textOf(argument(apiTarget, 'protocol_type')) === 'WEBSOCKET') return;
    const keyValue = argument(instance, 'route_key');
    const key = textOf(keyValue);
    if (key === undefined) {
      this.rows.push({
        ...at,
        reason: 'route-path-unread',
        message: `the route key of ${instance.address} is not read: ${whyNot(keyValue, 'route_key').text}`,
        hint: 'Write the route key as a string the files settle, such as "POST /loans".',
        symbol: instance.address,
      });
      return;
    }
    const [verb, rawPath] = key === '$default' ? ['ANY', '/{proxy+}'] : key.split(/\s+/, 2);
    if (verb === undefined || rawPath === undefined) return;
    const method = verb.toUpperCase() === 'ANY' ? 'ALL' : verb.toUpperCase();
    const integration = referencesOf(instance, 'target')
      .map((value) => (value.kind === 'ref' ? value.target : value.kind === 'instance' ? value.instance : undefined))
      .find((target) => target?.type === 'aws_apigatewayv2_integration');
    const type = integration === undefined ? undefined : textOf(argument(integration, 'integration_type'));
    const target =
      integration === undefined || (type !== undefined && type !== 'AWS_PROXY')
        ? undefined
        : this.#targetOf(integration, 'integration_uri');
    const api = this.#apiName(apiValue);
    this.#pushRoute(instance, method, { kind: 'path', path: joinSegments('/', rawPath) }, rawPath, target, api, this.#guards(instance, 'authorization_type'));
  }

  // ----------------------------------------------------------------- roots

  /**
   * Points of an API this deployment publishes for others to hang routes from:
   * a parameter whose value is a resource's id, or an output of a root module
   * whose state another deployment reads.
   */
  #publishedRoots(): void {
    for (const instance of this.#ofType('managed', 'aws_ssm_parameter')) {
      const name = textOf(argument(instance, 'name'));
      const value = argument(instance, 'value') ?? argument(instance, 'insecure_value');
      if (name === undefined || value === undefined) continue;
      const path = this.#resourcePath(value);
      if (path.kind !== 'path') continue;
      this.roots.push({ key: `parameter:${name}`, path: normalizePath(path.path), ...(path.api === undefined ? {} : { api: path.api }), ...siteOf(instance) });
    }
    for (const root of this.configuration.roots) {
      const state = this.configuration.stateOf(root);
      if (state === undefined) continue;
      for (const output of root.outputNames()) {
        const path = this.#resourcePath(root.output(output));
        if (path.kind !== 'path') continue;
        const at = root.outputAt(output);
        this.roots.push({
          key: `state:${state}#${output}`,
          path: normalizePath(path.path),
          ...(path.api === undefined ? {} : { api: path.api }),
          file: at?.file ?? root.dir,
          line: at?.line ?? 1,
        });
      }
    }
  }
}
