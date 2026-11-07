import { existsSync } from 'node:fs';
import { isAbsolute, join, posix, relative } from 'node:path';
import {
  cognitoTriggerKey,
  DEFAULT_EVENT_BUS,
  deployedArn,
  deployedNameIn,
  destinationOf,
  eventPatternOf,
  S3_DETAIL_TYPES,
  S3_EVENT_SOURCE,
} from '@flowatlas/aws';
import {
  exportKey,
  generatedName,
  importedName,
  makeFunctionUrlEntryKey,
  makeHttpEntryKey,
  normalizePath,
  stackOutputKey,
  toPosixPath,
  UNREAD_SPAN,
  type DeclaredStream,
  type DeliverySource,
  type DeliveryTarget,
  type DeployedDelivery,
  type DeployedExport,
  type DeployedFunction,
  type DeployedHandler,
  type DeployedImport,
  type DeployedKind,
  type DeployedRoute,
  type DeployedSetting,
  type DeployedWorkflow,
  type PublishedRoot,
  type RouteTarget,
  type Unresolved,
} from '@flowatlas/core';
import { definitionOf } from './state-machine.js';
import { Attribute, Built, Construct, Imported, ObjectValue, textOf, Unread, type Added, type Site, type Value } from './values.js';

/**
 * The constructs an app made, written out as P21's `Deployment` (P57, D1).
 *
 * Every construct the interpreter made is read here for what Terraform's
 * reading of the same deployment holds: a function under its name, landing on
 * its handler; a route of a REST, HTTP or WebSocket API; a subscriber - a
 * mapping, a subscription, a rule's target, a schedule, a notification, a
 * destination, a trigger - from the channel it takes, onto what it hands its
 * messages to; a stream; a workflow. A construct with no name of its own is
 * named by its path in the tree (`generatedName`, D3), and every reference to
 * it, wherever written, spells it the same way.
 */

/** What a deployed thing is and how it is named. */
interface Deployed {
  readonly kind: DeployedKind | 'url';
  readonly name: string;
  readonly function?: number;
  readonly changes?: boolean;
  readonly generated?: boolean;
}

const FUNCTIONS = new Set(['aws-lambda.Function', 'aws-lambda-nodejs.NodejsFunction', 'aws-lambda.DockerImageFunction', 'aws-lambda.SingletonFunction']);

/** Each construct type that declares something deployed, and the property that names it. */
const DECLARES: ReadonlyMap<string, { readonly kind: DeployedKind; readonly name: string }> = new Map<string, { readonly kind: DeployedKind; readonly name: string }>([
  ...[...FUNCTIONS].map((type): [string, { kind: DeployedKind; name: string }] => [type, { kind: 'function', name: 'functionName' }]),
  ['aws-sqs.Queue', { kind: 'queue', name: 'queueName' }],
  ['aws-sns.Topic', { kind: 'topic', name: 'topicName' }],
  ['aws-events.EventBus', { kind: 'bus', name: 'eventBusName' }],
  ['aws-dynamodb.Table', { kind: 'table', name: 'tableName' }],
  ['aws-dynamodb.TableV2', { kind: 'table', name: 'tableName' }],
  ['aws-kinesis.Stream', { kind: 'stream', name: 'streamName' }],
  ['aws-s3.Bucket', { kind: 'bucket', name: 'bucketName' }],
  ['aws-stepfunctions.StateMachine', { kind: 'workflow', name: 'stateMachineName' }],
]);

/** An API another stack creates, by the key of the point its routes hang from (P249). */
interface SharedApi {
  readonly root: string;
}

const REST_APIS = new Set(['aws-apigateway.RestApi', 'aws-apigateway.LambdaRestApi', 'aws-apigateway.SpecRestApi']);

const HOLE = '\u0001';

const prop = (construct: Construct, name: string): Value => construct.props?.get(name);

