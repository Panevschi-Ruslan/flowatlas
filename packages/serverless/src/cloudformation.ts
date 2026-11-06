import { deployedArn, deployedNameIn } from '@flowatlas/aws';
import { generatedName, type DeployedKind, type PathStep } from '@flowatlas/core';
import { HOLE, isRecord, textOf, Unread } from './variables.js';

/**
 * CloudFormation's vocabulary: resources by type, and the intrinsic functions
 * that point at them.
 *
 * A Serverless Framework service declares what its functions do not - a queue,
 * a table, a bus - under `resources.Resources`, as a CloudFormation template
 * does, and points at it with `Ref` and `Fn::GetAtt`; so do its events and its
 * environment. Every such pointer is read here, once, to the deployed thing it
 * names. A resource with no physical name is named by its logical id, through
 * `generatedName` (P57): CloudFormation chooses its name when it is created,
 * and everything in the same template that points at it agrees on the stand-in.
 *
 * Nothing here is specific to the framework but the logical ids it gives the
 * functions it creates, which the caller hands in; the reader of AWS SAM
 * templates (P246) reads the same resources with the same rows, handing in the
 * types it adds, where its resources sit and what a function's logical id is.
 */

/** A deployed thing, by kind and deployed name. */
export interface Deployed {
  /** `url` is a function's own address, by the function's deployed name. */
  readonly kind: DeployedKind | 'url';
  readonly name: string;
  /** A function this deployment creates, by its position among `functions`. */
  readonly function?: number;
  /** The table's stream of changes rather than the table. */
  readonly changes?: boolean;
  /** The name is a stand-in for one the platform generates. */
  readonly generated?: boolean;
}

/** What a resource type declares, and the property that names it. */
export interface Declares {
  readonly kind: DeployedKind;
  readonly name: string;
  /** What `Ref` returns for it. */
  readonly ref: 'name' | 'arn' | 'url';
}

export const RESOURCE_KINDS: ReadonlyMap<string, Declares> = new Map<string, Declares>([
  ['AWS::Lambda::Function', { kind: 'function', name: 'FunctionName', ref: 'name' }],
  ['AWS::StepFunctions::StateMachine', { kind: 'workflow', name: 'StateMachineName', ref: 'arn' }],
  ['AWS::SQS::Queue', { kind: 'queue', name: 'QueueName', ref: 'url' }],
  ['AWS::SNS::Topic', { kind: 'topic', name: 'TopicName', ref: 'arn' }],
  ['AWS::Events::EventBus', { kind: 'bus', name: 'Name', ref: 'name' }],
  ['AWS::DynamoDB::Table', { kind: 'table', name: 'TableName', ref: 'name' }],
  ['AWS::DynamoDB::GlobalTable', { kind: 'table', name: 'TableName', ref: 'name' }],
  ['AWS::Kinesis::Stream', { kind: 'stream', name: 'Name', ref: 'name' }],
  ['AWS::S3::Bucket', { kind: 'bucket', name: 'BucketName', ref: 'name' }],
]);

/** One resource of a template, its properties with every variable resolved. */
export interface Resource {
  readonly logicalId: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
  /** Where it is declared, for a person and for every row about it. */
  readonly address: string;
  /** Where it is written in the file. */
  readonly path: readonly PathStep[];
}

/** What the template is deployed with that a pseudo parameter stands for. */
export interface Pseudo {
  readonly region?: string;
  readonly stackName?: string;
}

/** Something the caller knows by a logical id the template does not declare: a function the framework creates. */
export type Known = (logicalId: string) => Deployed | Unread | undefined;

/** How a template sits in the file that holds it, and what its reader adds to the vocabulary. */
export interface TemplateOptions {
  /** Where `Resources` is in the file: `resources.Resources` in a service file, `Resources` in a template. */
  readonly at?: readonly string[];
  /** Put before every address, to keep a nested template's resources apart from its parent's: `Shipping.`. */
  readonly scope?: string;
  /** The resource types read, when a reader adds its own to {@link RESOURCE_KINDS}. */
  readonly kinds?: ReadonlyMap<string, Declares>;
  /** A function the template declares, by its logical id: its position among the deployment's functions. */
  readonly functionOf?: (logicalId: string) => number | undefined;
  /**
   * What one attribute of a resource is, where the caller knows it and the
   * resource's own name does not say: an output of a nested template.
   */
  readonly attributeOf?: (logicalId: string, attribute: string) => Deployed | Unread | undefined;
  /** Where a resource is written when it is not under its own logical id: one a loop makes. */
  readonly paths?: ReadonlyMap<string, readonly PathStep[]>;
}

/** A value as plain text, or `undefined` when it is not a string. */
const stringOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** A `Fn::GetAtt` as its logical id and attribute, whichever spelling it is in. */
const getAttOf = (value: unknown): [string, string] | undefined => {
  if (Array.isArray(value) && typeof value[0] === 'string') return [value[0], typeof value[1] === 'string' ? value[1] : 'Arn'];
  if (typeof value === 'string') {
    const dot = value.indexOf('.');
    return dot < 0 ? [value, 'Arn'] : [value.slice(0, dot), value.slice(dot + 1)];
  }
  return undefined;
};

