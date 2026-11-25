import {
  isMessageTypeNode,
  MOST_OPEN,
  MOST_WRITTEN,
  NAME_WRITTEN_META,
  selectionsOf,
  testMayTake,
  typeNamesIn,
  type GraphNode,
  type NameSite,
  type NameTest,
  type NameWritten,
  type OpenPlace,
  type WrittenPlace,
} from '@flowatlas/core';
import type { MessageTypeLookup } from './analysis/message-types.js';
import { cmp } from './order.js';

/**
 * The code the build read, for where each message type's name is written
 * (P404): each service by the name its nodes carry, its files as the build
 * listed them (relative to the repository), and a reader of each. Handed to
 * `linkGraphs` by whoever can see the files; without it no type says where
 * its name is written, and "nothing selects it" stays as sure as the graph
 * alone makes it.
 */
export interface TypeNameSources {
  readonly services: ReadonlyArray<{
    readonly service: string;
    readonly files: readonly string[];
    read(file: string): string | undefined;
  }>;
}

/** One place a word is written, with the file and the service. */
interface Found extends NameSite {
  readonly service: string;
  readonly file: string;
}

/** A test written in the code, with the file and the service. */
interface FoundTest extends NameTest {
  readonly service: string;
  readonly file: string;
}

/** How many lines below a selection's line its name may still be written: a test or case over several lines. */
const SELECTION_LINES = 6;

/** Each file of each service read for `words`, the way `typeNamesIn` reads one. */
const readAll = (sources: TypeNameSources, words: ReadonlySet<string>, tests: boolean): { sites: Found[]; tests: FoundTest[] } => {
  const sites: Found[] = [];
  const found: FoundTest[] = [];
  for (const service of sources.services) {
    for (const file of service.files) {
      const text = service.read(file);
      if (text === undefined) continue;
      const read = typeNamesIn(file, text, words, { tests });
      for (const site of read.sites) sites.push({ ...site, service: service.service, file });
      for (const test of read.tests) found.push({ ...test, service: service.service, file });
    }
  }
  return { sites, tests: found };
};

const placeOf = (site: { service: string; file: string; line: number; text: string }): WrittenPlace => ({
  service: site.service,
  loc: `${site.file}:${site.line}`,
  text: site.text,
});

/**
 * Says on each message type node where its name is written (P404),
 * `meta.nameWritten`: where it is sent, how many places define it, and every
 * other place, each a choice the graph did not read or a test that may take
 * it. Two readings of the code: the names themselves, then the names a
 * definition holds them by (`Claimed = 'ROW_CLAIMED'` is used as
 * `Events.Claimed`) and the enums and objects holding them, whose use as a
 * whole (`Object.values(Events)`) may choose any of them.
 */
