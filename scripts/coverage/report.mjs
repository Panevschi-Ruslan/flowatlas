/**
 * One report per target per state, written to be read as a diff.
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
import { BLIND } from './read-gate.mjs';

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
 * probe for the shape this repository writes - a wiki app's Sequelize models are
 * read a hundred and sixty-eight times and no probe counts that call - and
 * saying "nothing to find" over a number would be plainly false.
 */
const of = (found, expected) => {
  // A ratio above one is never coverage. It means the two halves are counting
  // over different files - which is what `444 of 80` was - or that the tool is
  // recording something the probe is not looking at. Either way it is said in
  // words here rather than left to a reader to notice, because the first time it
  // happened it was printed in sixteen reports and read as a rounding problem.
  if (found > expected && expected > 0) {
    return `${found} against ${expected}: **more found than the rule can see, so this is not a fraction**`;
  }
  if (expected > 0) return `${found} of ${expected}`;
  return found === 0 ? 'nothing of this kind here' : 'no denominator: the rule has no probe for it';
};

/**
 * What the denominators were counted over, in one cell.
 *
 * A service is an application together with the workspace packages it declares,
 * so the directory named in `targets.json` is not the answer to "what was
 * counted". Printing the extent is what lets a reader see that the numerator and
 * the denominator are asking about the same files, and it moves when the
 * repository's own manifests move, which is news worth a line in a diff.
 *
 * The packages are named rather than counted. There are a handful of them, a
 * disappearing one is exactly the regression this row exists to show, and a
 * number alone would hide one package being swapped for another.
 */
const extent = (truth) => {
  if (truth.extent === undefined) return 'the read directories';
  return truth.extent
    .map(({ readRoot, workspace, declared }) => {
      const where = `\`${readRoot}\``;
      if (declared.length === 0) {
        return workspace === null
          ? `${where} alone (not a member of any workspace here)`
          : `${where} alone (a member of \`${workspace}\`, declaring no package of it)`;
      }
      return `${where} plus ${declared.length} declared package(s): ${declared.map((path) => `\`${path}\``).join(', ')}`;
    })
    .join('; ');
};

const STATES = {
  fresh: 'a fresh clone, no dependencies installed - what a stranger gets',
  'with-deps': 'dependencies installed with `--ignore-scripts`',
};

/**
 * One line under the title saying what kind of reading this is (R129).
 *
 * Once, where a reader meets the run, and never per row: hundreds of
 * `type-unresolved` rows already imply this and nobody reads hundreds of rows to
 * infer a sentence. It is here rather than in the unresolved section because by
 * the time somebody has scrolled to that section they have already read four
 * tables of figures as though they were measurements.
 *
 * The wording is what R122 measured rather than what was assumed before it.
 * "Install your dependencies to see your data layer" was the honest summary
 * until R122 recovered 66-96% of the query count and 80-93% of the tables from
 * what a repository's own source states; after it, the honest summary is that
 * most of a data layer is readable either way and a named residue is not, which
 * is a smaller and more useful thing to tell somebody.
 *
 * It does not promise what an install would recover, and that is deliberate.
 * A scheduling app is 0 fresh and 0 installed on the target with the largest denominator
 * the rule has, because its client is generated by a postinstall this harness
 * does not run - so a fresh report that told its reader an install would fix it
 * would be advice that does not help them. The harness knows for certain that it
 * installs with `--ignore-scripts`, and says that much; it does not guess which
 * repositories need generated code.
 *
 * Only the fresh state gets a line. The with-deps title already says
 * `--ignore-scripts` on its face, which is the same fact in the place a reader
 * of that report meets it.
 */
const PARTIAL = {
  fresh:
    'A fresh clone is a partial read by construction: nothing a package declares\n' +
    'is resolved, so every figure below is a floor for this tool rather than a\n' +
    'measurement of it. What it still reads is what the repository’s own source\n' +
    'states. Installing would recover what a package *declares* - never what a\n' +
    'package *generates*, which `--ignore-scripts` leaves out of both states here.',
  'with-deps': '',
};

const heading = ({ target, state, version, truth, services }) => `
# ${target.name} - ${STATES[state]}

${target.why}.
${PARTIAL[state] === '' ? '' : `\n${PARTIAL[state]}`}

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
    ['extent counted over', extent(truth)],
    ['flowatlas', version],
  ],
)}
`;

/**
 * How the run ended.
 *
 * First, because on a target that crashes it is the whole result, and a
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
land on one address. An address is an address within one application: a service
that creates two of them has two address spaces, and the third row counts the
addresses that exist only because the id says which application serves them —
every one of which used to be overwritten by the first claim on it. It counts for
every reader now: a file-system router used to put the application in the *path*
instead, which kept its ids apart at the price of an address no framework serves,
and R125 made it answer the same way as everything else. That is why a repository
addressed that way reads zero here before R125 and its true number after.

${table(
  ['', 'count', 'of what the counting rule found'],
  [
    ['addresses placed', String(figures.routes.addresses), ''],
    [
      'addresses claimed by more than one declaration',
      String(figures.routes.duplicated),
      'two handlers of one application; one of them is dead code',
    ],
    [
      'addresses told apart only by their application',
      String(figures.routes.collided ?? 0),
      'each was overwritten before R119, silently and with no total moving',
    ],
    ['declarations with a body attached', String(figures.routes.withBody), of(figures.routes.withBody, expected)],
    ['…whose body reaches anything', String(figures.routes.reaching), of(figures.routes.reaching, expected)],
    ['…behind middleware or a guard', String(figures.routes.guarded), of(figures.routes.guarded, expected)],
  ],
)}
${addresses(figures.routes.shapes)}`;
};

