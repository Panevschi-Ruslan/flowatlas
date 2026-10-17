/**
 * What an export must be to be read by the tool it is for (P119), checked
 * without that tool: Backstage's entity rules (the `Entity` envelope and the
 * Component, API, Resource and Location kinds' `spec`, names, references and
 * annotation keys, as Backstage's published JSON schemas state them) and the
 * statements of the Structurizr DSL this export writes (every identifier
 * defined once before it is used, every dynamic step on a relationship of
 * the model, quotes escaped, braces balanced).
 *
 * Neither Backstage nor the Structurizr CLI is a dependency (a Java tool and
 * a Node backend, both far heavier than the files they would check), so the
 * tests and the snapshot scripts hold every written file to these instead.
 */

/** `metadata.name`: `[A-Za-z0-9]` words joined by one of `-_.`, 1 to 63 characters. */
const NAME = /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/;
/** An annotation key: an optional DNS-subdomain prefix and `/`, then a name of up to 63 characters. */
const ANNOTATION_KEY = /^(?:[a-z0-9]([-a-z0-9]*[a-z0-9])?(?:\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/)?[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;
/** An entity reference: `[kind:][namespace/]name`. */
const REF = /^(?:[A-Za-z][A-Za-z0-9]*:)?(?:[a-z0-9]([-a-z0-9]*[a-z0-9])?\/)?([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/;

const SPEC_KEYS: Record<string, { required: string[]; optional: string[]; refs: string[]; kindedRefs: string[] }> = {
  Component: {
    required: ['type', 'lifecycle', 'owner'],
    optional: ['system', 'subcomponentOf', 'providesApis', 'consumesApis', 'dependsOn', 'dependencyOf'],
    refs: ['providesApis', 'consumesApis'],
    kindedRefs: ['dependsOn', 'dependencyOf'],
  },
  API: { required: ['type', 'lifecycle', 'owner', 'definition'], optional: ['system'], refs: [], kindedRefs: [] },
  Resource: { required: ['type', 'owner'], optional: ['system', 'dependsOn', 'dependencyOf'], refs: [], kindedRefs: ['dependsOn', 'dependencyOf'] },
  Location: { required: [], optional: ['type', 'target', 'targets', 'presence'], refs: [], kindedRefs: [] },
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Every way one entity breaks Backstage's rules; empty when it holds to them. */
export const catalogEntityProblems = (entity: unknown): string[] => {
  if (!isRecord(entity)) return ['an entity is a mapping'];
  const problems: string[] = [];
  const where = isRecord(entity['metadata']) && typeof entity['metadata']['name'] === 'string' ? `${String(entity['kind'])} ${entity['metadata']['name']}` : String(entity['kind']);
  const say = (text: string): void => {
    problems.push(`${where}: ${text}`);
  };
  if (entity['apiVersion'] !== 'backstage.io/v1alpha1') say(`apiVersion ${JSON.stringify(entity['apiVersion'])} is not backstage.io/v1alpha1`);
  const kind = typeof entity['kind'] === 'string' ? entity['kind'] : '';
  const rules = SPEC_KEYS[kind];
  if (rules === undefined) say(`kind ${JSON.stringify(entity['kind'])} is not one this export writes`);
  for (const key of Object.keys(entity)) if (!['apiVersion', 'kind', 'metadata', 'spec', 'relations', 'status'].includes(key)) say(`unknown top-level key ${key}`);
  const metadata = entity['metadata'];
  if (!isRecord(metadata)) say('metadata is missing');
  else {
    const name = metadata['name'];
    if (typeof name !== 'string' || name.length > 63 || !NAME.test(name)) say(`metadata.name ${JSON.stringify(name)} is not a valid name`);
    for (const key of ['title', 'description', 'namespace']) if (metadata[key] !== undefined && !isText(metadata[key])) say(`metadata.${key} is not a string`);
    const annotations = metadata['annotations'];
    if (annotations !== undefined) {
      if (!isRecord(annotations)) say('metadata.annotations is not a mapping');
      else
        for (const [key, value] of Object.entries(annotations)) {
          if (!ANNOTATION_KEY.test(key)) say(`annotation key ${JSON.stringify(key)} is not valid`);
          if (typeof value !== 'string') say(`annotation ${key} is not a string`);
        }
    }
  }
  const spec = entity['spec'];
  if (!isRecord(spec)) say('spec is missing');
  else if (rules !== undefined) {
    for (const key of rules.required) if (!isText(spec[key]) && !(key === 'definition' && isRecord(spec[key]) && isText((spec[key] as Record<string, unknown>)['$text']))) say(`spec.${key} is required`);
    for (const key of Object.keys(spec)) if (!rules.required.includes(key) && !rules.optional.includes(key)) say(`spec.${key} is not a field of ${kind}`);
    for (const key of [...rules.refs, ...rules.kindedRefs]) {
      const value = spec[key];
      if (value === undefined) continue;
      if (!Array.isArray(value)) {
        say(`spec.${key} is not a list`);
        continue;
      }
      for (const ref of value) {
        if (typeof ref !== 'string' || !REF.test(ref)) say(`spec.${key} holds ${JSON.stringify(ref)}, not an entity reference`);
        else if (rules.kindedRefs.includes(key) && !ref.includes(':')) say(`spec.${key} holds ${ref} without a kind`);
      }
    }
    for (const key of ['owner', 'system']) if (typeof spec[key] === 'string' && !REF.test(spec[key] as string)) say(`spec.${key} ${JSON.stringify(spec[key])} is not an entity reference`);
    if (kind === 'Location') {
      const targets = spec['targets'];
      if (spec['target'] === undefined && targets === undefined) say('spec.target or spec.targets is required');
      if (targets !== undefined && (!Array.isArray(targets) || targets.some((target) => !isText(target)))) say('spec.targets is not a list of strings');
    }
  }
  return problems;
};

/** Every entity of a catalogue, and the references between them: two entities of one kind and name, or a reference to an entity the export does not hold where it should. */
export const catalogProblems = (entities: readonly unknown[]): string[] => {
  const problems = entities.flatMap(catalogEntityProblems);
  const seen = new Set<string>();
  for (const entity of entities) {
    if (!isRecord(entity) || !isRecord(entity['metadata'])) continue;
    const key = `${String(entity['kind']).toLowerCase()}:${String(entity['metadata']['name']).toLowerCase()}`;
    if (seen.has(key)) problems.push(`${key} is written twice`);
    seen.add(key);
  }
  return problems;
};

/* ── Structurizr DSL ── */

/** The words of one line: bare words and quoted strings (unquoted), or why the line cannot be split. */
const wordsOf = (line: string): { words: string[]; quoted: boolean[] } | string => {
  const words: string[] = [];
  const quoted: boolean[] = [];
  let at = 0;
  while (at < line.length) {
    const char = line[at] as string;
    if (char === ' ') {
      at += 1;
      continue;
    }
    if (char === '"') {
      let text = '';
      at += 1;
      let closed = false;
      while (at < line.length) {
        const next = line[at] as string;
        if (next === '\\') {
          const escaped = line[at + 1];
          if (escaped !== '"' && escaped !== '\\') return `a backslash before ${JSON.stringify(escaped ?? '')} escapes nothing`;
          text += escaped;
          at += 2;
          continue;
        }
        if (next === '"') {
          closed = true;
          at += 1;
          break;
        }
        text += next;
        at += 1;
      }
      if (!closed) return 'a quoted string is not closed';
      if (at < line.length && line[at] !== ' ') return 'a quoted string runs into the next word';
      words.push(text);
      quoted.push(true);
      continue;
    }
    let word = '';
    while (at < line.length && line[at] !== ' ') {
      if (line[at] === '"') return 'a quote inside a bare word';
      word += line[at];
      at += 1;
    }
    words.push(word);
    quoted.push(false);
  }
  return { words, quoted };
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ELEMENT_KINDS = new Set(['person', 'softwareSystem', 'container']);
const SHAPES = new Set(['Box', 'RoundedBox', 'Circle', 'Ellipse', 'Hexagon', 'Cylinder', 'Pipe', 'Person', 'Robot', 'Folder', 'WebBrowser', 'Component']);

/**
 * Every way a workspace breaks the statements this export writes; empty when
 * it holds to them. A line it does not know is a problem, so a renderer that
 * starts writing a new statement has to teach this check first.
 */
export const dslProblems = (text: string): string[] => {
  const problems: string[] = [];
  const defined = new Map<string, string>();
  const relationships = new Set<string>();
  const keys = new Set<string>();
  const stack: string[] = [];
  const lines = text.split('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const say = (problem: string): void => {
      problems.push(`line ${index + 1}: ${problem}: ${line}`);
    };
    if (line === '' || line.startsWith('//')) return;
    if (line === '}') {
      if (stack.pop() === undefined) say('a brace closes nothing');
      return;
    }
    const split = wordsOf(line);
    if (typeof split === 'string') {
      say(split);
      return;
    }
    const { words, quoted } = split;
    const opens = words[words.length - 1] === '{' && !quoted[quoted.length - 1];
    const body = opens ? words.slice(0, -1) : words;
    const inside = stack[stack.length - 1];
    const head = body[0] ?? '';
    if (body[1] === '=' && !quoted[0]) {
      if (!IDENTIFIER.test(head)) say('not an identifier');
      if (defined.has(head)) say(`${head} is defined twice`);
      const kind = body[2] ?? '';
      if (!ELEMENT_KINDS.has(kind)) say(`${kind} is not an element this export writes`);
      if (body.slice(3).some((_, at) => !quoted[at + 3])) say('every argument of an element is quoted');
      if (body.length < 4) say('an element has a name');
      if (kind === 'container' && inside !== 'softwareSystem') say('a container is inside a software system');
      if (kind !== 'container' && inside !== 'model') say(`${kind} is inside the model`);
      defined.set(head, kind);
      if (opens) stack.push(kind);
      return;
    }
    if (body[1] === '->' && !quoted[0]) {
      const to = body[2] ?? '';
      for (const id of [head, to]) if (!defined.has(id)) say(`${id} is not defined above`);
      if (body.slice(3).some((_, at) => !quoted[at + 3]) || body.length < 4) say('a relationship says what crosses it, quoted');
      if (inside === 'model') relationships.add(`${head}>${to}`);
      else if (inside === 'dynamic') {
        if (!relationships.has(`${head}>${to}`)) say(`no relationship of the model from ${head} to ${to}`);
      } else say('a relationship is in the model or a dynamic view');
      if (opens) say('a relationship opens no block');
      return;
    }
    switch (head) {
      case 'workspace':
        if (stack.length > 0 || !opens || body.slice(1).some((_, at) => !quoted[at + 1])) say('workspace "name" "description" {');
        stack.push('workspace');
        return;
      case 'model':
      case 'views':
        if (inside !== 'workspace' || !opens || body.length !== 1) say(`${head} { inside the workspace`);
        stack.push(head);
        return;
      case 'styles':
        if (inside !== 'views' || !opens || body.length !== 1) say('styles { inside the views');
        stack.push('styles');
        return;
      case 'container':
      case 'dynamic': {
        if (inside !== 'views' || !opens) say(`${head} view inside the views, opening a block`);
        const scope = body[1] ?? '';
        if (defined.get(scope) !== 'softwareSystem') say(`${scope} is not a software system`);
        const key = body[2];
        if (key === undefined || !quoted[2]) say('a view has a quoted key');
        else if (keys.has(key)) say(`view key ${key} is used twice`);
        else keys.add(key);
        stack.push(head);
        return;
      }
      case 'include':
        if (inside !== 'container' || body[1] !== '*') say('include * inside a container view');
        return;
      case 'autolayout':
        if ((inside !== 'container' && inside !== 'dynamic') || !['lr', 'tb', 'rl', 'bt'].includes(body[1] ?? '')) say('autolayout <direction> inside a view');
        return;
      case 'element':
        if (inside !== 'styles' || !opens || !quoted[1]) say('element "tag" { inside the styles');
        stack.push('element');
        return;
      case 'shape':
        if (inside !== 'element' || !SHAPES.has(body[1] ?? '')) say('shape <one of the shapes> inside an element style');
        return;
      default:
        say('not a statement this export writes');
    }
  });
  if (stack.length > 0) problems.push(`${stack.length} block(s) not closed: ${stack.join(', ')}`);
  return problems;
};
