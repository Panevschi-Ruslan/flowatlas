/**
 * One node of the graph, written as Markdown an assistant can act on.
 *
 * Pure: it takes the facts already gathered and returns text, so the MCP tool
 * and a page with a "copy as prompt" button render the same words from the same
 * data. Nothing here reads a database or a file, and no source code is ever
 * written into the text: it names where to look and which ids to ask for.
 */

/** One step of the chain, in the order a walk reaches it. */
export interface PromptStep {
  /** Hops from the subject; 1 is a direct step. */
  depth: number;
  id: string;
  label: string;
  type: string;
  kind?: string;
  service?: string;
  /** Repo-relative `file:line`. */
  loc?: string;
  /** The edge that reached it: its type and how sure the join is. */
  via?: { type: string; confidence: string; because?: string[] };
  params?: string[];
  returns?: string;
  /** Already on the path: a cycle, shown once and not followed. */
  repeat?: boolean;
}

/** Something on the chain the reading could not follow, and why. */
export interface PromptGap {
  reason: string;
  message: string;
  service?: string;
  loc?: string;
  hint?: string;
  /** The node the gap is recorded against, when it is one. */
  id?: string;
}

export interface PromptSubject {
  id: string;
  label: string;
  type: string;
  kind?: string;
  service?: string;
  loc?: string;
  steps: PromptStep[];
  /** Steps the walk reached and the text left out. */
  stepsCut: number;
  /** What publishes onto it, for a channel. */
  producers?: PromptStep[];
  /** The ways in that reach it, for something that is not one itself. */
  reachedFrom?: PromptStep[];
  gaps: PromptGap[];
  /** Calls that take the ids above, as an assistant would write them. */
  askNext: string[];
}

export interface PromptLimits {
  /** Most chain steps written. */
  maxSteps: number;
  /** Most gaps written. */
  maxGaps: number;
  /** The ceiling on the whole text, in characters. */
  maxChars: number;
}

export const PROMPT_LIMITS: PromptLimits = { maxSteps: 40, maxGaps: 10, maxChars: 8000 };

const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``;

const where = (step: { service?: string; loc?: string }): string =>
  [step.service, step.loc === undefined ? undefined : code(step.loc)].filter(Boolean).join(' ');

const shapeOf = (step: PromptStep): string => {
  const parts: string[] = [];
  if (step.params !== undefined && step.params.length > 0) parts.push(`takes ${step.params.map(code).join(', ')}`);
  if (step.returns !== undefined) parts.push(`returns ${code(step.returns)}`);
  return parts.join('; ');
};

const viaOf = (step: PromptStep): string => {
  if (step.via === undefined) return '';
  const because = step.via.because === undefined ? '' : `, because ${step.via.because.join('; ')}`;
  return `${step.via.type} (${step.via.confidence}${because})`;
};

/** One line of the chain: what it is, where it lives, how it was reached. */
const stepLine = (step: PromptStep): string => {
  const indent = '  '.repeat(Math.max(step.depth - 1, 0));
  if (step.repeat === true) return `${indent}- ${code(step.id)} again (a cycle; not followed)`;
  const facts = [where(step), viaOf(step), shapeOf(step)].filter((part) => part.length > 0);
  return `${indent}- **${step.label}** ${code(step.id)}${facts.length === 0 ? '' : ` — ${facts.join(' — ')}`}`;
};

const gapLine = (gap: PromptGap): string => {
  const place = where(gap);
  const hint = gap.hint === undefined ? '' : ` Hint: ${gap.hint}`;
  return `- ${code(gap.reason)}${place.length === 0 ? '' : ` at ${place}`}: ${gap.message}.${hint}`.replace(/\.\./g, '.');
};

/** First edge on the chain that says what it carries, read as the subject's shapes. */
const shapesOf = (steps: readonly PromptStep[]): { in: string[]; out?: string } => {
  const first = steps.find((step) => (step.params?.length ?? 0) > 0 || step.returns !== undefined);
  return first === undefined
    ? { in: [] }
    : { in: first.params ?? [], ...(first.returns === undefined ? {} : { out: first.returns }) };
};

const section = (title: string, lines: readonly string[]): string[] =>
  lines.length === 0 ? [] : ['', `## ${title}`, '', ...lines];

/**
 * The Markdown for one subject, bounded.
 *
 * Bounded twice: by count (steps, gaps) and by length, cutting whole lines and
 * saying so, so the text never ends mid-sentence and never fills a window.
 */
export const describeForPrompt = (subject: PromptSubject, limits: PromptLimits = PROMPT_LIMITS): string => {
  const title = [subject.type, subject.kind].filter(Boolean).join(' / ');
  const head = [
    `# ${subject.label}`,
    '',
    `${code(subject.id)} — ${title}${subject.service === undefined ? '' : ` in ${subject.service}`}${subject.loc === undefined ? '' : ` at ${code(subject.loc)}`}`,
  ];

  const steps = subject.steps.slice(0, limits.maxSteps);
  const cut = subject.stepsCut + subject.steps.length - steps.length;
  const chain = steps.map(stepLine);
  if (cut > 0) chain.push(`- … ${cut} more step(s) not shown; ask get_flow with a higher maxNodes`);

  const shapes = shapesOf(subject.steps);
  const shapeLines = [
    ...(shapes.in.length === 0 ? [] : [`- in: ${shapes.in.map(code).join(', ')}`]),
    ...(shapes.out === undefined ? [] : [`- out: ${code(shapes.out)}`]),
  ];

  const gaps = subject.gaps.slice(0, limits.maxGaps).map(gapLine);
  if (subject.gaps.length > limits.maxGaps) gaps.push(`- … ${subject.gaps.length - limits.maxGaps} more gap(s)`);

  const body = [
    ...head,
    ...section('Published by', (subject.producers ?? []).map(stepLine)),
    ...section('Reached from', (subject.reachedFrom ?? []).map(stepLine)),
    ...section('Chain', chain.length === 0 ? ['- nothing further is recorded from here'] : chain),
    ...section('Shapes', shapeLines),
    ...section('Gaps', gaps.length === 0 ? ['- none recorded on this chain'] : gaps),
    ...section('Ask next', subject.askNext.map((call) => `- ${code(call)}`)),
  ];
  return fit(body, limits.maxChars);
};

/** Whole lines up to the ceiling, then one saying how many were dropped. */
const fit = (lines: readonly string[], maxChars: number): string => {
  const kept: string[] = [];
  let used = 0;
  for (const [index, line] of lines.entries()) {
    if (used + line.length + 1 > maxChars - 80) {
      kept.push('', `… ${lines.length - index} more line(s) cut to stay under ${maxChars} characters`);
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return `${kept.join('\n')}\n`;
};
