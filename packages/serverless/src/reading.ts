import { posix } from 'node:path';
import type {
  DeclaredStream,
  DeployedDelivery,
  DeployedFunction,
  DeployedRoute,
  DeployedSetting,
  DeployedWorkflow,
  DeliveryTarget,
  PathStep,
  PositionedDocument,
  PublishedRoot,
  Unresolved,
} from '@flowatlas/core';
import { generatedName, UNREAD_SPAN } from '@flowatlas/core';
import type { Deployed, Template } from './cloudformation.js';
import { textOf, Unread } from './variables.js';

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
  readonly rows: Unresolved[];
}

export const emptyParts = (): DeploymentParts => ({
  functions: [],
  routes: [],
  roots: [],
  workflows: [],
  deliveries: [],
  streams: [],
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

  /** A row about a name the platform generates, once per declaration. */
  readonly #generated = new Set<string>();

  generatedRow(found: Deployed, path: readonly PathStep[]): void {
    if (found.generated !== true || this.#generated.has(found.name)) return;
    this.#generated.add(found.name);
    const address = found.name.slice(UNREAD_SPAN.length + 1);
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

  /** A value a function is deployed with, read every way it can be. */
  settingOf(value: unknown): DeployedSetting {
    const written = writtenAs(value);
    const text = textOf(value);
    const found = this.template.deployedOf(value);
    if (found !== undefined && !(found instanceof Unread)) {
      return { written, ...(text === undefined ? {} : { text }), names: { kind: found.kind, name: found.name } };
    }
    if (text !== undefined) return { written, text };
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
  if (value !== null && typeof value === 'object') {
    const [key] = Object.keys(value as object);
    const argument = key === undefined ? undefined : (value as Record<string, unknown>)[key];
    if (key === 'Ref') return `!Ref ${String(argument)}`;
    if (key === 'Fn::GetAtt') return `!GetAtt ${Array.isArray(argument) ? argument.join('.') : String(argument)}`;
    if (key?.startsWith('Fn::') === true) return `!${key.slice(4)} ...`;
  }
  return JSON.stringify(value) ?? String(value);
};
