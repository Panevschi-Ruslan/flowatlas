import { OVERVIEW_SECTIONS, type Crossing, type Loaded, type Overview, type OverviewSection } from './overview.js';

/**
 * The overview as Markdown (P228): one heading per section, every row with
 * where it is or the command that lists it, and a Mermaid picture of what
 * crosses between services, which every Markdown host that matters draws.
 */
export interface RenderOverviewOptions {
  sections?: readonly OverviewSection[];
  /** `#` for the page's own heading; a doc block puts it two levels down. */
  level?: number;
}

const hashes = (n: number): string => '#'.repeat(Math.max(1, Math.min(6, n)));

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Mermaid's node ids are words; a service name may not be. */
const nodeId = (name: string): string => `s_${name.replace(/[^A-Za-z0-9]/g, '_')}`;

const crossingLabel = (crossing: Crossing): string =>
  [
    crossing.requests > 0 ? plural(crossing.requests, 'request') : undefined,
    crossing.messages > 0 ? plural(crossing.messages, 'message') : undefined,
    crossing.stores > 0 ? plural(crossing.stores, 'store use') : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');

const loadRow = (row: Loaded, one: string, many: string): string =>
  `| \`${row.label}\` | ${row.service ?? '—'} | ${plural(row.count, one, many)}${row.services.length > 0 ? ` (${row.services.join(', ')})` : ''} | ${row.loc === undefined ? `\`${row.id}\`` : `\`${row.loc}\``} |`;

const cutLine = (overview: Overview, key: string, what = ''): string[] =>
  overview.cut[key] === undefined ? [] : [`and ${overview.cut[key]} more${what === '' ? '' : ` ${what}`} (raise --top)`];

export const renderOverview = (overview: Overview, options: RenderOverviewOptions = {}): string => {
  const level = options.level ?? 1;
  const asked = new Set(options.sections ?? OVERVIEW_SECTIONS);
  const h = (depth: number, text: string): string => `${hashes(level + depth)} ${text}`;
  const out: string[] = [];
  const section = (name: OverviewSection, lines: () => string[]): void => {
    if (!asked.has(name)) return;
    out.push(...lines(), '');
  };

  if (options.sections === undefined) {
    out.push(
      h(0, 'What this project is'),
      '',
      'Written by `flowatlas report` from the graph: every row is one the code holds, with where it is. Nothing here is inferred, clustered or summarised.',
      '',
    );
  }

  section('services', () => [
    h(1, 'Services'),
    '',
    '| Service | Type | Is | Ways in | Read to the end |',
    '|---|---|---|---|---|',
    ...overview.services.map((service) => {
      const ways = Object.entries(service.waysIn)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([kind, n]) => `${n} ${kind}`)
        .join(', ');
      return `| ${service.name} | ${service.type} | ${service.role} | ${ways === '' ? '—' : ways} | ${service.total === 0 ? '—' : `${service.read} of ${service.total}`}${service.skipped === undefined ? '' : ` (${service.skipped})`} |`;
    }),
  ]);

  section('crossings', () => {
    if (overview.services.length < 2) return [h(1, 'What crosses between them'), '', 'One service: nothing crosses a repository boundary.'];
    return [
      h(1, 'What crosses between them'),
      '',
      '```mermaid',
      'flowchart LR',
      ...overview.services.map((service) => `  ${nodeId(service.name)}["${service.name} (${service.role})"]`),
      ...overview.crossings.map((crossing) => `  ${nodeId(crossing.from)} ${crossing.guessed > 0 ? '-.->' : '-->'}|${crossingLabel(crossing)}| ${nodeId(crossing.to)}`),
      '```',
      '',
      '| From | To | Requests | Messages | Stores | Best guesses |',
      '|---|---|---|---|---|---|',
      ...overview.crossings.map((crossing) => `| ${crossing.from} | ${crossing.to} | ${crossing.requests} | ${crossing.messages} | ${crossing.stores} | ${crossing.guessed} |`),
      ...(overview.crossings.length === 0 ? ['', 'Nothing crosses between them that the reading joined: `flowatlas doctor` says what it could not follow.'] : []),
    ];
  });

  section('load', () => [
    h(1, 'What most of it depends on'),
    '',
    'Ranked by how many ways in reach a thing and from how many services, not by how many lines point at it.',
    '',
    '| Name | Service | Reached by | Where |',
    '|---|---|---|---|',
    ...overview.load.methods.map((row) => loadRow(row, 'way in', 'ways in')),
    ...overview.load.routes.map((row) => loadRow(row, 'caller elsewhere', 'callers elsewhere')),
    ...overview.load.channels.map((row) => loadRow(row, 'handler', 'handlers')),
    ...overview.load.tables.map((row) => loadRow(row, 'writing service', 'writing services')),
    ...['methods', 'routes', 'channels', 'tables'].flatMap((key) => cutLine(overview, key, key)),
  ]);

  section('second-look', () => [
    h(1, 'Worth a second look'),
    '',
    overview.secondLook.length === 0
      ? 'Nothing: no pair of services joined by a single thread, no store two services write, no best guess on a busy path.'
      : `A single thread between two services, a store two services write, and a best guess on the way of ${overview.weightAt} or more ways in.`,
    '',
    ...overview.secondLook.map((item) => `- **${item.kind.replace(/-/g, ' ')}**: ${item.says}${item.at.length === 0 ? '' : ` (${item.at.map((at) => `\`${at}\``).join(', ')})`}${item.confidence === undefined ? '' : `, ${item.confidence}`}`),
    ...cutLine(overview, 'secondLook'),
  ]);

  section('not-read', () => [
    h(1, 'What was not read'),
    '',
    overview.notRead.causes.length === 0
      ? 'Nothing the reading missed.'
      : `${plural(overview.notRead.sites, 'place')} the reading could not follow, by cause. \`flowatlas doctor --unresolved\` lists every one.`,
    '',
    ...overview.notRead.causes.map((cause) => `- **${cause.cause}**, ${plural(cause.sites, 'place')} in ${cause.services.join(', ')}: ${cause.hint}`),
  ]);

  section('checks', () => [
    h(1, 'Checks'),
    '',
    '| Check | Count | Lists them |',
    '|---|---|---|',
    ...overview.checks.map((check) => `| ${check.name} | ${check.count} | \`${check.command}\` |`),
  ]);

  section('run-time', () =>
    overview.runTime === undefined
      ? [h(1, 'At run time'), '', 'Nothing observed: `flowatlas observe` lays real traffic over the map.']
      : [h(1, 'At run time'), '', '| Check | Count | Lists them |', '|---|---|---|', ...overview.runTime.map((check) => `| ${check.name} | ${check.count} | \`${check.command}\` |`)],
  );

  section('questions', () => [
    h(1, 'Questions to ask next'),
    '',
    ...overview.questions.flatMap((question) => [`- ${question.ask}`, `  \`${question.command}\` · \`${question.tool}\``]),
  ]);

  return `${out.join('\n').trimEnd()}\n`;
};
