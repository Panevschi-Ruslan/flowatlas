import { AdapterNotFoundError, FlowatlasError } from '../errors.js';
import type { BrokerAdapter } from './broker.js';
import type { PackageJson } from './context.js';
import type { DbAdapter } from './db.js';
import type { EntryAdapter } from './entry.js';
import type { FrontendAdapter } from './frontend.js';

export const ADAPTER_SLOTS = ['entry', 'db', 'broker', 'frontend'] as const;

export type AdapterSlot = (typeof ADAPTER_SLOTS)[number];

/** Which interface belongs in which slot. */
export interface SlotAdapters {
  entry: EntryAdapter;
  db: DbAdapter;
  broker: BrokerAdapter;
  frontend: FrontendAdapter;
}

export type DetectedAdapters = { readonly [S in AdapterSlot]: readonly SlotAdapters[S][] };

/** Manual override per slot, for when detection guessed wrong. */
export type AdapterForce = { readonly [S in AdapterSlot]?: readonly string[] };

type SlotMaps = { [S in AdapterSlot]: Map<string, SlotAdapters[S]> };

/**
 * Lookup table of the adapters this build knows about.
 *
 * Dispatch is a map lookup keyed by slot and name, never a branch on a
 * technology: the core has no way to say "if this is library X", and no adapter
 * can be privileged over another. Adding support for something new means
 * registering one more entry here.
 */
export class AdapterRegistry {
  readonly #slots: SlotMaps = {
    entry: new Map(),
    db: new Map(),
    broker: new Map(),
    frontend: new Map(),
  };

  register<S extends AdapterSlot>(slot: S, adapter: SlotAdapters[S]): this {
    const registered = this.#slots[slot];
    if (registered.has(adapter.name)) {
      throw new FlowatlasError(
        'adapter-already-registered',
        `A ${slot} adapter named ${JSON.stringify(adapter.name)} is already registered.`,
        'Adapter names are unique per slot. Rename one of them.',
      );
    }
    registered.set(adapter.name, adapter);
    return this;
  }

  registerAll<S extends AdapterSlot>(slot: S, adapters: readonly SlotAdapters[S][]): this {
    for (const adapter of adapters) this.register(slot, adapter);
    return this;
  }

  list<S extends AdapterSlot>(slot: S): readonly SlotAdapters[S][] {
    return [...this.#slots[slot].values()];
  }

  names(slot: AdapterSlot): readonly string[] {
    return [...this.#slots[slot].keys()];
  }

  get<S extends AdapterSlot>(slot: S, name: string): SlotAdapters[S] | undefined {
    return this.#slots[slot].get(name);
  }

  /**
   * Picks the adapters that apply to a repository.
   *
   * A slot named under `force` is taken verbatim from the list given, which is
   * how an override can remove a wrongly detected adapter and not only add one.
   * Every other slot is filled by asking each registered adapter whether it
   * recognises the manifest.
   */
  detect(pkg: PackageJson, force: AdapterForce = {}): DetectedAdapters {
    return {
      entry: this.#resolve('entry', pkg, force.entry),
      db: this.#resolve('db', pkg, force.db),
      broker: this.#resolve('broker', pkg, force.broker),
      frontend: this.#resolve('frontend', pkg, force.frontend),
    };
  }

  #resolve<S extends AdapterSlot>(
    slot: S,
    pkg: PackageJson,
    forced: readonly string[] | undefined,
  ): readonly SlotAdapters[S][] {
    const registered = this.#slots[slot];
    if (forced === undefined) {
      return [...registered.values()].filter((adapter) => adapter.detect(pkg));
    }
    return forced.map((name) => {
      const adapter = registered.get(name);
      if (adapter === undefined) {
        throw new AdapterNotFoundError(slot, name, [...registered.keys()]);
      }
      return adapter;
    });
  }
}

/** An empty result, useful as a default and in tests. */
export const noAdapters: DetectedAdapters = {
  entry: [],
  db: [],
  broker: [],
  frontend: [],
};