/**
 * Where the addresses are, by their first segment.
 *
 * The smallest thing that makes a lost prefix visible. Every one of a photo server's two
 * hundred and ninety-two paths gained an `/api` and no figure in its report
 * moved, because no report printed any part of an address; printing every path
 * would swamp the diff and make each new route a changed file. A prefix
 * appearing or disappearing moves every row of this table at once, which is the
 * shape of that regression and of no other.
 */
const addresses = (shapes) => {
  if (shapes === undefined) return '';
  const rows = shapes.listed.map((row) => [`\`${row.segment}\``, String(row.addresses)]);
  const folded =
    shapes.folded.segments === 0
      ? ''
      : `\n\n${shapes.folded.addresses} more at ${shapes.folded.segments} segment(s) of fewer than five addresses each, folded together so that a repository serving two hundred addresses at the top level does not write two hundred rows.`;
  return `
Where those addresses are. One row per leading segment, which is enough of an
address for a dropped global prefix to show and little enough that a new route
is not a diff.

${rows.length === 0 ? 'No addresses.' : table(['first segment', 'addresses'], rows)}${folded}
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
 * The gate over what was not read, as a section (R111).
 *
 * Printed whether or not it found anything, because "nothing" is the result
 * worth seeing here and a section that appears only on failure is a section
 * nobody knows to expect. The list is capped: a routing convention with no
 * reader produces hundreds of identical lines, and the count plus the first
 * dozen is what a reader needs to know which reader to go and look at.
 */
const SHOWN = 12;

/**
 * The known red, by baseline entry (R124).
 *
 * The count and the ticket rather than the files: forty-five paths is a page
 * nobody reads and a diff that moves whenever somebody renames a directory,
 * while the count is the thing the gate is actually holding and the ticket is
 * where the argument about it lives. A row here appearing, disappearing or
 * changing its number is news; the paths under it are not.
 */
const knownRed = (gate) => {
  const byEntry = new Map();
  for (const row of gate.known) {
    const key = `${row.ticket}\u0000${row.family}`;
    byEntry.set(key, (byEntry.get(key) ?? 0) + 1);
  }
  if (byEntry.size === 0) return '';
  const rows = [...byEntry.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, count]) => {
      const [ticket, family] = key.split('\u0000');
      return [family, String(count), ticket];
    });
  return `
${gate.known.length} file(s) did go unread, and every one of them is red this gate
already knew about, enumerated in \`BASELINE\` in \`read-gate.mjs\` with the ticket
it belongs to. They are counted rather than silenced: one file more than this, or
one fewer, fails the run.

${table(['family', 'files', 'ticket'], rows)}
`;
};

/**
 * What this gate cannot see, printed from the gate's own list.
 *
 * The second half of R124, and the reason it is here rather than only in the
 * source: `None` above is a sentence about one assertion, and R119 obtained it
 * from a graph it had broken on purpose. A reader who is told a gate passed and
 * never told what the gate excludes will trust it past its reach - so the reach
 * is printed beside the result, every time, whatever the result was.
 */
const blindSection = (gate) => {
  if (gate.blind === undefined) return '';
  return `
### What this gate cannot see

Whatever the result above says, ${BLIND.length} kinds of failure get through this
assertion, and each was established by breaking something on purpose rather than
by argument. The list is \`BLIND\` in \`read-gate.mjs\`; this section renders it,
so that neither half of the result can travel without the other.

${BLIND.map((entry) => `**${entry.ticket} - ${entry.what}**\n\n${entry.measured}`).join('\n\n')}
`;
};

/**
 * What the gate was handed and could not put in any file (R154).
 *
 * A node, a row or an edge whose service is not one the harness configured, or
 * an edge neither end of which belongs to a service. Each is output that speaks
 * for no file, so a file it was about would be reported unread; saying how many
 * there were, and of which kind, is what keeps that from reading as a reader's
 * silence.
 */