/** The one key of an intrinsic function, when a value is one. */
export const intrinsicOf = (value: unknown): [name: string, argument: unknown] | undefined => {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  const [key] = keys;
  return keys.length === 1 && key !== undefined && (key === 'Ref' || key.startsWith('Fn::') || key === 'Condition') ? [key, value[key]] : undefined;
};

/** Deployed things written out in an ARN or URL, when the name part of it was read. */
const deployedInText = (text: string): Deployed | undefined => {
  const found = deployedNameIn(text);
  return found === undefined || found.name.includes(HOLE) ? undefined : found;
};

export class Template {
  readonly resources = new Map<string, Resource>();
  readonly kinds: ReadonlyMap<string, Declares>;
  readonly #options: TemplateOptions;

  constructor(
    resources: unknown,
    readonly known: Known,
    readonly pseudo: Pseudo,
    readonly file: string,
    options: TemplateOptions = {},
  ) {
    this.#options = options;
    this.kinds = options.kinds ?? RESOURCE_KINDS;
    if (!isRecord(resources)) return;
    const at = options.at ?? ['resources', 'Resources'];
    for (const [logicalId, written] of Object.entries(resources)) {
      if (!isRecord(written)) continue;
      const type = stringOf(written['Type']);
      if (type === undefined) continue;
      this.resources.set(logicalId, {
        logicalId,
        type,
        properties: isRecord(written['Properties']) ? written['Properties'] : {},
        address: `${options.scope ?? ''}${[...at, logicalId].join('.')}`,
        path: options.paths?.get(logicalId) ?? [...at, logicalId],
      });
    }
  }

  /** Every resource of one type. */
  ofType(type: string): Resource[] {
    return [...this.resources.values()].filter((resource) => resource.type === type);
  }

  /** The deployed thing a logical id declares, whether the template or the caller knows it. */
  named(logicalId: string): Deployed | Unread | undefined {
    const resource = this.resources.get(logicalId);
    if (resource === undefined) return this.known(logicalId);
    // A function's URL is the function's own address, named by the function (P54).
    if (resource.type === 'AWS::Lambda::Url') {
      const target = this.deployedOf(resource.properties['TargetFunctionArn']);
      return target === undefined || target instanceof Unread ? target : target.kind === 'function' ? { kind: 'url', name: target.name } : undefined;
    }
    const declares = this.kinds.get(resource.type);
    if (declares === undefined) return undefined;
    const index = declares.kind === 'function' ? this.#options.functionOf?.(logicalId) : undefined;
    const own = index === undefined ? {} : { function: index };
    const written = resource.properties[declares.name];
    if (written === undefined || written === null) {
      return { kind: declares.kind, name: generatedName(resource.address), generated: true, ...own };
    }
    const name = this.text(written);
    if (typeof name === 'string') return { kind: declares.kind, name, ...own };
    return new Unread(`the ${declares.name} of ${resource.address}: ${name.text}`, name.variable);
  }

