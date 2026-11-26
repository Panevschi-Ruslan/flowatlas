import { Construct, ObjectValue, textOf, Unread, type Site, type Value } from './values.js';
import type { Frame } from './interpret.js';

/**
 * What the methods and members of the CDK's constructs give back, where the
 * reading needs the result as a value (P57).
 *
 * Every call on a construct is recorded on it (`Construct.add`) and read when
 * the deployment is written out; only a few make something a later statement
 * goes on with: a REST API's `root` and the resources added below it, a
 * function URL, a mapping. Those are constructs of their own, made here, with
 * their place in the tree. Anything else gives back the construct or nothing.
 */

const REST_APIS = new Set(['aws-apigateway.RestApi', 'aws-apigateway.LambdaRestApi', 'aws-apigateway.SpecRestApi']);
const FUNCTIONS = new Set(['aws-lambda.Function', 'aws-lambda-nodejs.NodejsFunction', 'aws-lambda.DockerImageFunction', 'aws-lambda.SingletonFunction']);

/** A resource of a REST API, below another or at its root. */
const resource = (parent: Construct, part: Value, site: Site, api: Construct): Construct => {
  const key = textOf(part) ?? `?${parent.children.size}`;
  const existing = parent.children.get(key);
  if (existing !== undefined) return existing;
  const made = new Construct('aws-apigateway.Resource', `${parent.path}/${key}`, site, undefined, [parent, part], parent.conditional, parent.repeated);
  made.fields.set('parent', parent);
  made.fields.set('part', part);
  made.fields.set('api', api);
  parent.children.set(key, made);
  return made;
};

/** A REST API's root resource, made the first time it is asked for. */
export const rootOf = (api: Construct, site: Site): Construct => {
  const existing = api.children.get('');
  if (existing !== undefined) return existing;
  const root = new Construct('aws-apigateway.Resource', `${api.path}/Default`, site, undefined, [api], api.conditional, api.repeated);
  root.fields.set('api', api);
  root.fields.set('part', '');
  api.children.set('', root);
  return root;
};

/** A member of a construct that is a construct of its own. */
export const constructProperty = (construct: Construct, name: string, site: Site): Value | undefined => {
  if (REST_APIS.has(construct.type) && name === 'root') return rootOf(construct, site);
  if (construct.type === 'aws-apigateway.Resource' && name === 'api') return construct.fields.get('api');
  if (construct.type === 'aws-apigateway.Resource' && name === 'parentResource') return construct.fields.get('parent');
  return undefined;
};

/** What a method of a construct gives back. */
export const constructMethod = (construct: Construct, name: string, args: readonly Value[], site: Site, frame: Frame): Value => {
  const [first, second] = args;
  if (construct.type === 'aws-apigateway.Resource') {
    const api = construct.fields.get('api') as Construct;
    if (name === 'addResource') return resource(construct, first, site, api);
    if (name === 'resourceForPath' && typeof first === 'string') {
      return first.split('/').filter((part) => part !== '').reduce<Construct>((at, part) => resource(at, part, site, api), construct);
    }
    if (name === 'addProxy') {
      const proxy = resource(construct, '{proxy+}', site, api);
      const options = first instanceof ObjectValue ? first : new ObjectValue();
      if (options.get('anyMethod') !== false) proxy.add('addMethod', ['ANY', options.get('defaultIntegration')], site);
      return proxy;
    }
    return undefined;
  }
  if (FUNCTIONS.has(construct.type)) {
    if (name === 'addFunctionUrl') {
      const url = new Construct('aws-lambda.FunctionUrl', `${construct.path}/FunctionUrl`, site, first instanceof ObjectValue ? first : undefined, args, frame.conditional ?? construct.conditional, frame.repeated ?? construct.repeated);
      url.fields.set('function', construct);
      return url;
    }
    if (name === 'addEventSourceMapping') {
      const props = second instanceof ObjectValue ? new ObjectValue([...second.entries, ['target', construct]]) : new ObjectValue([['target', construct]]);
      return new Construct('aws-lambda.EventSourceMapping', `${construct.path}/${textOf(first) ?? 'Mapping'}`, site, props, args, frame.conditional ?? construct.conditional, frame.repeated ?? construct.repeated);
    }
    if (name === 'addEnvironment' || name === 'addEventSource' || name === 'addAlias' || name === 'addPermission') return construct;
    return undefined;
  }
  if (name === 'addRoutes') return [];
  return name.startsWith('grant') ? new Unread('a grant is a policy, not a way in', 'policy') : undefined;
};