export const markTypeNamesWritten = (nodes: ReadonlyMap<string, GraphNode>, lookup: MessageTypeLookup, sources: TypeNameSources): void => {
  const types = [...nodes.values()].filter(isMessageTypeNode).sort((a, b) => cmp(a.id, b.id));
  const valueOf = (node: GraphNode): string => (typeof node.meta?.['messageType'] === 'string' ? node.meta['messageType'] : node.label);
  const values = new Set(types.map(valueOf));
  if (values.size === 0) return;

  const first = readAll(sources, values, true);
  // The names a definition holds a type by, and the enums and objects holding it.
  const aliases = new Map<string, { values: Set<string>; container?: string; files: Set<string> }>();
  const containers = new Map<string, Set<string>>();
  for (const site of first.sites) {
    if (site.kind !== 'definition') continue;
    if (site.alias !== undefined && !values.has(site.alias)) {
      const key = `${site.alias}\u0000${site.container ?? ''}`;
      const known = aliases.get(key) ?? {
        values: new Set<string>(),
        ...(site.container === undefined ? {} : { container: site.container }),
        files: new Set<string>(),
      };
      known.values.add(site.word);
      known.files.add(`${site.service}\u0000${site.file}`);
      aliases.set(key, known);
    }
    if (site.container !== undefined && !values.has(site.container)) {
      const held = containers.get(site.container) ?? new Set<string>();
      held.add(site.word);
      containers.set(site.container, held);
    }
  }
  containers.delete('default');
  const secondWords = new Set<string>([...[...aliases.keys()].map((key) => key.split('\u0000')[0]!), ...containers.keys()]);
  const second = secondWords.size === 0 ? { sites: [] as Found[] } : readAll(sources, secondWords, false);

  /** The places each value is written, under its own name or one a definition holds it by. */
  const byValue = new Map<string, Array<Found & { value: string }>>();
  const note = (value: string, site: Found): void => {
    const list = byValue.get(value) ?? [];
    list.push({ ...site, value });
    byValue.set(value, list);
  };
  for (const site of first.sites) note(site.word, site);
  // A bare constant is used where it is written or imported; a member of an enum or object, as that member.
  const importedIn = new Set(second.sites.filter((site) => site.kind === 'import').map((site) => `${site.word}\u0000${site.service}\u0000${site.file}`));
  const wholeUses: Found[] = [];
  for (const site of second.sites) {
    const held = containers.get(site.word);
    if (held !== undefined && site.kind === 'other') wholeUses.push(site);
    for (const [key, alias] of aliases) {
      if (!key.startsWith(`${site.word}\u0000`)) continue;
      if (alias.container !== undefined) {
        if (site.of === undefined || site.of.split('.').at(-1) !== alias.container) continue;
      } else {
        const here = `${site.service}\u0000${site.file}`;
        if (!alias.files.has(here) && !importedIn.has(`${site.word}\u0000${here}`)) continue;
        // A member of something else, or a key, is not this constant.
        if (site.of !== undefined) continue;
      }
      for (const value of alias.values) note(value, site);
    }
  }

  // Services whose code was not read: a choice in a consumer there is not ruled out.
  const read = new Set(sources.services.map((service) => service.service));
  const unreadOn = (channel: unknown): string[] =>
    typeof channel !== 'string'
      ? []
      : [
          ...new Set(
            lookup
              .edgesFrom(channel, ['consumes'])
              .flatMap((edge) => lookup.node(edge.to)?.repo ?? [])
              .filter((repo) => repo !== '' && !read.has(repo)),
          ),
        ].sort(cmp);

  // The choices the graph read, by value: a selection's place.
  const chosen = new Map<string, Array<{ service: string; file: string; line: number }>>();
  for (const node of nodes.values()) {
    if (node.type !== 'consumer') continue;
    for (const selection of selectionsOf(node)) {
      const file = selection.file ?? node.file;
      if (file === undefined) continue;
      const list = chosen.get(selection.type) ?? [];
      list.push({ service: node.repo, file, line: selection.line });
      chosen.set(selection.type, list);
    }
  }
  const isChosen = (value: string, site: Found): boolean =>
    (chosen.get(value) ?? []).some(
      (at) => at.service === site.service && at.file === site.file && site.line >= at.line && site.line <= at.line + SELECTION_LINES,
    );

  for (const type of types) {
    const value = valueOf(type);
    const producers = lookup.edgesTo(type.id, ['emits']).flatMap((edge) => lookup.node(edge.from) ?? []);
    const atSend = (site: Found): boolean => producers.some((producer) => producer.repo === site.service && producer.file === site.file);
    // The name handed to a publish or a helper that publishes it (`this.emit(Events.ROW_CLAIMED, row)`), on its line.
    const isPublish = (site: Found): boolean =>
      producers.some(
        (producer) =>
          producer.repo === site.service &&
          producer.file === site.file &&
          producer.line !== undefined &&
          site.line >= producer.line &&
          site.line <= producer.line + SELECTION_LINES,
      );
    const sites = [...(byValue.get(value) ?? [])].sort((a, b) => cmp(a.service, b.service) || cmp(a.file, b.file) || a.line - b.line);
    const sent: Found[] = [];
    const open: OpenPlace[] = [];
    let defined = 0;
    let onlyAtSends = true;
    const seen = new Set<string>();
    for (const site of sites) {
      const key = `${site.service}\u0000${site.file}\u0000${site.line}\u0000${site.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (site.kind === 'write' || (site.kind === 'other' && isPublish(site))) {
        sent.push(site);
        if (!atSend(site)) onlyAtSends = false;
      } else if (site.kind === 'definition' || site.kind === 'type') defined += 1;
      else if (site.kind === 'other' && !isChosen(value, site))
        open.push({
          ...placeOf(site),
          why: `${value} is written here; the graph read no choice of it`,
        });
    }
    for (const use of wholeUses) {
      if (!containers.get(use.word)?.has(value)) continue;
      open.push({
        ...placeOf(use),
        why: `uses the whole of ${use.word}, which defines ${value}`,
      });
    }
    for (const test of first.tests) {
      if (!testMayTake(test.shape, value)) continue;
      const what =
        test.shape.kind === 'assembled' ? 'a name assembled when the code runs' : test.shape.kind === 'pattern' ? 'a pattern' : `a ${test.shape.kind} test`;
      open.push({ ...placeOf(test), why: `${what} that may take ${value}` });
    }
    // Sends first: a publish's own place before a helper's.
    const sentSorted = [...sent].sort((a, b) => Number(!atSend(a)) - Number(!atSend(b)));
    const unread = unreadOn(type.meta?.['channel']);
    const written: NameWritten = {
      sent: sentSorted.slice(0, MOST_WRITTEN).map(placeOf),
      sentCount: sent.length,
      onlyAtSends,
      defined,
      open: open.slice(0, MOST_OPEN),
      openCount: open.length,
      ...(unread.length === 0 ? {} : { unread }),
    };
    type.meta = { ...type.meta, [NAME_WRITTEN_META]: written };
  }
};
