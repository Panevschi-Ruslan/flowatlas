import { posix } from 'node:path';
import type {
  DeclaredStream,
  DeployedDelivery,
  DeployedExport,
  DeployedFunction,
  DeployedImport,
  DeployedKind,
  DeployedRoute,
  DeployedSetting,
  DeployedWorkflow,
  DeliveryTarget,
  PathStep,
  PositionedDocument,
  PublishedRoot,
  Unresolved,
} from '@flowatlas/core';
import { alternativeAddress, generatedName, importedName, UNREAD_SPAN } from '@flowatlas/core';
import { importsInName, type Deployed, type Template } from './cloudformation.js';
import { Imported, isRecord, ParameterValue, textOf, Unread } from './variables.js';

/**
 * What every part of reading one service file shares: where things are put,
 * where each is written, and the two questions every event and resource asks -
 * what a value points at, and what a delivery's target is.
 *
 * The parts of a deployment are shared by every service file of a repository,
 * so a function's position among `functions` is its position in the whole
 * deployment, and a delivery of one file never points at another's function by
 * accident: each file's functions are found through its own `functionIndex`.
 */
export interface DeploymentParts {
  readonly functions: DeployedFunction[];
  readonly routes: DeployedRoute[];
  readonly roots: PublishedRoot[];
  readonly workflows: DeployedWorkflow[];
  readonly deliveries: DeployedDelivery[];
  readonly streams: DeclaredStream[];
  readonly exports: DeployedExport[];
  readonly imports: DeployedImport[];
  readonly rows: Unresolved[];
}

export const emptyParts = (): DeploymentParts => ({
  functions: [],
  routes: [],
  roots: [],
  workflows: [],
  deliveries: [],
  streams: [],
  exports: [],
  imports: [],
  rows: [],
});

/** A place in the file, for a row or a declaration. */
export interface Site {
  readonly file: string;
  readonly line: number;
}

export class FileReading {
  constructor(
    readonly parts: DeploymentParts,
    /** Repo-relative path of the service file. */
    readonly file: string,
    readonly document: PositionedDocument,
    readonly template: Template,
    /** Each function of this file, by its key: its position among the deployment's functions. */
    readonly functionIndex: ReadonlyMap<string, number>,
  ) {}

  /** Where the member at a path is written, or the nearest member above it that is. */
  siteOf(path: readonly PathStep[]): Site {
    for (let depth = path.length; depth >= 0; depth -= 1) {
      const at = this.document.at(path.slice(0, depth));
      if (at !== undefined) return { file: this.file, line: at.line };
    }
    return { file: this.file, line: 1 };
  }

  /** A row, at a path of the file, about the declaration at `symbol`. */
  row(path: readonly PathStep[], symbol: string, row: Omit<Unresolved, 'file' | 'line' | 'symbol'>): void {
    this.parts.rows.push({ ...this.siteOf(path), symbol, ...row });
  }

  /**
   * The API this deployment serves that an address written out is one of,
   * and the path it asks for there (P268); set by a reader that knows its
   * APIs, before any value is read.
   */
  ownApi: ((text: string) => { readonly name: string; readonly path: string } | undefined) | undefined;

  /** A row about a name the platform generates, once per declaration. */
  readonly #generated = new Set<string>();

