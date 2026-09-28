/**
 * Why a repository could not be read, in the tool's own words.
 *
 * A repository is read in a process of its own, so what the build catches is a
 * rejection saying `Command failed: node … extract …` with the dead process's
 * standard error hanging off it. Two things used to go wrong with that, and the
 * second is the one that mattered.
 *
 * The message named what was run and nothing about what went wrong, so the
 * reason was read off the tail of the child's output. That is fine for a reader
 * whose last words were its complaint, and wrong for the one failure that ends
 * in a stack trace: a runtime that exhausts its heap prints `FATAL ERROR:
 * Ineffective mark-compacts near heap limit` and then forty frames of addresses
 * inside a dynamic library, so the tail is three of those frames and the words
 * "heap out of memory" never reach anybody. Measured, not supposed — the build
 * reported `payload-monorepo skipped (extract-failed: 104: 0x10495a0b0
 * node::NodeMainInstance::Run() …)` on a 36 GB machine, which says nothing a
 * reader can act on (R98).
 *
 * So the tail is the last resort rather than the answer. What is recognised
 * first is the shape of the death, from a table: one entry per failure this tool
 * knows how to talk about, each with the sentence it deserves — which
 * repository, which pass, and what the reader can do next. Anything
 * unrecognised keeps the old behaviour, because a reader that said something
 * sensible should be quoted rather than paraphrased.
 */

/** What the dead process left behind, as the table below reads it. */
export interface ChildDeath {
  /** `exit 134`, or `killed by SIGABRT`: how it ended, whichever fact there is. */
  how: string;
  /** Non-empty lines of its standard error, oldest first. */
  lines: readonly string[];
  /** What the rejection itself said, which is usually the command line. */
  message: string;
}

/**
 * What the build knows about the read that failed.
 *
 * Not the service's name: the summary and the report both print this beside it
 * already, and a sentence that repeated it would be read twice.
 */
export interface ReadContext {
  /** The repository directory, as the configuration points at it. */
  repo: string;
  /** The heap limit this read was given, in megabytes, when one was asked for. */
  heapMb?: number | undefined;
}

export interface ReadFailure {
  /** A word for the shape of the failure, for a test to name and a log to group by. */
  kind: 'out-of-memory' | 'unrecognised';
  /** One line, for the service's row in the report and in the summary. */
  error: string;
}

/**
 * Lines of a dead process's output that say why it died.
 *
 * Patterns rather than positions, because position is exactly what a stack trace
 * takes away. Kept short on purpose: this is not a parser for other people's
 * diagnostics, it is a list of the sentences this tool has watched get lost.
 */
const SAYS_WHY: readonly RegExp[] = [
  /\bFATAL ERROR\b/,
  /\bout of memory\b/i,
  /Allocation failed/i,
  /\bError:/,
];

const MOST = 300;

/** How much heap to suggest next: twice what did not fit. */
const nextHeap = (heapMb: number): number => heapMb * 2;

interface Shape {
  kind: ReadFailure['kind'];
  when: (death: ChildDeath) => boolean;
  say: (context: ReadContext, death: ChildDeath) => string;
}

/**
 * The failures this tool can talk about, in the order they are recognised.
 *
 * A table rather than a chain of conditions, so that adding a failure worth its
 * own sentence is adding a row. The last row matches everything.
 */
const SHAPES: readonly Shape[] = [
  {
    kind: 'out-of-memory',
    // The runtime's own words, wherever in the output they are. A process that
    // aborts with nothing to say is not counted as this: `SIGABRT` covers a
    // great deal more than a full heap, and guessing would put a sentence about
    // memory in front of somebody whose problem is not memory.
    when: (death) =>
      death.lines.some((line) => /heap out of memory|Ineffective mark-compacts/i.test(line)),
    say: (context) => {
      const asked =
        context.heapMb === undefined
          ? 'under the limit the runtime chose for this machine'
          : `under a limit of ${context.heapMb} MB`;
      const raise =
        context.heapMb === undefined
          ? '--heap <megabytes>'
          : `--heap ${nextHeap(context.heapMb)}`;
      return (
        `ran out of memory reading ${context.repo} ${asked} — the whole repository is held in` +
        ' memory while it is read, and this one did not fit.' +
        ` Raise it with \`${raise}\`, read fewer repositories at once with \`--concurrency 1\`,` +
        ' or point this service at a smaller directory.'
      );
    },
  },
  {
    kind: 'unrecognised',
    when: () => true,
    // Whatever it said, preferring the lines that look like a reason over the
    // ones that happen to be last.
    say: (_context, death) => {
      const said = death.lines.filter((line) => SAYS_WHY.some((pattern) => pattern.test(line)));
      const chosen = said.length > 0 ? said : death.lines;
      const text = chosen.slice(-3).join(' ').trim();
      return (text === '' ? `${death.how}: ${death.message}` : `${death.how}: ${text}`).slice(0, MOST);
    },
  },
];

/** What a rejected child process amounts to, before anything interprets it. */
export const deathOf = (error: unknown): ChildDeath => {
  const message = error instanceof Error ? error.message : String(error);
  const { stderr, code, signal } = error as { stderr?: unknown; code?: unknown; signal?: unknown };
  const said = typeof stderr === 'string' ? stderr : '';
  return {
    // Killed rather than failed: nothing was said because nothing got the
    // chance. The signal is then the only fact there is, and it is the one worth
    // having.
    how:
      typeof signal === 'string' && signal !== ''
        ? `killed by ${signal}`
        : `exit ${String(code ?? '?')}`,
    lines: said
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
    message,
  };
};

/** Why a repository could not be read, and what to do about it. */
export const readFailure = (error: unknown, context: ReadContext): ReadFailure => {
  const death = deathOf(error);
  const shape = SHAPES.find((candidate) => candidate.when(death)) ?? (SHAPES.at(-1) as Shape);
  return { kind: shape.kind, error: shape.say(context, death) };
};
