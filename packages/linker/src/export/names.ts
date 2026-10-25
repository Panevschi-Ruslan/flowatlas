/**
 * Names an export may write (P119). A catalogue and a DSL each accept a
 * narrower alphabet than a service, a table or a host is spelled in, so a
 * name is normalised once, kept unique within its kind, and the original is
 * kept beside it where the format has room (a Backstage `title`).
 */

/** Backstage's limit on `metadata.name`. */
export const MAX_CATALOG_NAME = 63;

/**
 * `[a-z0-9]` words separated by one of `-_.`, at most 63 characters:
 * `orders@admin` → `orders-admin`, `Sales Ledger` → `sales-ledger`.
 */
export const catalogName = (text: string): string => {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/[-_.]{2,}/g, (run) => run[0] as string)
    .replace(/^[-_.]+|[-_.]+$/g, '');
  const cut = cleaned.slice(0, MAX_CATALOG_NAME).replace(/[-_.]+$/, '');
  return cut === '' ? 'unnamed' : cut;
};

/** Words the Structurizr DSL reads as a keyword wherever a line starts with one. */
const DSL_KEYWORDS: ReadonlySet<string> = new Set(
  [
    'workspace', 'model', 'views', 'styles', 'person', 'softwaresystem', 'container', 'component', 'group', 'enterprise',
    'deploymentenvironment', 'deploymentgroup', 'deploymentnode', 'infrastructurenode', 'softwaresysteminstance', 'containerinstance',
    'element', 'relationship', 'include', 'exclude', 'autolayout', 'animation', 'title', 'description', 'technology', 'tags', 'url',
    'properties', 'perspectives', 'this', 'systemlandscape', 'systemcontext', 'dynamic', 'deployment', 'filtered', 'custom', 'image',
    'theme', 'themes', 'branding', 'terminology', 'configuration', 'users', 'docs', 'adrs', 'extends', 'instances', 'healthcheck',
  ],
);

/** A Structurizr identifier: letters, digits and `_`, never starting with a digit, never a keyword. */
export const dslIdentifier = (text: string): string => {
  const cleaned = text.replace(/[^A-Za-z0-9_]+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
  const word = cleaned === '' ? 'x' : cleaned;
  if (/^[0-9]/.test(word)) return `_${word}`;
  return DSL_KEYWORDS.has(word.toLowerCase()) ? `${word}_` : word;
};

/**
 * Hands out names unique within one book: the first to ask for a name gets
 * it, the next `-2`, then `-3` (with the separator the format allows).
 * Callers ask in a sorted order, so the same graph names everything the same.
 */
export const nameBook = (normalise: (text: string) => string, separator = '-', max = Number.POSITIVE_INFINITY): ((key: string, text: string) => string) => {
  const given = new Map<string, string>();
  const taken = new Set<string>();
  return (key, text) => {
    const held = given.get(key);
    if (held !== undefined) return held;
    const base = normalise(text);
    let name = base;
    for (let n = 2; taken.has(name); n += 1) {
      const suffix = `${separator}${n}`;
      name = `${base.slice(0, Math.max(1, max - suffix.length))}${suffix}`;
    }
    taken.add(name);
    given.set(key, name);
    return name;
  };
};