  generatedRow(found: Deployed, path: readonly PathStep[]): void {
    if (found.generated !== true || this.#generated.has(found.name)) return;
    this.#generated.add(found.name);
    const address = found.name.slice(UNREAD_SPAN.length + 1);
    if (found.parameter !== undefined) {
      // Said where the parameter is declared, which is what names it.
      this.row(['Parameters', found.parameter], address, {
        reason: 'deployed-name-from-parameter',
        level: 'info',
        message: `the ${found.kind} named by the parameter ${found.parameter} is named by where the parameter is declared, ${address}, because the files give the parameter no value; what this deployment points at it by, or hands the parameter's value to, joins to it, and nothing outside it can`,
        hint: `Give the parameter ${found.parameter} a Default, a value in samconfig.toml's parameter_overrides, or one under services[].infra.options, and it is named by that value.`,
      });
      return;
    }
    this.row(path, address, {
      reason: 'deployed-name-generated',
      level: 'info',
      message: `${address} is a ${found.kind} with no name of its own, so it is named by where it is declared; what this file points at it by joins to it, and nothing outside this deployment can`,
      hint: 'Give it a name of its own where other repositories reach it.',
    });
  }

  /** A function of this file by its key, or by what a value points at. */
  functionNamed(key: string): Deployed | Unread | undefined {
    return this.functionIndex.has(key) ? this.template.known(`\u0000${key}`) : undefined;
  }

  /**
   * What a target a delivery hands its messages to is, or a row saying why
   * not: the same rule as Terraform's (`subscription-target-unread`), at
   * `info` when it names something nothing here follows.
   */
  targetOf(found: Deployed | Unread | undefined, path: readonly PathStep[], symbol: string, what: string): DeliveryTarget | undefined {
    if (found === undefined) {
      this.row(path, symbol, { reason: 'subscription-target-unread', message: `${what} is not read: nothing names it`, hint: TARGET_HINT });
      return undefined;
    }
    if (found instanceof Unread) {
      this.row(path, symbol, { reason: 'subscription-target-unread', message: `${what} is not read: ${found.text}`, hint: TARGET_HINT });
      return undefined;
    }
    this.generatedRow(found, path);
    this.importsOfName(found, path, what);
    const target = asTarget(found);
    if (target === undefined) {
      this.row(path, symbol, {
        reason: 'subscription-target-unread',
        level: 'info',
        message: `${what} is a ${found.kind} (${found.name}), which nothing is delivered to`,
        hint: TARGET_HINT,
      });
    }
    return target;
  }

  /**
   * That this deployment reads a value another publishes, here (P249): as
   * what it names, or, `as: 'name'`, as the name of something of `kinds`
   * written into an address of it (P253).
   */
  importAt(key: string, path: readonly PathStep[], what: string, kinds?: readonly (DeployedKind | 'url' | 'api')[], as?: 'name', within?: string): void {
    const site = this.siteOf(path);
    // A value of the provider's is every function's, and one place it is read.
    if (this.parts.imports.some((found) => found.key === key && found.file === site.file && found.line === site.line && found.within === within)) return;
    this.parts.imports.push({ key, ...site, what, ...(kinds === undefined ? {} : { kinds }), ...(as === undefined ? {} : { as }), ...(within === undefined ? {} : { within }) });
  }

  /**
   * That a name is written with values other deployments publish: an ARN
   * built around an imported name (P253), or a name built of several, or of
   * one and text (P259) - each the name, or a part of the name, of what the
   * thing is.
   */
  importsOfName(found: Deployed, path: readonly PathStep[], what: string): void {
    if (found.kind === 'url') return;
    for (const key of importsInName(found)) this.importAt(key, path, what, [found.kind], 'name', found.built === undefined ? undefined : found.name);
  }

  /**
   * Something another deployment publishes, used where the use says only
   * that it is one of `kinds` (P253): one reading of the declaration per kind,
   * each under its own address, of which the linker keeps the one the
   * publisher's value is. One kind is no choice, and is the declaration's own
   * address.
   */
  alternativesOf(found: Imported, kinds: readonly DeployedKind[], path: readonly PathStep[], what: string, address: string): { readonly kind: DeployedKind; readonly name: string; readonly address: string }[] {
    const name = importedName(found.key);
    if (kinds.length === 1) {
      this.importAt(found.key, path, what, kinds);
      return kinds.map((kind) => ({ kind, name, address }));
    }
    const alternatives = kinds.map((kind) => ({ kind, address: alternativeAddress(address, kind) }));
    this.parts.imports.push({ key: found.key, ...this.siteOf(path), what, kinds, alternatives });
    return alternatives.map((alternative) => ({ ...alternative, name }));
  }

  /**
   * That something drawn belongs to a reading of a choice (P264): listed on
   * the import's site beside the reading at `of`, under an address of the
   * same kind, so the linker keeps and drops it with that reading.
   */
  alongside(of: string, alternative: { readonly kind: DeployedKind; readonly address: string }): void {
    const index = this.parts.imports.findIndex((site) => site.alternatives?.some((one) => one.address === of) === true);
    const site = this.parts.imports[index];
    if (site?.alternatives !== undefined) this.parts.imports[index] = { ...site, alternatives: [...site.alternatives, alternative] };
  }

  /**
   * Something another deployment publishes, used where what it is - a queue an
   * event reads, a topic it subscribes to - is said by the use: named by its
   * key's stand-in, which the linker finishes where the publisher is read.
   */
  importedAs(found: Imported, kind: DeployedKind, path: readonly PathStep[], what: string, kinds: readonly DeployedKind[] = [kind]): Deployed {
    this.importAt(found.key, path, what, kinds);
    return { kind, name: importedName(found.key) };
  }

  /**
   * A delivery onto what a value names (P23). Where the value is one another
   * deployment publishes and the use says only that it is one of `kinds` - a
   * destination - it is one delivery per kind, of which the linker keeps the
   * one the publisher's value is (P253). `shape` finishes a target as the
   * delivery hands to it: a destination's bus is given the result's event.
   */
  deliverTo(
    delivery: Omit<DeployedDelivery, 'to'>,
    found: Deployed | Unread | undefined,
    path: readonly PathStep[],
    what: string,
    kinds: readonly DeployedKind[],
    shape: (to: DeliveryTarget | undefined) => DeliveryTarget | undefined = (to) => to,
  ): void {
    if (found instanceof Imported && kinds.length > 0) {
      for (const alternative of this.alternativesOf(found, kinds, path, what, delivery.address)) {
        const to = shape(asTarget({ kind: alternative.kind, name: alternative.name }));
        this.parts.deliveries.push({ ...delivery, address: alternative.address, ...(to === undefined ? {} : { to }) });
      }
      return;
    }
    const to = shape(this.targetOf(found, path, delivery.address, what));
    this.parts.deliveries.push({ ...delivery, ...(to === undefined ? {} : { to }) });
  }

  /** A value a function is deployed with, read every way it can be. */
  settingOf(value: unknown, path?: readonly PathStep[], what?: string): DeployedSetting {
    const written = writtenAs(value);
    const text = textOf(value);
    const found = this.template.deployedOf(value);
    // An output of another stack: what it names is the publisher's to say (P249).
    const imported = found instanceof Imported ? found : value instanceof Imported ? value : undefined;
    if (imported !== undefined) {
      if (path !== undefined) this.importAt(imported.key, path, what ?? 'a value a function is deployed with');
      return { written, imported: imported.key, unread: { text: imported.text, ...(imported.variable === undefined ? {} : { variable: imported.variable }) } };
    }
    if (found !== undefined && !(found instanceof Unread)) {
      // An ARN or a URL built around a name other deployments publish (P253, P259).
      if (path !== undefined) this.importsOfName(found, path, what ?? 'a value a function is deployed with');
      return { written, ...(text === undefined ? {} : { text }), names: { kind: found.kind, name: found.name } };
    }
    if (text !== undefined) {
      // An address of an API this deployment serves, by its region and stage (P268).
      const api = this.ownApi?.(text);
      return api === undefined ? { written, text } : { written, text, names: { kind: 'api', name: api.name }, path: api.path };
    }
    // The value of a parameter the files give none, which names one thing this
    // deployment declares: that thing, by the parameter's stand-in (P268).
    const named = value instanceof ParameterValue ? this.template.namedByParameter(value) : undefined;
    if (named !== undefined) {
      if (path !== undefined) this.generatedRow(named, path);
      return { written, names: { kind: named.kind, name: named.name } };
    }
    const because = found instanceof Unread ? found : value instanceof Unread ? value : new Unread('it is not text');
    return { written, unread: { text: because.text, ...(because.variable === undefined ? {} : { variable: because.variable }) } };
  }

  /** The service file's directory, repo-relative, `.` at the root. */
  get dir(): string {
    const dir = posix.dirname(this.file);
    return dir === '' ? '.' : dir;
  }
}

const TARGET_HINT =
  'Point it at a function, a queue, a topic or a bus the file declares - by its key, a Ref or Fn::GetAtt, or an ARN whose name is written out.';

/** A deployed thing as the target a delivery hands its messages to, when it can be one. */
export const asTarget = (found: Deployed): DeliveryTarget | undefined => {
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
      return undefined;
  }
};

/** A value as a person would recognise it in the file. */
export const writtenAs = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Unread) return value.variable === undefined ? 'a value not known from the files' : `\${${value.variable}}`;
  if (isRecord(value) && 'Fn::ImportValue' in value) {
    const name = textOf(value['Fn::ImportValue']);
    return name === undefined ? '!ImportValue ...' : `!ImportValue ${name}`;
  }
  if (value !== null && typeof value === 'object') {
    const [key] = Object.keys(value as object);
    const argument = key === undefined ? undefined : (value as Record<string, unknown>)[key];
    if (key === 'Ref') return `!Ref ${String(argument)}`;
    if (key === 'Fn::GetAtt') return `!GetAtt ${Array.isArray(argument) ? argument.join('.') : String(argument)}`;
    if (key?.startsWith('Fn::') === true) return `!${key.slice(4)} ...`;
  }
  return JSON.stringify(value) ?? String(value);
};
