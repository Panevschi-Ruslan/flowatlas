import { deployedArn, deployedNameIn } from '@flowatlas/aws';
import { exportKey, generatedName, importedName, parameterKey, type DeployedKind, type PathStep } from '@flowatlas/core';
import { EMBEDDED, embedding, HOLE, Imported, isRecord, textOf, Unread } from './variables.js';

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
  /**
   * The name is the stand-in of a value another deployment publishes, by its
   * key: an ARN or a URL written around an import of the name (P253).
   */
  readonly imported?: string;
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
  /**
   * What another template exports under a key, where the caller has read the
   * templates beside this one (P248): `Fn::ImportValue` of a name is the value
   * exported under `export:<name>`, and `{{resolve:ssm:<name>}}` the one a
   * template writes to the parameter `parameter:<name>` (P253). `Unread`
   * where the key is published twice; `undefined` where nothing read publishes it.
   */
  readonly imported?: (key: string) => Exported | Unread | undefined;
}

/** What a template exports under a name (`Outputs.<Name>.Export.Name`): the deployed thing its value names, and the value as text. */
export interface Exported {
  readonly deployed?: Deployed;
  readonly text: string | Unread;
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

/**
 * A value of a parameter of the account written into text (P253):
 * `{{resolve:ssm:/orders/queue-url}}`, with or without a version. A secure
 * parameter and a secret are values no deployment publishes for another to
 * join on, and are not read.
 */
const DYNAMIC_REFERENCE = /\{\{resolve:(ssm|ssm-secure|secretsmanager):([^}]*)\}\}/g;

/**
 * What an ARN or a URL built around a value another deployment publishes
 * names: the imported thing, where the import is the name part of it, by the
 * import's stand-in; else why it is not read.
 */