const listOf = (value: Value): Value[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** The class a value was built by, without its module: `SqsEventSource`. */
const builtBy = (value: Value): string | undefined => (value instanceof Built ? value.what.slice(value.what.indexOf('.') + 1) : undefined);

/** An event pattern of the CDK, as the JSON the template holds: `detailType` is `detail-type`, a `Match` is a content filter. */
const patternJson = (value: Value): unknown => {
  if (value instanceof Built && value.what.startsWith('aws-events.Match.')) {
    const method = value.what.slice('aws-events.Match.'.length);
    const [operand] = value.args;
    const filters: Record<string, (operand: Value) => unknown> = {
      prefix: (written) => ({ prefix: textOf(written) }),
      suffix: (written) => ({ suffix: textOf(written) }),
      exists: () => ({ exists: true }),
      doesNotExist: () => ({ exists: false }),
      equalsIgnoreCase: (written) => ({ 'equals-ignore-case': textOf(written) }),
      wildcard: (written) => ({ wildcard: textOf(written) }),
      anythingBut: () => ({ 'anything-but': value.args.map((arg) => patternJson(arg)) }),
      exactString: (written) => textOf(written),
    };
    return filters[method]?.(operand) ?? { unread: value.what };
  }
  if (value instanceof ObjectValue) {
    return Object.fromEntries([...value.entries].map(([key, item]) => [key === 'detailType' ? 'detail-type' : key, patternJson(item)]));
  }
  if (Array.isArray(value)) return value.flatMap((item) => (Array.isArray(item) ? item.map(patternJson) : [patternJson(item)]));
  if (value === null || typeof value !== 'object') return value;
  return { unread: value instanceof Unread ? value.text : 'a value known only once deployed' };
};

export interface DeploymentParts {
  readonly functions: DeployedFunction[];
  readonly routes: DeployedRoute[];
  readonly workflows: DeployedWorkflow[];
  readonly deliveries: DeployedDelivery[];
  readonly streams: DeclaredStream[];
  /** Points of the app's APIs it publishes for other deployments' routes (P249). */
  readonly roots: PublishedRoot[];
  readonly exports: DeployedExport[];
  readonly imports: DeployedImport[];
  readonly rows: Unresolved[];
}

export class AppDeployment {
  readonly #functionIndex = new Map<Construct, number>();
  readonly #rowed = new Set<string>();

  constructor(
    readonly parts: DeploymentParts,
    readonly constructs: readonly Construct[],
    /** Absolute path of the repository. */
    readonly repoDir: string,
    /** Absolute directory of the app: where `cdk.json` is, which relative paths are taken from. */
    readonly appDir: string,
  ) {}

  #ofType(...types: string[]): Construct[] {
    return this.constructs.filter((construct) => types.includes(construct.type));
  }

  #row(site: Site, symbol: string, row: Omit<Unresolved, 'file' | 'line' | 'symbol'>): void {
    const key = `${row.reason}\0${symbol}`;
    if (this.#rowed.has(key)) return;
    this.#rowed.add(key);
    this.parts.rows.push({ ...site, symbol, ...row });
  }

  /** A repo-relative path, from one the app writes: absolute, or relative to the app. */
  #repoPath(path: string): string {
    const absolute = isAbsolute(path) ? path : join(this.appDir, path);
    return toPosixPath(relative(this.repoDir, absolute)) || '.';
  }

  // ------------------------------------------------------------- naming

  /**
   * What a value points at, by kind and deployed name: a construct, an
   * attribute of one, an ARN or URL written out. A construct with no name of its
   * own is named by its path, and says so once.
   */
  deployedOf(value: Value): Deployed | Unread | undefined {
    if (value instanceof Attribute) {
      if (value.construct.type === 'aws-lambda.FunctionUrl' && value.name === 'url') {
        const fn = value.construct.fields.get('function') ?? prop(value.construct, 'function');
        const found = this.deployedOf(fn);
        return found === undefined || found instanceof Unread ? found : { kind: 'url', name: found.name };
      }
      const found = this.deployedOf(value.construct);
      return found === undefined || found instanceof Unread ? found : { ...found, ...(value.name === 'tableStreamArn' ? { changes: true } : {}) };
    }
    if (value instanceof Construct) {
      const declares = DECLARES.get(value.type);
      if (declares === undefined) return undefined;
      const index = this.#functionIndex.get(value);
      if (value.imported !== undefined) {
        // Looked up by a value another stack exports: the thing it names, by the key's stand-in (P249).
        if (value.imported.unread instanceof Imported) {
          this.#importAt(value.imported.unread.key, value.site, value.path, [declares.kind]);
          return { kind: declares.kind, name: importedName(value.imported.unread.key) };
        }
        if (value.imported.unread !== undefined) return value.imported.unread;
        if (value.imported.name !== undefined) return { kind: declares.kind, name: value.imported.name };
        const named = value.imported.arn === undefined ? undefined : deployedNameIn(value.imported.arn);
        return named === undefined || named.name.includes(HOLE) ? new Unread(`${value.path} is looked up by an ARN this does not read`, 'not-an-arn') : { kind: named.kind, name: named.name };
      }
      const written = prop(value, declares.name);
      if (written === undefined) {
        this.#row(value.site, value.path, {
          reason: 'deployed-name-generated',
          level: 'info',
          message: `${value.path} is a ${declares.kind} with no name of its own, so it is named by its place in the app; what the app points at it with joins to it, and nothing outside this deployment can`,
          hint: 'Give it a name of its own where other repositories reach it.',
        });
        return { kind: declares.kind, name: generatedName(value.path), generated: true, ...(index === undefined ? {} : { function: index }) };
      }
      const name = textOf(written);
      if (name === undefined) return written instanceof Unread ? written : new Unread(`the ${declares.name} of ${value.path} is a value known only once deployed`, 'token');
      return { kind: declares.kind, name, ...(index === undefined ? {} : { function: index }) };
    }
    const text = textOf(value);
    if (text !== undefined) {
      const found = deployedNameIn(text);
      return found === undefined ? undefined : { kind: found.kind, name: found.name, ...(found.changes === true ? { changes: true } : {}) };
    }
    return value instanceof Unread ? value : undefined;
  }

  /** That the app reads a value another stack exports, here: once per place (P249). */
  #importAt(key: string, site: Site, what: string, kinds?: readonly DeployedKind[]): void {
    if (this.parts.imports.some((found) => found.key === key && found.file === site.file && found.line === site.line)) return;
    this.parts.imports.push({ key, ...site, what, ...(kinds === undefined ? {} : { kinds }) });
  }

  /** A value a function is deployed with, read every way it can be. */
  #setting(value: Value, site: Site, what: string): DeployedSetting {
    // An output of another stack, whatever it names (P249).
    if (value instanceof Imported) {
      this.#importAt(value.key, site, what);
      return { written: `Fn.importValue(${JSON.stringify(value.exportName)})`, imported: value.key, unread: { text: value.text } };
    }
    const written =
      value instanceof Attribute ? `${value.construct.path}.${value.name}` : value instanceof Construct ? value.path : typeof value === 'string' ? JSON.stringify(value) : value instanceof Unread ? 'a value not known from the files' : String(value);
    const text = textOf(value);
    const found = this.deployedOf(value);
    if (found !== undefined && !(found instanceof Unread)) return { written, ...(text === undefined ? {} : { text }), names: { kind: found.kind, name: found.name } };
    if (text !== undefined) return { written, text };
    return { written, unread: { text: found instanceof Unread ? found.text : value instanceof Unread ? value.text : 'it is a value known only once deployed' } };
  }

  /** What a delivery hands its messages to, or a row saying why not. */
  #target(value: Value, site: Site, symbol: string, what: string): DeliveryTarget | undefined {
    const found = this.deployedOf(value);
    if (found === undefined || found instanceof Unread) {
      this.#row(site, symbol, {
        reason: 'subscription-target-unread',
        message: `${what} is not read: ${found === undefined ? 'it is not a construct this reads' : found.text}`,
        hint: 'Hand it a function, a queue, a topic, a bus or a state machine the app creates or looks up by name.',
      });
      return undefined;
    }
    switch (found.kind) {
      case 'function':
        return found.function === undefined ? { kind: 'function', name: found.name } : { kind: 'function', function: found.function };
      case 'workflow':
        return { kind: 'workflow', name: found.name };
      case 'queue':
      case 'topic':
      case 'bus':
        return { kind: found.kind, name: found.name };
      default:
        this.#row(site, symbol, { reason: 'subscription-target-unread', level: 'info', message: `${what} is a ${found.kind}, which nothing is delivered to`, hint: 'Nothing to fix.' });
        return undefined;
    }
  }

  /** What answers a route: a function of the app, or one by its name. */
  #routeTarget(fn: Value): RouteTarget | undefined {
    const found = this.deployedOf(fn);
    if (found === undefined || found instanceof Unread || found.kind !== 'function') return undefined;
    return found.function === undefined ? { name: found.name } : { function: found.function };
  }

  /** The condition a construct or a call of one is declared under, for what it draws. */
  #conditional(...conditions: (string | undefined)[]): Record<string, unknown> {
    const found = conditions.filter((condition): condition is string => condition !== undefined);
    return found.length === 0 ? {} : { conditional: [...new Set(found)].join(' && ') };
  }

  // ---------------------------------------------------------------- read

  read(): void {
    const functions = this.constructs.filter((construct) => FUNCTIONS.has(construct.type) && construct.imported === undefined);
    functions.forEach((fn, offset) => this.#functionIndex.set(fn, this.parts.functions.length + offset));
    for (const fn of functions) this.#function(fn);
    for (const construct of this.constructs) {
      // Said once per construct of the deployment's own - not per state of a
      // chain or resource of an API, which their machine or API already says.
      const owned = !construct.type.startsWith('app:') && construct.type !== 'aws-apigateway.Resource' && !construct.type.startsWith('aws-stepfunctions-tasks.') && (!construct.type.startsWith('aws-stepfunctions.') || construct.type === 'aws-stepfunctions.StateMachine');
      if (construct.conditional !== undefined && owned) {
        this.#row(construct.site, construct.path, {
          reason: 'construct-conditional',
          level: 'info',
          message: `${construct.path} is declared under ${construct.conditional}, which the files do not settle; it is read as declared, and what reaches it is drawn heuristic`,
          hint: 'Set the value the condition reads under services[].infra.options, or in the app.',
        });
      }
      if (construct.repeated !== undefined && DECLARES.has(construct.type) && !FUNCTIONS.has(construct.type)) {
        this.#row(construct.site, construct.path, {
          reason: 'construct-repeated-unread',
          message: `${construct.path} is declared once per element of ${construct.repeated}, which the files do not settle; one is read in their place`,
          hint: 'Write the collection out, or as a constant, and each is read under its own name.',
        });
      }
    }
    for (const api of this.#ofType(...REST_APIS)) this.#restApi(api);
    for (const api of this.#ofType('aws-apigatewayv2.HttpApi')) this.#httpApi(api);
    for (const route of this.#ofType('aws-apigatewayv2.HttpRoute')) this.#httpRoute(route);
    for (const api of this.#ofType('aws-apigatewayv2.WebSocketApi')) this.#socketApi(api);
    for (const url of this.#ofType('aws-lambda.FunctionUrl')) this.#functionUrl(url);
    for (const fn of functions) this.#eventSources(fn);
    for (const mapping of this.#ofType('aws-lambda.EventSourceMapping')) this.#mapping(mapping);
    for (const topic of this.#ofType('aws-sns.Topic')) this.#subscriptions(topic);
    for (const rule of this.#ofType('aws-events.Rule')) this.#rule(rule);
    for (const schedule of this.#ofType('aws-scheduler.Schedule')) this.#schedule(schedule);
    for (const queue of this.#ofType('aws-sqs.Queue')) this.#redrive(queue);
    for (const bucket of this.#ofType('aws-s3.Bucket')) this.#notifications(bucket);
    for (const pool of this.#ofType('aws-cognito.UserPool')) this.#userPool(pool);
    for (const table of this.#ofType('aws-dynamodb.Table', 'aws-dynamodb.TableV2', 'aws-kinesis.Stream')) this.#stream(table);
    for (const machine of this.#ofType('aws-stepfunctions.StateMachine')) this.#workflow(machine);
    for (const construct of this.constructs) this.#unreadHolder(construct);
    for (const output of this.#ofType('core.CfnOutput')) this.#output(output);
  }

  // -------------------------------------------------------------- outputs

  /**
   * What an output's value is, when it is an API the app creates or a point of
   * one: `restApiId`, `restApiRootResourceId` and a resource's `resourceId` are
   * points other stacks hang routes from, as an HTTP API's `apiId` is; its
   * `url` is its address (P249).
   */
  #outputApi(value: Value): { kind: 'rest' | 'http'; name: string; address: string; path?: string } | undefined {
    if (!(value instanceof Attribute)) return undefined;
    const { construct, name } = value;
    if (construct.imported !== undefined) return undefined;
    if (REST_APIS.has(construct.type)) {
      const api = { kind: 'rest' as const, name: textOf(prop(construct, 'restApiName')) ?? construct.id, address: construct.path };
      if (name === 'restApiId' || name === 'restApiRootResourceId') return { ...api, path: '/' };
      return name === 'url' || name === 'urlForPath' ? api : undefined;
    }
    if (construct.type === 'aws-apigateway.Resource' && name === 'resourceId') {
      const owner = construct.fields.get('api');
      if (!(owner instanceof Construct) || owner.imported !== undefined) return undefined;
      const parts: string[] = [];
      for (let at: Value = construct; at instanceof Construct && at.fields.get('parent') !== undefined; at = at.fields.get('parent')) parts.unshift(textOf(at.fields.get('part')) ?? '?');
      return { kind: 'rest', name: textOf(prop(owner, 'restApiName')) ?? owner.id, address: owner.path, path: normalizePath(`/${parts.join('/')}`) };
    }
    if (construct.type === 'aws-apigatewayv2.HttpApi') {
      const api = { kind: 'http' as const, name: textOf(prop(construct, 'apiName')) ?? construct.id, address: construct.path };
      if (name === 'apiId' || name === 'httpApiId') return { ...api, path: '/' };
      return name === 'url' || name === 'apiEndpoint' ? api : undefined;
    }
    return undefined;
  }

  /**
   * `new CfnOutput(scope, id, { value, exportName })`: a value the app
   * publishes for other stacks to read, by its export name, and by its stack's
   * name and its own id where it is a direct child of the stack - deeper, the
   * CDK adds a hash to its logical id, which the files do not hold (P249).
   */
  #output(output: Construct): void {
    const exportName = textOf(prop(output, 'exportName'));
    const segments = output.path.split('/');
    const stack = this.constructs.find((construct) => construct.path === segments[0]);
    const stackName = segments.length === 2 && stack !== undefined ? (textOf(prop(stack, 'stackName')) ?? stack.id) : undefined;
    const keys = [...(exportName === undefined ? [] : [exportKey(exportName)]), ...(stackName === undefined ? [] : [stackOutputKey(stackName, output.id)])];
    if (keys.length === 0) return;
    const value = prop(output, 'value');
    const base = { keys, address: output.path, ...output.site };
    const api = this.#outputApi(value);
    if (api !== undefined) {
      this.parts.exports.push({ ...base, names: { kind: 'api', name: api.name } });
      if (api.path !== undefined) for (const key of keys) this.parts.roots.push({ key, path: api.path, api: api.name, ...output.site });
      return;
    }
    const found = this.deployedOf(value);
    if (found !== undefined && !(found instanceof Unread)) {
      this.parts.exports.push({ ...base, names: { kind: found.kind, name: found.name } });
      return;
    }
    const text = textOf(value);
    if (text !== undefined) {
      this.parts.exports.push({ ...base, text });
      return;
    }
    this.parts.exports.push({ ...base, unread: found instanceof Unread ? found.text : value instanceof Unread ? value.text : 'it is a value known only once deployed' });
  }

  // ------------------------------------------------------------ functions

  #function(fn: Construct): void {
    const found = this.deployedOf(fn);
    const name = found !== undefined && !(found instanceof Unread) && found.generated !== true ? found.name : undefined;
    if (found instanceof Unread) {
      this.#row(fn.site, fn.path, {
        reason: fn.repeated === undefined ? 'function-name-unread' : 'function-repeated-unread',
        message:
          fn.repeated === undefined
            ? `the name of ${fn.path} is not read: ${found.text}`
            : `${fn.path} is one function per element of ${fn.repeated}, which the files do not settle, so neither how many there are nor their names are read`,
        hint: 'Nothing can join to a function whose name is not read. Write the name so the app settles it - a constant, a context value, an option.',
      });
    } else if (fn.repeated !== undefined) {
      this.#row(fn.site, fn.path, {
        reason: 'function-repeated-unread',
        message: `${fn.path} is one function per element of ${fn.repeated}, which the files do not settle; one is read in their place`,
        hint: 'Write the collection out, or as a constant, and each function is read under its own name.',
      });
    }
    const runtime = textOf(prop(fn, 'runtime'));
    if (runtime !== undefined && !runtime.startsWith('nodejs')) {
      this.#row(fn.site, fn.path, {
        reason: 'function-runtime-unread',
        level: 'info',
        message: `${name ?? fn.path} runs on ${runtime}; only Node.js handlers are read, so its body is not`,
        hint: 'The function is still in the graph under its name, and whatever invokes it still joins to it.',
      });
    }
    // A handler of another language is said once, by the runtime's row.
    const handler = runtime === undefined || runtime.startsWith('nodejs') ? this.#handler(fn) : undefined;
    const environment: Record<string, DeployedSetting> = {};
    const written = prop(fn, 'environment');
    const pairs: [string, Value][] = [
      ...(written instanceof ObjectValue ? [...written.entries] : []),
      ...fn.addedBy('addEnvironment').flatMap(({ args }): [string, Value][] => (typeof args[0] === 'string' ? [[args[0], args[1]]] : [])),
    ];
    for (const [variable, value] of pairs.sort(([a], [b]) => a.localeCompare(b))) environment[variable] = this.#setting(value, fn.site, `the value of ${variable} ${fn.path} is deployed with`);
    this.parts.functions.push({
      ...fn.site,
      ...(name === undefined ? {} : { name }),
      address: fn.path,
      ...(handler === undefined ? {} : { handler }),
      ...(runtime === undefined ? {} : { runtime }),
      ...(written instanceof Unread ? {} : { environment }),
      meta: {
        declaredAs: fn.path,
        constructPath: fn.path,
        ...(found !== undefined && !(found instanceof Unread) && found.generated === true ? { nameGenerated: true } : {}),
        ...(found instanceof Unread ? { nameUnread: found.text } : {}),
        ...this.#conditional(fn.conditional),
      },
    });
  }

  /** The handler: a `NodejsFunction`'s entry and export, or a `Function`'s handler string and asset. */
  #handler(fn: Construct): DeployedHandler | undefined {
    if (fn.type === 'aws-lambda.DockerImageFunction') {
      this.#row(fn.site, fn.path, {
        reason: 'function-image-unread',
        level: 'info',
        message: `${fn.path} is deployed as a container image, whose handler is set inside the image`,
        hint: 'The function is in the graph under its name; the code it runs is not pointed at.',
      });
      return undefined;
    }
    if (fn.type === 'aws-lambda-nodejs.NodejsFunction') {
      const entryWritten = prop(fn, 'entry');
      const exported = textOf(prop(fn, 'handler')) ?? 'handler';
      let entry: string | undefined;
      if (entryWritten === undefined) {
        // The construct's own default: `<defining file>.<id>.ts` beside the file that makes it.
        const base = fn.site.file.replace(/\.[cm]?[tj]s$/, '');
        entry = ['ts', 'js'].map((extension) => `${base}.${fn.id}.${extension}`).find((candidate) => existsSync(join(this.repoDir, candidate)));
        if (entry === undefined) {
          this.#row(fn.site, fn.path, {
            reason: 'function-handler-not-found',
            message: `${fn.path} names no entry, and there is no ${base}.${fn.id}.ts beside the file that makes it`,
            hint: 'Give the function an entry, or keep its code where the construct looks for it by default.',
          });
          return undefined;
        }
      } else {
        const text = textOf(entryWritten);
        if (text === undefined) {
          this.#row(fn.site, fn.path, { reason: 'function-handler-unread', message: `the entry of ${fn.path} is not read`, hint: 'Write the entry as a path the app settles: path.join(__dirname, ...).' });
          return undefined;
        }
        entry = this.#repoPath(text);
      }
      const dot = exported.lastIndexOf('.');
      const module = posix.basename(entry).replace(/\.[cm]?[tj]sx?$/, '');
      return {
        written: `${entry}:${exported}`,
        module,
        export: dot < 0 ? exported : exported.slice(dot + 1),
        directory: posix.dirname(entry),
        directoryFrom: 'entry',
      };
    }
    const written = textOf(prop(fn, 'handler'));
    const code = prop(fn, 'code');
    if (code instanceof Built && code.what === 'aws-lambda.Code.fromInline') {
      this.#row(fn.site, fn.path, { reason: 'function-handler-unread', level: 'info', message: `${fn.path} runs code written inline in the app`, hint: 'Inline code is not read. Nothing to fix.' });
      return undefined;
    }
    if (written === undefined) {
      this.#row(fn.site, fn.path, { reason: 'function-handler-unread', message: `the handler of ${fn.path} is not read`, hint: 'Write the handler as a string the app settles, such as "index.handler".' });
      return undefined;
    }
    const dot = written.lastIndexOf('.');
    if (dot <= 0 || dot === written.length - 1) {
      this.#row(fn.site, fn.path, { reason: 'function-handler-unread', message: `the handler of ${fn.path} is ${JSON.stringify(written)}, which does not say a module and an export`, hint: 'A Node.js handler is written "<module>.<export>".' });
      return undefined;
    }
    const asset = code instanceof Built && code.what === 'aws-lambda.Code.fromAsset' ? textOf(code.args[0]) : undefined;
    const directory = asset === undefined || /\.(zip|jar)$/.test(asset) ? undefined : this.#repoPath(asset);
    return {
      written,
      module: written.slice(0, dot),
      export: written.slice(dot + 1),
      ...(directory === undefined ? {} : { directory, directoryFrom: 'Code.fromAsset' }),
    };
  }

  // --------------------------------------------------------------- routes

  #guards(options: Value, site: Site): { label: string; file: string; line: number }[] {
    if (!(options instanceof ObjectValue)) return [];
    const authorizer = options.get('authorizer');
    if (authorizer instanceof Construct) return [{ label: textOf(prop(authorizer, 'authorizerName')) ?? authorizer.id, ...site }];
    if (authorizer instanceof Built) return [{ label: textOf(authorizer.args[0]) ?? builtBy(authorizer) ?? 'authorizer', ...site }];
    const type = textOf(options.get('authorizationType'));
    return type === undefined || type === 'NONE' ? [] : [{ label: type, ...site }];
  }

  #route(api: Construct, name: string | SharedApi, method: string, rawPath: string, target: RouteTarget | undefined, site: Site, declaredAs: string, guards: DeployedRoute['guards'], conditional?: string): void {
    const verb = method.toUpperCase() === 'ANY' ? 'ALL' : method.toUpperCase();
    const below = normalizePath(rawPath);
    // On an API another stack creates, the route hangs from the point it exports (P249).
    const path = typeof name === 'string' ? below : normalizePath(`${UNREAD_SPAN}${below}`);
    this.parts.routes.push({
      ...site,
      method: verb,
      path,
      rawPath,
      ...(typeof name === 'string' ? { api: name } : { root: { key: name.root, below } }),
      ...(target === undefined ? {} : { target }),
      ...(guards === undefined || guards.length === 0 ? {} : { guards }),
      meta: { declaredAs, key: makeHttpEntryKey(verb, path), apiAddress: api.path, ...this.#conditional(api.conditional, conditional) },
    });
  }

  /** What an integration hands a request to: a function, or nothing this reads. */
  #integrated(integration: Value): Value {
    if (!(integration instanceof Built)) return undefined;
    const by = builtBy(integration);
    if (by === 'LambdaIntegration' || by === 'LambdaProxyIntegration') return integration.args[0] instanceof ObjectValue ? integration.args[0].get('handler') : integration.args[0];
    if (by === 'HttpLambdaIntegration' || by === 'WebSocketLambdaIntegration') return integration.args[1];
    return undefined;
  }

  /**
   * An API the app looks up rather than creates (`RestApi.fromRestApiAttributes`,
   * `HttpApi.fromHttpApiAttributes`): the point of it another stack exports that
   * its routes hang from, by the attribute that holds it, or a row (P249).
   */
  #sharedApi(api: Construct, attributes: readonly string[], site: Site): SharedApi | undefined {
    for (const attribute of attributes) {
      const value = prop(api, attribute);
      if (value instanceof Imported) return { root: value.key };
    }
    const [attribute] = attributes;
    const written = attribute === undefined ? undefined : prop(api, attribute);
    const why =
      attribute === undefined || written === undefined
        ? 'the point its routes hang from is not given'
        : `its ${attribute} is ${written instanceof Unread ? `not read: ${written.text}` : 'not a value another stack exports'}`;
    this.#row(site, api.path, {
      reason: 'route-path-unread',
      message: `${api.path} is an API another stack creates, and ${why}, so no route on it is drawn`,
      hint: `Look the API up with ${attribute ?? 'its attributes'} as Fn.importValue of what the stack that creates it exports, and its routes are joined to it.`,
    });
    return undefined;
  }

  /** The name of an API the app creates, or the point of one it looks up, or `undefined` where neither is read. */
  #apiNamed(api: Construct, nameProp: string, attributes: readonly string[], site: Site): string | SharedApi | undefined {
    if (api.imported !== undefined) return this.#sharedApi(api, attributes, site);
    return textOf(prop(api, nameProp)) ?? api.id;
  }

  #restApi(api: Construct): void {
    const name = api.imported === undefined ? (textOf(prop(api, 'restApiName')) ?? api.id) : undefined;
    const handler = api.type === 'aws-apigateway.LambdaRestApi' ? prop(api, 'handler') : undefined;
    const defaultIntegration = prop(api, 'defaultIntegration');
    const defaults = prop(api, 'defaultMethodOptions');
    if (name !== undefined && handler !== undefined && prop(api, 'proxy') !== false) {
      for (const rawPath of ['/', '/{proxy+}']) this.#route(api, name, 'ANY', rawPath, this.#routeTarget(handler), api.site, `${api.path}/Default${rawPath === '/' ? '' : rawPath}/ANY`, this.#guards(defaults, api.site));
    }
    const root = api.children.get('');
    if (root === undefined) return;
    const walk = (resource: Construct, path: string): void => {
      for (const { args, site, conditional } of resource.addedBy('addMethod')) {
        const [method, integration, options] = args;
        const verb = textOf(method);
        if (verb === undefined) continue;
        // A method of an API looked up hangs from the root it is looked up with.
        const at = name ?? this.#sharedApi(api, ['rootResourceId'], site);
        if (at === undefined) continue;
        const fn = this.#integrated(integration ?? defaultIntegration) ?? handler;
        const target = this.#routeTarget(fn);
        const guards = [...this.#guards(defaults, site), ...this.#guards(options, site)];
        this.#route(api, at, verb, path || '/', target, site, `${resource.path}/${verb.toUpperCase()}`, guards, conditional);
      }
      for (const child of resource.children.values()) walk(child, `${path}/${textOf(child.fields.get('part')) ?? '?'}`);
    };
    walk(root, '');
  }

  #httpRoutes(api: Construct, options: ObjectValue, site: Site, conditional: string | undefined): void {
    const path = textOf(options.get('path'));
    if (path === undefined) return;
    const name = this.#apiNamed(api, 'apiName', ['httpApiId'], site);
    if (name === undefined) return;
    const methods = listOf(options.get('methods')).map(textOf).filter((method): method is string => method !== undefined);
    const fn = this.#integrated(options.get('integration'));
    const guards = this.#guards(options, site);
    for (const method of methods.length === 0 ? ['ANY'] : methods) {
      this.#route(api, name, method, path, this.#routeTarget(fn), site, `${api.path}/${method.toUpperCase()}--${path}`, guards, conditional);
    }
  }

  #httpApi(api: Construct): void {
    const defaultIntegration = prop(api, 'defaultIntegration');
    if (defaultIntegration !== undefined && api.imported === undefined) {
      this.#route(api, textOf(prop(api, 'apiName')) ?? api.id, 'ANY', '/{proxy+}', this.#routeTarget(this.#integrated(defaultIntegration)), api.site, `${api.path}/DefaultRoute`, []);
    }
    for (const { args, site, conditional } of api.addedBy('addRoutes')) {
      if (args[0] instanceof ObjectValue) this.#httpRoutes(api, args[0], site, conditional);
    }
  }

  #httpRoute(route: Construct): void {
    const api = prop(route, 'httpApi');
    const key = prop(route, 'routeKey');
    if (!(api instanceof Construct) || !(key instanceof Built)) return;
    const [path, method] = key.args;
    const options = new ObjectValue([
      ['path', path],
      ['methods', [method ?? 'ANY']],
      ['integration', prop(route, 'integration')],
      ['authorizer', prop(route, 'authorizer')],
    ]);
    this.#httpRoutes(api, options, route.site, route.conditional);
  }

  #socketApi(api: Construct): void {
    const name = textOf(prop(api, 'apiName')) ?? api.id;
    const routes: [string, Value, Site, string | undefined][] = [
      ...(
        [
          ['connectRouteOptions', '$connect'],
          ['disconnectRouteOptions', '$disconnect'],
          ['defaultRouteOptions', '$default'],
        ] as const
      ).flatMap(([option, key]): [string, Value, Site, string | undefined][] => {
        const options = prop(api, option);
        return options instanceof ObjectValue ? [[key, options.get('integration'), api.site, undefined]] : [];
      }),
      ...api.addedBy('addRoute').flatMap(({ args, site, conditional }): [string, Value, Site, string | undefined][] =>
        typeof args[0] === 'string' && args[1] instanceof ObjectValue ? [[args[0], args[1].get('integration'), site, conditional]] : [],
      ),
    ];
    for (const [key, integration, site, conditional] of routes) {
      const fn = this.#integrated(integration);
      const address = `${api.path}/${key}-Route`;
      const to = fn === undefined ? undefined : this.#target(fn, site, address, `what answers ${key} on ${name}`);
      this.parts.deliveries.push({
        ...site,
        address,
        by: 'route',
        name: key,
        from: { kind: 'connection', api: name, route: key },
        ...(to === undefined ? {} : { to }),
        meta: { ...(fn === undefined ? { integration: 'none' } : {}), ...this.#conditional(api.conditional, conditional) },
      });
    }
  }

  #functionUrl(url: Construct): void {
    const fn = url.fields.get('function') ?? prop(url, 'function');
    const found = this.deployedOf(fn);
    const owner = found === undefined || found instanceof Unread ? url.path : found.name;
    const authorization = textOf(prop(url, 'authType'));
    this.parts.routes.push({
      ...url.site,
      method: 'ALL',
      path: '/*',
      rawPath: '/*',
      ...(this.#routeTarget(fn) === undefined ? {} : { target: this.#routeTarget(fn) as RouteTarget }),
      ...(authorization === 'AWS_IAM' ? { guards: [{ label: 'AWS_IAM', ...url.site }] } : {}),
      meta: { declaredAs: url.path, key: makeFunctionUrlEntryKey(owner), by: 'function-url', ...this.#conditional(url.conditional) },
    });
  }

  // ------------------------------------------------------------ deliveries

  #deliver(delivery: Omit<DeployedDelivery, 'to'> & { readonly toValue?: Value; readonly what?: string }): void {
    const { toValue, what, ...rest } = delivery;
    const to = toValue === undefined ? undefined : this.#target(toValue, { file: rest.file, line: rest.line }, rest.address, what ?? `what ${rest.address} hands its messages to`);
    this.parts.deliveries.push({ ...rest, ...(to === undefined ? {} : { to }) });
  }

  /** A source a value names, as a delivery's, or a row saying why not. */
  #source(value: Value, site: Site, symbol: string, what: string): Deployed | undefined {
    const found = this.deployedOf(value);
    if (found === undefined || found instanceof Unread) {
      this.#row(site, symbol, {
        reason: 'subscription-source-unread',
        message: `${what} is not read: ${found === undefined ? 'it is not a construct this reads' : found.text}`,
        hint: 'Hand it a queue, a topic, a table, a stream or a bucket the app creates or looks up by name.',
      });
      return undefined;
    }
    return found;
  }

  #filters(options: Value): Record<string, unknown> {
    if (!(options instanceof ObjectValue)) return {};
    const filters = options.get('filters');
    const written = Array.isArray(filters) ? filters.map((filter) => JSON.stringify(patternJson(filter))) : [];
    return {
      ...(options.get('enabled') === false ? { disabled: true } : {}),
      ...(written.length === 0 ? {} : { unmatched: { filter: written } }),
    };
  }

  #eventSources(fn: Construct): void {
    const sources: Added[] = [...listOf(prop(fn, 'events')).map((source) => ({ args: [source], site: fn.site })), ...fn.addedBy('addEventSource')];
    for (const { args, site, conditional } of sources) {
      const source = args[0];
      if (!(source instanceof Built)) continue;
      const by = builtBy(source);
      const [of, options] = source.args;
      const address = `${fn.path}/${by ?? 'EventSource'}:${of instanceof Construct ? of.path : '?'}`;
      const meta = { ...this.#filters(options), ...this.#conditional(fn.conditional, conditional) };
      const found = this.#source(of, site, address, `what ${address} reads`);
      if (found === undefined) continue;
      const to = { kind: 'function' as const, function: this.#functionIndex.get(fn) as number };
      const push = (from: DeliverySource, kind: DeployedDelivery['by'], extra: Record<string, unknown> = {}): void => {
        this.parts.deliveries.push({ ...site, address, by: kind, from, to, meta: { ...meta, ...extra } });
      };
      if (by === 'SqsEventSource' && found.kind === 'queue') push({ kind: 'queue', name: found.name }, 'mapping');
      else if (by === 'SnsEventSource' && found.kind === 'topic') {
        const policy = options instanceof ObjectValue ? options.get('filterPolicy') : undefined;
        push({ kind: 'topic', name: found.name }, 'subscription', { protocol: 'lambda', ...(policy === undefined ? {} : { unmatched: { filter_policy: JSON.stringify(patternJson(policy)) } }) });
      } else if (by === 'DynamoEventSource' && found.kind === 'table') push({ kind: 'changes', of: 'table', name: found.name }, 'mapping');
      else if (by === 'KinesisEventSource' && found.kind === 'stream') push({ kind: 'changes', of: 'stream', name: found.name }, 'mapping');
      else if (by === 'S3EventSource' && found.kind === 'bucket') {
        const events = options instanceof ObjectValue ? listOf(options.get('events')).map(textOf).filter((event): event is string => event !== undefined) : [];
        const filter = options instanceof ObjectValue ? listOf(options.get('filters'))[0] : undefined;
        push(this.#bucketSource(found.name, events.length === 0 ? ['s3:ObjectCreated:*'] : events, filter, of as Construct), 'notification');
      } else {
        this.#row(site, address, { reason: 'subscription-source-unread', level: 'info', message: `${address} reads a ${found.kind}, which is not read in order`, hint: 'Nothing to fix.' });
      }
    }
  }

  #mapping(mapping: Construct): void {
    const found = this.#source(prop(mapping, 'eventSourceArn'), mapping.site, mapping.path, `what ${mapping.path} reads`);
    if (found === undefined) return;
    const from: DeliverySource | undefined =
      found.kind === 'queue' ? { kind: 'queue', name: found.name } : found.kind === 'stream' || (found.kind === 'table' && found.changes === true) ? { kind: 'changes', of: found.kind === 'stream' ? 'stream' : 'table', name: found.name } : undefined;
    if (from === undefined) return;
    this.#deliver({ ...mapping.site, address: mapping.path, by: 'mapping', from, toValue: prop(mapping, 'target'), meta: { ...this.#filters(mapping.props), ...this.#conditional(mapping.conditional) } });
  }

  #subscriptions(topic: Construct): void {
    const found = this.deployedOf(topic);
    if (found === undefined || found instanceof Unread) return;
    for (const { args, site, conditional } of topic.addedBy('addSubscription')) {
      const subscription = args[0];
      const by = builtBy(subscription);
      const [subscriber, options] = subscription instanceof Built ? subscription.args : [];
      const address = `${topic.path}/${subscriber instanceof Construct ? subscriber.path : (by ?? 'Subscription')}`;
      const policy = options instanceof ObjectValue ? options.get('filterPolicy') : undefined;
      const protocol = by === 'LambdaSubscription' ? 'lambda' : by === 'SqsSubscription' ? 'sqs' : by?.replace(/Subscription$/, '').toLowerCase();
      const meta = {
        ...(protocol === undefined ? {} : { protocol }),
        ...(policy === undefined ? {} : { unmatched: { filter_policy: JSON.stringify(patternJson(policy)) } }),
        ...(options instanceof ObjectValue && options.get('rawMessageDelivery') === true ? { raw: true } : {}),
        ...this.#conditional(topic.conditional, conditional),
      };
      if (by !== 'LambdaSubscription' && by !== 'SqsSubscription') {
        this.#row(site, address, { reason: 'subscription-target-unread', level: 'info', message: `${address} delivers by ${protocol ?? 'a protocol not read'}, which nothing here follows`, hint: 'An e-mail, an HTTP endpoint or a phone is outside the map. Nothing to fix.' });
        this.parts.deliveries.push({ ...site, address, by: 'subscription', from: { kind: 'topic', name: found.name }, meta });
        continue;
      }
      this.#deliver({ ...site, address, by: 'subscription', from: { kind: 'topic', name: found.name }, toValue: subscriber, meta });
    }
  }

  /** What a rule's or a schedule's target hands its messages to, as a value to point at. */
  #targetValue(target: Value): Value | 'unread' {
    const by = builtBy(target);
    if (!(target instanceof Built)) return 'unread';
    if (['LambdaFunction', 'SfnStateMachine', 'SqsQueue', 'SnsTopic', 'EventBus', 'LambdaInvoke', 'StepFunctionsStartExecution', 'SqsSendMessage', 'SnsPublish', 'EventBridgePutEvents'].includes(by ?? '')) return target.args[0];
    return 'unread';
  }

  #rule(rule: Construct): void {
    const name = textOf(prop(rule, 'ruleName'));
    const schedule = prop(rule, 'schedule');
    let from: DeliverySource;
    if (schedule !== undefined) {
      const expression = textOf(schedule);
      from = { kind: 'schedule', ...(expression === undefined ? {} : { expression }) };
    } else {
      const busValue = prop(rule, 'eventBus');
      const bus = busValue === undefined ? DEFAULT_EVENT_BUS : this.#source(busValue, rule.site, rule.path, `the bus ${rule.path} takes events from`)?.name;
      if (bus === undefined) return;
      const pattern = eventPatternOf(patternJson(prop(rule, 'eventPattern')));
      if ('reason' in pattern) {
        this.#row(rule.site, rule.path, { reason: 'event-pattern-unread', message: `the event pattern of ${rule.path} is not read: ${pattern.text}`, hint: 'Write the pattern as an object of fields to lists of values.' });
        return;
      }
      from = { kind: 'bus', name: bus, pattern };
    }
    const targets: Added[] = [...listOf(prop(rule, 'targets')).map((target) => ({ args: [target], site: rule.site })), ...rule.addedBy('addTarget')];
    targets.forEach(({ args, site, conditional }, index) => {
      const target = args[0];
      const address = `${rule.path}/Target${index}`;
      const value = this.#targetValue(target);
      const options = target instanceof Built ? target.args[1] : undefined;
      const meta = {
        rule: rule.path,
        ...(prop(rule, 'enabled') === false ? { disabled: true } : {}),
        ...(options instanceof ObjectValue && options.get('event') !== undefined ? { transformed: true } : {}),
        ...this.#conditional(rule.conditional, conditional),
      };
      if (value === 'unread') {
        this.#row(site, address, { reason: 'subscription-target-unread', level: 'info', message: `the target of ${rule.path} is ${builtBy(target) ?? 'a value'}, which nothing here follows`, hint: 'A container task, an API destination or a log group is outside the map. Nothing to fix.' });
        this.parts.deliveries.push({ ...site, address, by: from.kind === 'schedule' ? 'schedule' : 'rule', ...(name === undefined ? {} : { name }), from, meta });
        return;
      }
      this.#deliver({ ...site, address, by: from.kind === 'schedule' ? 'schedule' : 'rule', ...(name === undefined ? {} : { name }), from, toValue: value, meta });
    });
  }

  #schedule(schedule: Construct): void {
    const expression = textOf(prop(schedule, 'schedule'));
    const name = textOf(prop(schedule, 'scheduleName'));
    const value = this.#targetValue(prop(schedule, 'target'));
    const meta = { ...(prop(schedule, 'enabled') === false ? { disabled: true } : {}), ...this.#conditional(schedule.conditional) };
    this.#deliver({
      ...schedule.site,
      address: schedule.path,
      by: 'schedule',
      ...(name === undefined ? {} : { name }),
      from: { kind: 'schedule', ...(expression === undefined ? {} : { expression }) },
      ...(value === 'unread' ? {} : { toValue: value }),
      ...(Object.keys(meta).length === 0 ? {} : { meta }),
    });
  }

  #redrive(queue: Construct): void {
    const dead = prop(queue, 'deadLetterQueue');
    if (!(dead instanceof ObjectValue)) return;
    const found = this.deployedOf(queue);
    if (found === undefined || found instanceof Unread) return;
    const receives = dead.get('maxReceiveCount');
    this.#deliver({
      ...queue.site,
      address: queue.path,
      by: 'redrive',
      from: { kind: 'queue', name: found.name },
      toValue: dead.get('queue'),
      what: `the dead-letter queue of ${queue.path}`,
      ...(typeof receives === 'number' ? { meta: { maxReceiveCount: receives } } : {}),
    });
  }

  #bucketSource(bucket: string, events: string[], filter: Value, of: Construct | undefined): DeliverySource {
    const prefix = filter instanceof ObjectValue ? textOf(filter.get('prefix')) : undefined;
    const suffix = filter instanceof ObjectValue ? textOf(filter.get('suffix')) : undefined;
    const versioned = of !== undefined && prop(of, 'versioned') === true;
    return { kind: 'bucket', name: bucket, events, ...(prefix === undefined ? {} : { prefix }), ...(suffix === undefined ? {} : { suffix }), ...(versioned ? { versioned } : {}) };
  }

  #notifications(bucket: Construct): void {
    const found = this.deployedOf(bucket);
    if (found === undefined || found instanceof Unread) return;
    const calls: [string[], Value, Value, Site, string | undefined][] = [
      ...bucket.addedBy('addEventNotification').map(({ args, site, conditional }): [string[], Value, Value, Site, string | undefined] => [[textOf(args[0]) ?? 's3:ObjectCreated:*'], args[1], args[2], site, conditional]),
      ...bucket.addedBy('addObjectCreatedNotification').map(({ args, site, conditional }): [string[], Value, Value, Site, string | undefined] => [['s3:ObjectCreated:*'], args[0], args[1], site, conditional]),
      ...bucket.addedBy('addObjectRemovedNotification').map(({ args, site, conditional }): [string[], Value, Value, Site, string | undefined] => [['s3:ObjectRemoved:*'], args[0], args[1], site, conditional]),
    ];
    calls.forEach(([events, destination, filter, site, conditional], index) => {
      const address = `${bucket.path}/Notifications/${index}`;
      this.#deliver({
        ...site,
        address,
        by: 'notification',
        from: this.#bucketSource(found.name, events, filter, bucket),
        toValue: destination instanceof Built ? destination.args[0] : destination,
        what: `what ${address} notifies`,
        ...(conditional === undefined && bucket.conditional === undefined ? {} : { meta: this.#conditional(bucket.conditional, conditional) }),
      });
    });
    if (prop(bucket, 'eventBridgeEnabled') === true) {
      for (const [family, detailType] of Object.entries(S3_DETAIL_TYPES)) {
        this.parts.deliveries.push({
          ...bucket.site,
          address: `${bucket.path}/eventbridge["${detailType}"]`,
          by: 'notification',
          from: { kind: 'bucket', name: found.name, events: [family] },
          to: { kind: 'bus', name: DEFAULT_EVENT_BUS, fields: { source: S3_EVENT_SOURCE, 'detail-type': detailType } },
          meta: { eventbridge: true },
        });
      }
    }
  }

  #userPool(pool: Construct): void {
    const name = textOf(prop(pool, 'userPoolName')) ?? generatedName(pool.path);
    const triggers: [string, Value, Site, string | undefined][] = [];
    const written = prop(pool, 'lambdaTriggers');
    if (written instanceof ObjectValue) for (const [trigger, fn] of written.entries) triggers.push([trigger, fn, pool.site, undefined]);
    for (const { args, site, conditional } of pool.addedBy('addTrigger')) if (typeof args[0] === 'string') triggers.push([args[0], args[1], site, conditional]);
    for (const [trigger, fn, site, conditional] of triggers) {
      const key = cognitoTriggerKey(name, trigger);
      const step = key.slice(key.lastIndexOf('/') + 1);
      this.#deliver({ ...site, address: `${pool.path}/${step}`, by: 'trigger', name: step, from: { kind: 'trigger', service: 'cognito', key }, toValue: fn, meta: { pool: name, trigger: step, ...this.#conditional(pool.conditional, conditional) } });
    }
  }

  #stream(construct: Construct): void {
    const found = this.deployedOf(construct);
    if (found === undefined || found instanceof Unread) return;
    const declares = construct.type === 'aws-kinesis.Stream' || prop(construct, 'stream') !== undefined || prop(construct, 'dynamoStream') !== undefined;
    if (!declares) return;
    this.parts.streams.push({ ...construct.site, address: construct.path, of: construct.type === 'aws-kinesis.Stream' ? 'stream' : 'table', name: found.name });
  }

  #destinations(fn: Construct): void {
    for (const [option, when] of [
      ['onSuccess', 'success'],
      ['onFailure', 'failure'],
    ] as const) {
      const destination = prop(fn, option);
      if (!(destination instanceof Built)) continue;
      const address = `${fn.path}/${option}`;
      const what = `the ${when} destination of ${fn.path}`;
      const to = destinationOf(this.#target(destination.args[0], fn.site, address, what), when);
      this.parts.deliveries.push({ ...fn.site, address, by: 'destination', from: { kind: 'outcome', when, of: { function: this.#functionIndex.get(fn) as number } }, ...(to === undefined ? {} : { to }), meta: { when } });
    }
  }

  #workflow(machine: Construct): void {
    const found = this.deployedOf(machine);
    const name = found !== undefined && !(found instanceof Unread) && found.generated !== true ? found.name : undefined;
    if (found instanceof Unread) {
      this.#row(machine.site, machine.path, { reason: 'workflow-name-unread', message: `the name of ${machine.path} is not read: ${found.text}`, hint: 'Nothing can start a workflow whose name is not read. Its steps are still drawn.' });
    }
    const written = definitionOf(machine, this.repoDir, this.appDir);
    if (written.unread !== undefined) {
      this.#row(machine.site, machine.path, { reason: 'workflow-definition-not-loaded', message: `the definition of ${machine.path} is not read: ${written.unread}`, hint: 'Nothing of this workflow is drawn. Give it a chain of states, or a definition file with a path the app settles.' });
    }
    this.parts.workflows.push({
      ...machine.site,
      ...(name === undefined ? {} : { name }),
      address: machine.path,
      ...(written.definition === undefined ? {} : { definition: written.definition }),
      fill: (placeholder) => {
        const value = written.placeholders.get(placeholder);
        if (value === undefined) return undefined;
        const text = textOf(value);
        if (text !== undefined) return text;
        const target = this.deployedOf(value);
        return target === undefined || target instanceof Unread || target.kind === 'url' ? undefined : deployedArn(target.kind, target.name);
      },
      meta: {
        declaredAs: machine.path,
        ...(found !== undefined && !(found instanceof Unread) && found.generated === true ? { nameGenerated: true } : {}),
        ...(textOf(prop(machine, 'stateMachineType')) === undefined ? {} : { type: textOf(prop(machine, 'stateMachineType')) }),
        ...this.#conditional(machine.conditional),
      },
    });
  }

  /**
   * A construct of a module nothing here reads that is handed a function: a
   * load balancer's target, an IoT rule, an AppSync resolver. Said at `info`,
   * so the map never says nothing runs the function.
   */
  #unreadHolder(construct: Construct): void {
    if (construct.type.startsWith('app:') || construct.type === 'core.App' || READ_MODULES.has(construct.type.slice(0, construct.type.indexOf('.')))) return;
    const handed = [...(construct.props?.entries.values() ?? []), ...construct.args].filter((value) => value instanceof Construct && FUNCTIONS.has(value.type)) as Construct[];
    for (const fn of handed) {
      this.#row(construct.site, construct.path, {
        reason: 'invoker-not-read',
        level: 'info',
        message: `${construct.path} (${construct.type}) is handed ${fn.path}, and is not read, so nothing drawn reaches the function through it`,
        hint: 'Constructs of this kind run the function outside anything this reads. Nothing to fix; the function is still in the graph.',
      });
    }
  }

  /** Called once every function is read: what a function's run ends in (P54). */
  finish(): void {
    for (const [fn] of this.#functionIndex) this.#destinations(fn);
  }
}

/** The modules whose constructs this reads, or that hold none a function is handed to. */
const READ_MODULES = new Set([
  'core',
  'constructs',
  'aws-lambda',
  'aws-lambda-nodejs',
  'aws-lambda-event-sources',
  'aws-lambda-destinations',
  'aws-apigateway',
  'aws-apigatewayv2',
  'aws-apigatewayv2-integrations',
  'aws-apigatewayv2-authorizers',
  'aws-sqs',
  'aws-sns',
  'aws-sns-subscriptions',
  'aws-events',
  'aws-events-targets',
  'aws-scheduler',
  'aws-scheduler-targets',
  'aws-dynamodb',
  'aws-kinesis',
  'aws-s3',
  'aws-s3-notifications',
  'aws-stepfunctions',
  'aws-stepfunctions-tasks',
  'aws-cognito',
  'aws-iam',
  'aws-logs',
  'aws-cloudwatch',
  'aws-ssm',
]);