const unplacedOutput = (gate) => {
  if (gate.unplaced === undefined || gate.unplaced.length === 0) return '';
  const byWhat = new Map();
  for (const row of gate.unplaced) byWhat.set(row.what, (byWhat.get(row.what) ?? 0) + 1);
  const counts = [...byWhat.entries()].map(([what, count]) => `${count} ${what}(s)`).join(', ');
  return `\n\n${gate.unplaced.length} output(s) of the graph could not be placed in any file of this clone - ${counts} - because no service this run configured can be named for them. They count for no file.`;
};

/**
 * What the gate set aside because a document, not source, produced it (R160).
 *
 * Said only when there was some, and never as a failure: a service declared by
 * a document has no file the counting rule can count, so its output answers for
 * none, and the report says how much was left out rather than leaving it out in
 * silence.
 */
const documentOnlyOutput = (gate) => {
  const aside = gate.documentOnly;
  if (aside === undefined || aside.services.length === 0) return '';
  return `\n\n${aside.nodes} node(s), ${aside.edges} edge(s) and ${aside.rows} row(s) of ${aside.services.length} service(s) declared only by a document (${aside.services.map((name) => `\`${name}\``).join(', ')}) were set aside: a document is not source, so they speak for no file.`;
};

const readGateSection = (result) => {
  const { gate } = result;
  if (gate === undefined) return '';
  const drift =
    gate.drift === undefined || gate.drift.length === 0
      ? ''
      : `\n\n${gate.drift
          .map(
            (row) =>
              `The baseline for \`${row.path}\` (${row.family}, ${row.ticket}) says ${row.files} file(s) and this run found ${row.found}.` +
              (row.found === 0
                ? ' It is no longer needed: delete it.'
                : ' Change the number, or find out what moved.'),
          )
          .join(' ')}`;
  const stale =
    gate.stale.length === 0
      ? ''
      : `\n\n${gate.stale.length} exemption(s) in \`read-gate.mjs\` are no longer needed and should be deleted.`;
  const unplaced = unplacedOutput(gate);
  const aside = documentOnlyOutput(gate);
  const known = gate.known === undefined ? '' : knownRed(gate);
  const blind = blindSection(gate);
  if (gate.missing.length === 0 && gate.stale.length === 0 && drift === '' && unplaced === '') {
    return `
## Files with sites and no output

None beyond what is baselined. Every other file the counting rule found a
declaration site in yielded a node of that family, or a row naming the file.${aside}
${known}${blind}`;
  }
  const rows = gate.missing
    .slice(0, SHOWN)
    .map((row) => [`\`${row.path}\``, row.family, String(row.sites)]);
  const rest =
    gate.missing.length > SHOWN
      ? `\n\nand ${gate.missing.length - SHOWN} more.`
      : '';
  return `
## Files with sites and no output

**${gate.missing.length} file(s)** the counting rule found sites in yielded neither
a node of that family nor any row naming them, and no baseline entry accounts for
them. That is a reader giving up in silence, which is the class this gate exists
for; a limit somebody has decided to accept belongs in the exemption list with a
sentence beside it, and a limit somebody has decided to live with belongs in the
baseline with a count and a ticket.

${rows.length === 0 ? '' : table(['file', 'family', 'sites'], rows)}${rest}${drift}${stale}${unplaced}${aside}
${known}${blind}`;
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
applied identically to every target and knows nothing about any of them.

${table(
  ['probe', 'what it counts', 'sites'],
  PROBES.map((probe) => [`\`${probe.name}\``, probe.what, String(truth.sites[probe.name])]),
)}

${table(
  ['family', 'sites'],
  FAMILIES.map(([family, what]) => [what, String(truth.families[family])]),
)}

Counted over the extent named at the top of this report - the read directory and
the workspace packages it declares - because that is what the tool reads. A
denominator counted over the read directory alone put more found than there was
to find, and \`extent.mjs\` says why the rule works the extent out from the
repository's manifests instead of asking the tool for it.
`;

const cost = ({ steps }) => `
## Cost

Wall clock ${seconds(steps.build.seconds)}, peak resident memory ${memory(steps.build.peakBytes)}.
Bands rather than figures, on purpose: two runs over the same commits differ by
a second and a hundred megabytes for reasons that have nothing to do with this
tool, and a line that moves then is a line nobody will read twice.
`;

/** Sections, in order. A section that has nothing to say returns an empty string. */
const SECTIONS = [
  heading,
  outcome,
  install,
  ways,
  joins,
  storage,
  unresolved,
  readGateSection,
  groundTruth,
  cost,
];

/** Sections that need a graph, and are therefore left out when there is none. */
const NEEDS_GRAPH = new Set([ways, joins, storage, unresolved]);

export const renderReport = (result) => {
  const parts = SECTIONS.filter(
    (section) => result.figures !== undefined || !NEEDS_GRAPH.has(section),
  ).map((section) => section(result));
  return `${parts.join('').trim()}\n`;
};