const embeddedDeployed = (unread: Unread): Deployed | Unread => {
  if (unread.embeds === undefined) return unread;
  const found = deployedNameIn(unread.embeds.text);
  return found !== undefined && found.name === importedName(unread.embeds.key) ? { ...found, imported: unread.embeds.key } : unread;
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
      if (fn === 'Fn::ImportValue') {
        const found = this.#imported(argument);
        if (found instanceof Unread) return found;
        if (found.deployed !== undefined) return found.deployed;
        return typeof found.text === 'string' ? deployedInText(found.text) : found.text;
      }
      if (fn === 'Fn::Sub' || fn === 'Fn::Join') return this.#deployedInBuilt(this.text(value));
      return new Unread(`${fn} is decided when the stack is deployed`);
    }
    if (value instanceof Unread) return this.#deployedInBuilt(value);
    const text = textOf(value);
    if (text?.includes('{{resolve:') === true) {
      // A parameter another template of the repository writes names what its value names (P253).
      const whole = /^\{\{resolve:ssm:([^}]*?)(?::\d+)?\}\}$/.exec(text);
      const local = whole === null ? undefined : this.#options.imported?.(parameterKey(whole[1] as string));
      if (local !== undefined && !(local instanceof Unread) && local.deployed !== undefined) return local.deployed;
      if (local instanceof Unread) return local;
      return this.#deployedInBuilt(this.text(value));
    }
    return text === undefined ? undefined : deployedInText(text);
  }

  /** What a text built of parts names: an ARN or a URL written out, or one around an import (P253). */
  #deployedInBuilt(text: string | Unread): Deployed | Unread | undefined {
    if (typeof text === 'string') return deployedInText(text);
    if (text instanceof Imported) return text;
    const embedded = embeddedDeployed(text);
    if (!(embedded instanceof Unread)) return embedded;
    return text.partial === undefined ? text : (deployedInText(text.partial) ?? text);
  }

  /**
   * The export a `Fn::ImportValue` names: as another template of the
   * repository declares it (P248), else the output another repository's stack
   * exports under it, joined by the linker (P249); an `Unread` saying why where
   * its name is not read or two templates of the repository export it.
   */
  #imported(argument: unknown): Exported | Unread {
    const name = this.text(argument);
    if (name instanceof Unread) return new Unread(`the name of the export it imports is not read: ${name.text}`, name.variable);
    return this.#options.imported?.(exportKey(name)) ?? this.imported(argument);
  }

  /**
   * `Fn::ImportValue` of a name: the output another stack exports under it
   * (P249), or why the name is not read.
   */
  imported(argument: unknown): Imported | Unread {
    const name = this.text(argument);
    if (typeof name !== 'string') return new Unread(`the value is imported from another stack under a name that is not read: ${name.text}`, name.variable);
    return new Imported(exportKey(name), `the value is imported from another stack, which exports it as ${name}`);
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

  /** The values other deployments publish written into a text being built, at {@link EMBEDDED} (P253). */
  #embedded: Imported[] = [];

  /** A part of a text being built, a {@link HOLE} where it is not read. */
  #part(value: unknown, depth: number): string {
    const text = this.text(value, depth);
    if (typeof text === 'string') return text;
    if (text instanceof Imported) {
      this.#embedded.push(text);
      return EMBEDDED;
    }
    this.#unread ??= text;
    return text.partial ?? HOLE;
  }

  /** A text with each value of a parameter of the account it resolves (`{{resolve:ssm:...}}`) put at {@link EMBEDDED}. */
  #dynamic(text: string): string {
    if (!text.includes('{{resolve:')) return text;
    return text.replace(DYNAMIC_REFERENCE, (_whole, service: string, reference: string) => {
      const name = reference.replace(/:\d+$/, '');
      if (service !== 'ssm' || name === '') {
        this.#unread ??= new Unread(`a ${service === 'secretsmanager' ? 'secret' : 'secure parameter'} it resolves is not a value the files hold`);
        return HOLE;
      }
      // A parameter another template of the repository writes is its value, here (P253).
      const local = this.#options.imported?.(parameterKey(name));
      if (local !== undefined) {
        const text = local instanceof Unread ? local : local.text;
        if (typeof text === 'string') return text;
        this.#unread ??= text;
        return text.partial ?? HOLE;
      }
      this.#embedded.push(new Imported(parameterKey(name), `the value is the parameter ${name}, which another deployment writes`, `{{resolve:ssm:${reference}}}`));
      return EMBEDDED;
    });
  }

  /** A value as text: what the template settles, with a {@link HOLE} for the rest. */
  text(value: unknown, depth = 0): string | Unread {
    if (depth > 0) return this.#build(value, depth);
    // A name read while a text is built is a text of its own, with its own cause.
    const outer = this.#unread;
    const embedded = this.#embedded;
    this.#unread = undefined;
    this.#embedded = [];
    try {
      return this.#built(this.#build(value, 0));
    } finally {
      this.#unread = outer;
      this.#embedded = embedded;
    }
  }

  /** A text built at the top: the import itself where it is the whole text, else the text with it in place (P253). */
  #built(built: string | Unread): string | Unread {
    if (typeof built !== 'string' || !built.includes(EMBEDDED)) return built;
    const [imported] = this.#embedded;
    if (this.#embedded.length > 1) return new Unread(`it holds ${this.#embedded.length} values other deployments publish`, imported?.variable, built.split(EMBEDDED).join(HOLE));
    const because = built.includes(HOLE) ? (this.#unread ?? new Unread('part of the value is known only once the stack is deployed')) : undefined;
    return embedding(built, imported, because);
  }

  #build(value: unknown, depth: number): string | Unread {
    if (depth > 16) return new Unread('the value is nested too deeply to read');
    const plain = textOf(value);
    if (plain !== undefined) return this.#dynamic(plain);
    if (value instanceof Unread) return value;
    const intrinsic = intrinsicOf(value);
    if (intrinsic === undefined) return new Unread('the value is not text');
    const [fn, argument] = intrinsic;
    let built: string;
    if (fn === 'Ref' && typeof argument === 'string') built = this.#attributeText(argument, undefined);
    else if (fn === 'Fn::GetAtt') {
      const parts = getAttOf(argument);
      built = parts === undefined ? HOLE : this.#attributeText(parts[0], parts[1]);
    } else if (fn === 'Fn::ImportValue') {
      // The value as the template exporting it wrote it, or why it is not read.
      const found = this.#imported(argument);
      return found instanceof Unread ? found : found.text;
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
    built = this.#dynamic(built);
    // A text with an import in it is finished at the top, where every part of it is in (P253).
    if (!built.includes(HOLE) || built.includes(EMBEDDED)) return built;
    const because = this.#unread;
    return because === undefined
      ? new Unread('part of the value is known only once the stack is deployed', undefined, built)
      : new Unread(because.text, because.variable, built);
  }
}