  /** What an attribute of a resource names: the caller's answer where it has one, else the resource. */
  #attribute(logicalId: string, attribute: string): Deployed | Unread | undefined {
    const answered = this.#options.attributeOf?.(logicalId, attribute);
    if (answered !== undefined) return answered;
    if (attribute.startsWith('Outputs.')) return new Unread(`${attribute} of ${logicalId} is an output of a template that is not read`);
    const found = this.named(logicalId);
    return found === undefined || found instanceof Unread ? found : { ...found, ...(attribute === 'StreamArn' ? { changes: true } : {}) };
  }

  /**
   * What a value points at: a reference, an attribute, an ARN or URL written
   * out or built with `Fn::Sub` / `Fn::Join`. `undefined` when it points at
   * nothing of the kind - a bare name, which only its caller can place - and
   * `Unread` when it points at something whose name is not read.
   */
  deployedOf(value: unknown): Deployed | Unread | undefined {
    const intrinsic = intrinsicOf(value);
    if (intrinsic !== undefined) {
      const [fn, argument] = intrinsic;
      if (fn === 'Ref' && typeof argument === 'string') return argument.startsWith('AWS::') ? undefined : this.named(argument);
      if (fn === 'Fn::GetAtt') {
        const parts = getAttOf(argument);
        if (parts === undefined) return new Unread('Fn::GetAtt names no resource');
        return this.#attribute(parts[0], parts[1]);
      }
      if (fn === 'Fn::ImportValue') return new Unread('the value is imported from another stack, whose outputs are not read');
      if (fn === 'Fn::Sub' || fn === 'Fn::Join') {
        const text = this.text(value);
        if (typeof text === 'string') return deployedInText(text);
        return text.partial === undefined ? text : (deployedInText(text.partial) ?? text);
      }
      return new Unread(`${fn} is decided when the stack is deployed`);
    }
    if (value instanceof Unread) return value.partial === undefined ? value : (deployedInText(value.partial) ?? value);
    const text = textOf(value);
    return text === undefined ? undefined : deployedInText(text);
  }

  /** What `Ref` or an attribute of a resource is as text, a {@link HOLE} where it is known only once deployed. */
  #attributeText(logicalId: string, attribute: string | undefined): string {
    if (logicalId.startsWith('AWS::')) return this.#pseudoText(logicalId);
    const found = attribute === undefined ? this.named(logicalId) : this.#attribute(logicalId, attribute);
    if (found instanceof Unread) this.#unread ??= found;
    if (found === undefined || found instanceof Unread || found.kind === 'url') return HOLE;
    // An output is text to whoever reads it, and an ARN is the one spelling every kind has.
    if (attribute?.startsWith('Outputs.') === true) return deployedArn(found.kind, found.name);
    const resource = this.resources.get(logicalId);
    const declares = resource === undefined ? undefined : this.kinds.get(resource.type);
    const shape = attribute === undefined ? (declares?.ref ?? 'arn') : attribute === 'Arn' ? 'arn' : attribute === 'QueueUrl' ? 'url' : attribute === 'StreamArn' ? 'stream' : 'name';
    switch (shape) {
      case 'arn':
        return deployedArn(found.kind, found.name);
      case 'url':
        return `https://sqs.${this.pseudo.region ?? HOLE}.amazonaws.com/${HOLE}/${found.name}`;
      case 'stream':
        return `arn:aws:dynamodb:::table/${found.name}/stream/${HOLE}`;
      default:
        return found.name;
    }
  }

  #pseudoText(name: string): string {
    switch (name) {
      case 'AWS::Region':
        return this.pseudo.region ?? HOLE;
      case 'AWS::StackName':
        return this.pseudo.stackName ?? HOLE;
      case 'AWS::Partition':
        return 'aws';
      case 'AWS::URLSuffix':
        return 'amazonaws.com';
      default:
        return HOLE;
    }
  }

  /**
   * The first value a text being built could not read, so the text says why
   * it is not read - a parameter with no value - rather than only that it is not.
   */
  #unread: Unread | undefined;

  /** A part of a text being built, a {@link HOLE} where it is not read. */
  #part(value: unknown, depth: number): string {
    const text = this.text(value, depth);
    if (typeof text === 'string') return text;
    this.#unread ??= text;
    return text.partial ?? HOLE;
  }

  /** A value as text: what the template settles, with a {@link HOLE} for the rest. */
  text(value: unknown, depth = 0): string | Unread {
    if (depth > 0) return this.#build(value, depth);
    // A name read while a text is built is a text of its own, with its own cause.
    const outer = this.#unread;
    this.#unread = undefined;
    try {
      return this.#build(value, 0);
    } finally {
      this.#unread = outer;
    }
  }

  #build(value: unknown, depth: number): string | Unread {
    if (depth > 16) return new Unread('the value is nested too deeply to read');
    const plain = textOf(value);
    if (plain !== undefined) return plain;
    if (value instanceof Unread) return value;
    const intrinsic = intrinsicOf(value);
    if (intrinsic === undefined) return new Unread('the value is not text');
    const [fn, argument] = intrinsic;
    let built: string;
    if (fn === 'Ref' && typeof argument === 'string') built = this.#attributeText(argument, undefined);
    else if (fn === 'Fn::GetAtt') {
      const parts = getAttOf(argument);
      built = parts === undefined ? HOLE : this.#attributeText(parts[0], parts[1]);
    } else if (fn === 'Fn::Join' && Array.isArray(argument) && typeof argument[0] === 'string' && Array.isArray(argument[1])) {
      const delimiter = argument[0];
      built = argument[1].map((part) => this.#part(part, depth + 1)).join(delimiter);
    } else if (fn === 'Fn::Sub') {
      const [template, variables] = Array.isArray(argument) ? [argument[0], argument[1]] : [argument, undefined];
      if (typeof template !== 'string') return new Unread('Fn::Sub is not given text');
      built = template.replace(/\$\{([^}!]+)\}/g, (_whole, inside: string) => {
        const own = isRecord(variables) ? variables[inside] : undefined;
        if (own !== undefined) return this.#part(own, depth + 1);
        const dot = inside.indexOf('.');
        return dot < 0 || inside.startsWith('AWS::') ? this.#attributeText(inside, undefined) : this.#attributeText(inside.slice(0, dot), inside.slice(dot + 1));
      });
    } else {
      return new Unread(`${fn} is decided when the stack is deployed`);
    }
    if (!built.includes(HOLE)) return built;
    const because = this.#unread;
    return because === undefined
      ? new Unread('part of the value is known only once the stack is deployed', undefined, built)
      : new Unread(because.text, because.variable, built);
  }
}
