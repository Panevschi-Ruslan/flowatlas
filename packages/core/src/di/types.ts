import type {
  ClassDeclaration,
  ParameterDeclaration,
  PropertyDeclaration,
} from 'ts-morph';
import type { UnresolvedLevel } from '../model/graph.js';

/** How a provider token is satisfied, when the injection goes through one. */
export type TokenProviderKind = 'useClass' | 'useValue' | 'useFactory' | 'useExisting';

/**
 * How the container was told what to hand over.
 *
 * `type` is the declared type of a constructor parameter, `token` a name the
 * extractor read out of an annotation, `field-inject` a property that asks the
 * container for its own value. The core never learns which annotation or which
 * function spells any of them.
 */
export type DiVia = 'type' | 'token' | 'field-inject';

/** What an injection point resolves to. */
export type DiTarget =
  | { readonly kind: 'class'; readonly id: string; readonly declaration: ClassDeclaration }
  | {
      readonly kind: 'external';
      readonly id: string;
      readonly package: string;
      readonly typeName: string;
    }
  | {
      readonly kind: 'token';
      readonly id: string;
      readonly token: string;
      readonly provider: TokenProviderKind;
      /** Set when the token is satisfied by a class this repository declares. */
      readonly declaration?: ClassDeclaration;
    };

export interface DiUnresolved {
  readonly kind: 'unresolved';
  readonly reason: string;
  /** Carried through to the row this becomes. Absent means `action`. */
  readonly level?: UnresolvedLevel;
  readonly hint: string;
  readonly text: string;
}

export type DiResolution = DiTarget | DiUnresolved;

export interface DiEntry {
  /** Property name the value is stored under, when it is stored on one. */
  readonly property: string | undefined;
  /** The constructor parameter, when the container passed the value in. */
  readonly parameter?: ParameterDeclaration;
  /** The property, when it asked the container for its own value. */
  readonly declaration?: PropertyDeclaration;
  /** Position in the constructor, or null when no constructor was involved. */
  readonly index: number | null;
  readonly via: DiVia;
  readonly resolution: DiResolution;
}

/**
 * What each class injects, keyed by the property the instance is reachable
 * through. The call resolver walks this to turn `this.orders.create()` into an
 * edge to a specific method of a specific class.
 */
export class DiMap {
  readonly #byClass = new Map<ClassDeclaration, Map<string, DiEntry>>();
  readonly #entries = new Map<ClassDeclaration, DiEntry[]>();

  set(owner: ClassDeclaration, entry: DiEntry): void {
    const all = this.#entries.get(owner);
    if (all === undefined) this.#entries.set(owner, [entry]);
    else all.push(entry);
    if (entry.property === undefined) return;
    const byProperty = this.#byClass.get(owner);
    if (byProperty === undefined) {
      this.#byClass.set(owner, new Map([[entry.property, entry]]));
    } else {
      byProperty.set(entry.property, entry);
    }
  }

  lookup(owner: ClassDeclaration, property: string): DiEntry | undefined {
    return this.#byClass.get(owner)?.get(property);
  }

  entriesOf(owner: ClassDeclaration): readonly DiEntry[] {
    return this.#entries.get(owner) ?? [];
  }

  has(owner: ClassDeclaration): boolean {
    return this.#entries.has(owner);
  }
}

/**
 * The framework knowledge the resolver is missing.
 *
 * Everything the core can work out on its own it does; everything that depends
 * on what a particular framework spells its annotations is asked of the
 * extractor through one of these. Without them the resolver still works: it
 * reads declared types, which is what container injection is in every framework
 * this tool reads.
 */
export interface DiResolverOptions {
  /** Id of a class this repository declares, or undefined when it is not indexed. */
  classIdOf(declaration: ClassDeclaration): string | undefined;
  /** Id for a class an installed package declares; the extractor creates the node. */
  externalIdOf(ref: { readonly package: string; readonly typeName: string }): string;
  /**
   * What a parameter named by an annotation resolves to.
   *
   * Undefined means "no annotation here, read the type"; a resolution, including
   * an unresolved one, means the annotation had the final say.
   */
  tokenResolver?(parameter: ParameterDeclaration): DiResolution | undefined;
  /** What a property that asks the container for its own value resolves to. */
  fieldInjectResolver?(property: PropertyDeclaration): DiResolution | undefined;
  /**
   * Whether the container may leave a parameter empty, beyond a question token.
   * Only the wording of the report changes: an expected miss reads as expected.
   */
  isOptional?(parameter: ParameterDeclaration): boolean;
  /** What a reader should do about a parameter whose type names no class. */
  injectHint?: string;
}
