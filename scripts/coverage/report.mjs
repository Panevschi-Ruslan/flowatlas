/**
 * One committed report per target per state, written to be read as a diff.
 *
 * Everything here answers one question: if somebody improves a reader and runs
 * this again, which lines move? Lines that move for reasons other than coverage
 * are either left out or deliberately blunted.
 *
 *  - No timestamp, and no node or edge totals. Both change on every run or
 *    every release and would make each report a diff with no news in it.
 *  - Rows are ordered by name, never by size, so one row growing does not
 *    reorder the table and mark every line as changed.
 *  - Wall clock and peak memory are printed as bands, not as figures. They were
 *    rounded at first, to five seconds and sixty-four megabytes, and that was
 *    not coarse enough: two consecutive runs over the same eight commits
 *    produced identical coverage everywhere and still moved two lines, one
 *    because a build shared the machine with something else and one because a
 *    reader peaked a hundred and twenty megabytes higher. A band moves when
 *    something real did. The figures worth having here are "seconds or minutes"
 *    and "one gigabyte or four", and a band says exactly that much.
 */
import { FAMILIES, PROBES } from './counting-rule.mjs';

const GIB = 1024 ** 3;

/** A table of upper bounds and what to call everything below each one. */
const bandOf = (bands, value, above) =>
  bands.find(([limit]) => value < limit)?.[1] ?? above;

const SECONDS = [
  [5, 'under 5 s'],
  [15, '5 to 15 s'],
  [60, '15 to 60 s'],
  [300, '1 to 5 min'],
];

const BYTES = [
  [0.5 * GIB, 'under 0.5 GB'],
  [1 * GIB, '0.5 to 1 GB'],
  [2 * GIB, '1 to 2 GB'],
  [3 * GIB, '2 to 3 GB'],
  [4 * GIB, '3 to 4 GB'],
];

const seconds = (value) => bandOf(SECONDS, value, 'over 5 min');

const memory = (bytes) =>
  bytes === null ? 'not measured on this platform' : bandOf(BYTES, bytes, 'over 4 GB');

const table = (head, rows) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

/**
 * `a of b`, and something honest where there is no denominator.
 *
 * A denominator of zero is two different sentences depending on what the tool
 * found. Nothing on either side means there was nothing of that kind here. A
 * figure from the tool against nothing from the rule means the rule has no
 * probe for the shape this repository writes - outline's Sequelize models are
 * read a hundred and sixty-eight times and no probe counts that call - and
 * saying "nothing to find" over a number would be plainly false.
 */
const of = (found, expected) => {
  if (expected > 0) return `${found} of ${expected}`;
  return found === 0 ? 'nothing of this kind here' : 'no denominator: the rule has no probe for it';
};

const STATES = {
  fresh: 'a fresh clone, no dependencies installed - what a stranger gets',
  'with-deps': 'dependencies installed with `--ignore-scripts`',
};

const heading = ({ target, state, version, truth, services }) => `
# ${target.name} - ${STATES[state]}

${target.why}.

${table(
  ['', ''],
  [
    ['repository', `\`${target.repository}\``],
    ['commit', `\`${target.commit}\``],
    ['read', target.read.map((path) => `\`${path}\``).join(', ')],
    [
      'read by',
      services.length === 0
        ? 'nothing linked'
        : services
            .map(
              (s) =>
                `${s.name} (\`${s.type}\`${s.guessed === s.type ? '' : `, set; \`link\` guessed \`${s.guessed}\``})`,
            )
            .join(', '),
    ],
    ['source files counted', String(truth.files)],
    ['flowatlas', version],
  ],
)}
`;

/**
 * How the run ended.
 *
 * First, because on two of the eight targets it is the whole result, and a
 * report that buried a crash under four tables of zeroes would be telling the
 * reader the opposite of what happened.
 */
const outcome = ({ steps }) => {
  const died = steps.build.code !== 0;
  const line = `build **exit ${steps.build.code}**${steps.build.signal ? ` (${steps.build.signal})` : ''}, doctor exit ${steps.doctor.code}, link exit ${steps.link.code}`;
  const said =
    steps.build.message === null || steps.build.message === ''
      ? ''
      : `\n\nWhat it said:\n\n\`\`\`\n${steps.build.message}\n\`\`\``;
  // The peak is repeated here when the build failed, because on a heap
  // exhaustion it is the evidence: the words "heap out of memory" are printed
  // by the reader's own process and the build repeats only the last few frames
  // of its stack, so four gigabytes beside a failure says what the message
  // does not.
  const peak = died ? `\n\nIt reached ${memory(steps.build.peakBytes)} before it stopped.` : '';
  return `
## Outcome

${died ? `**The tool did not finish.** ${line}` : line}${said}${peak}
`;
};

