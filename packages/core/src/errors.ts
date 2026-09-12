import type { GraphEdge } from './model/edges.js';

/**
 * Base class for every error this package throws.
 *
 * `code` is the stable, machine-readable cause; `message` is for humans and may
 * change. `hint` says what to do about it and is printed by the CLI.
 */
export class FlowatlasError extends Error {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.hint = hint;
  }
}

/**
 * An edge referenced a node that was never added.
 *
 * Always a bug in the code that filled the builder, never a legitimate state of
 * a graph: an unresolvable target belongs in `unresolved`, not in a half edge.
 */
export class DanglingEdgeError extends FlowatlasError {
  readonly edges: readonly GraphEdge[];

  constructor(edges: readonly GraphEdge[]) {
    const shown = edges
      .slice(0, 10)
      .map((e) => `  ${e.from} -${e.type}-> ${e.to}`)
      .join('\n');
    const more = edges.length > 10 ? `\n  ... and ${edges.length - 10} more` : '';
    super(
      'dangling-edge',
      `${edges.length} edge(s) reference unknown nodes:\n${shown}${more}`,
      'Add the missing node before the edge, or record the target in unresolved instead.',
    );
    this.edges = edges;
  }
}

/** A channel name was empty or already carried the `channel:` prefix. */
export class InvalidChannelNameError extends FlowatlasError {
  readonly value: string;

  constructor(value: string) {
    super(
      'invalid-channel-name',
      `Invalid channel name ${JSON.stringify(value)}.`,
      'Pass the bare channel name without a repo prefix and without the "channel:" prefix.',
    );
    this.value = value;
  }
}

/** An id part was empty or otherwise unusable. */
export class InvalidIdError extends FlowatlasError {
  constructor(part: string, value: unknown) {
    super(
      'invalid-id',
      `Id part ${JSON.stringify(part)} must be a non-empty string, got ${JSON.stringify(value)}.`,
    );
  }
}

/** A graph on disk was produced by a different version of the model. */
export class SchemaVersionMismatchError extends FlowatlasError {
  readonly found: unknown;
  readonly expected: number;

  constructor(found: unknown, expected: number) {
    super(
      'schema-version-mismatch',
      `Graph schema version ${String(found)} does not match the expected ${expected}.`,
      'Rebuild the graph with `flowatlas extract` (or `flowatlas build`).',
    );
    this.found = found;
    this.expected = expected;
  }
}

/** The same type id was registered twice with different structures. */
export class DuplicateTypeError extends FlowatlasError {
  constructor(id: string, existingHash: string, incomingHash: string) {
    super(
      'duplicate-type',
      `Type ${id} was already registered with structural hash ${existingHash}, got ${incomingHash}.`,
      'One id must mean one declaration. Disambiguate the id or reuse the existing entry.',
    );
  }
}

/** No configuration file was found. */
export class ConfigNotFoundError extends FlowatlasError {
  constructor(searchedFrom: string) {
    super(
      'config-not-found',
      `No flowatlas.config.json found in ${searchedFrom} or any parent directory.`,
      'Run `flowatlas init` to create one.',
    );
  }
}

/** The configuration file was found but is not usable. */
export class ConfigInvalidError extends FlowatlasError {
  readonly issues: readonly string[];

  constructor(configPath: string, issues: readonly string[], hint?: string) {
    super(
      'config-invalid',
      `Invalid configuration in ${configPath}:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
      hint,
    );
    this.issues = issues;
  }
}

/** An adapter was requested by name but is not registered in that slot. */
export class AdapterNotFoundError extends FlowatlasError {
  constructor(slot: string, name: string, known: readonly string[]) {
    super(
      'adapter-not-found',
      `No ${slot} adapter named ${JSON.stringify(name)}. Registered: ${known.length > 0 ? known.join(', ') : '(none)'}.`,
      'Fix the name under adapters.force in flowatlas.config.json, or register the adapter.',
    );
  }
}