const install = ({ installs }) =>
  installs.length === 0
    ? ''
    : `
## Dependencies

${table(
  ['where', 'manager', 'exit', 'note'],
  installs.map((row) => [
    `\`${row.where}\``,
    row.manager,
    String(row.code),
    row.note === null ? 'installed' : `\`${row.note.split('\n').slice(-1)[0]}\``,
  ]),
)}
`;

const ways = ({ figures, truth }) => {
  const kinds = Object.entries(figures.routes.byKind).sort(([a], [b]) => (a < b ? -1 : 1));
  const expected = truth.families.routes;
  return `
## Ways in

${table(
  ['kind', 'entry points'],
  kinds.length === 0 ? [['none', '0']] : kinds.map(([kind, count]) => [kind, String(count)]),
)}

HTTP routes. The first row counts addresses and is not coverage; the rest count
handlers, which is what the counting rule counts, because two declarations may
land on one address.

${table(
  ['', 'count', 'of what the counting rule found'],
  [
    ['addresses placed', String(figures.routes.addresses), ''],
    ['declarations with a body attached', String(figures.routes.withBody), of(figures.routes.withBody, expected)],
    ['…whose body reaches anything', String(figures.routes.reaching), of(figures.routes.reaching, expected)],
    ['…behind middleware or a guard', String(figures.routes.guarded), of(figures.routes.guarded, expected)],
  ],
)}
`;
};

const joins = ({ figures }) => `
## What joined

${table(
  ['', 'found', 'joined'],
  [
    ['requests from a browser', String(figures.requests.browser.found), String(figures.requests.browser.joined)],
    ['requests between services', String(figures.requests.service.found), String(figures.requests.service.joined)],
    ['channels', String(figures.channels.found), `${figures.channels.bothEnds} with both ends`],
  ],
)}
`;

const storage = ({ figures, truth }) => `
## Storage and screens

${table(
  ['', 'count', 'of what the counting rule found'],
  [
    ['query sites read', String(figures.data.queries), of(figures.data.queries, truth.families.data)],
    ['…that name a table', String(figures.data.named), of(figures.data.named, figures.data.queries)],
    ['tables', String(figures.data.tables), of(figures.data.tables, truth.families.models)],
    ['components', String(figures.screens.components), of(figures.screens.components, truth.families.screens)],
    ['clicks', String(figures.screens.clicks), of(figures.screens.clicks, truth.families.clicks)],
    ['every other binding a template makes', String(figures.screens.actions - figures.screens.clicks), 'not counted by the rule'],
  ],
)}
`;

const unresolved = ({ figures }) => {
  const section = figures.unresolved;
  if (section === undefined) return '\n## What it could not read\n\nNo doctor report was written.\n';
  const rows = section.byReason.map((group) => [
    group.reason,
    group.level,
    String(group.sites),
    group.known ? '' : 'no advice in the catalogue',
  ]);
  return `
## What it could not read

${section.total} places somebody could act on, ${section.info.sites} the tool
reports as a limit of static reading, and ${section.nothing.sites} where there
was never an edge to draw. The three are never added together.

${rows.length === 0 ? 'Nothing.' : table(['reason', 'level', 'places', ''], rows)}
`;
};

/**
 * The ground truth, probe by probe, so a suspicious figure can be checked.
 *
 * Printed in full even where every probe found nothing: a row of zeroes is the
 * report saying this repository declares no NestJS routes, which is a fact
 * about the repository rather than a gap in the measurement.
 */
const groundTruth = ({ truth }) => `
## The denominators

Counted by the one rule in \`scripts/coverage/counting-rule.mjs\`, which is
applied identically to all eight targets and knows nothing about any of them.

${table(
  ['probe', 'what it counts', 'sites'],
  PROBES.map((probe) => [`\`${probe.name}\``, probe.what, String(truth.sites[probe.name])]),
)}

${table(
  ['family', 'sites'],
  FAMILIES.map(([family, what]) => [what, String(truth.families[family])]),
)}
`;

const cost = ({ steps }) => `
## Cost

Wall clock ${seconds(steps.build.seconds)}, peak resident memory ${memory(steps.build.peakBytes)}.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
`;

/** Sections, in order. A section that has nothing to say returns an empty string. */
const SECTIONS = [heading, outcome, install, ways, joins, storage, unresolved, groundTruth, cost];

/** Sections that need a graph, and are therefore left out when there is none. */
const NEEDS_GRAPH = new Set([ways, joins, storage, unresolved]);

export const renderReport = (result) => {
  const parts = SECTIONS.filter(
    (section) => result.figures !== undefined || !NEEDS_GRAPH.has(section),
  ).map((section) => section(result));
  return `${parts.join('').trim()}\n`;
};
