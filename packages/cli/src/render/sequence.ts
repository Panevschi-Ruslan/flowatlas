import { sequenceOf, type Participant, type SequenceStep, type StepStatus } from '@flowatlas/linker';
import type { FlowNode } from '@flowatlas/mcp';
import { sanitiseIds } from './mermaid.js';
import { truncationLine } from './tree.js';
import type { RenderOptions } from './types.js';

/** A step as the diagram draws it: plain from a walk, marked from a diff. */
export type DrawnStep = SequenceStep & { status?: StepStatus; note?: string };

export interface DrawnSequence {
  participants: readonly Participant[];
  steps: readonly DrawnStep[];
}

export interface SequenceDiagramOptions {
  /**
   * Fold a run of unchanged steps longer than this into one note (D4),
   * keeping this many on each side of a change. Absent: nothing is folded.
   */
  context?: number;
  /** What the walk left out, said at the end so a diagram that ends early says why (I3). */
  truncated?: string;
  /** `%%` comment lines after the diagram. */
  footer?: readonly string[];
}

/** One step, or a run of unchanged steps folded into a count. */
export type FoldedItem = { step: DrawnStep } | { folded: number };

/**
 * The steps a reader is shown: every changed step with `context` unchanged
 * ones on each side, the way in and every place the walk stopped, and each
 * longer run of unchanged steps between them as one count (D4). A sequence
 * with nothing marked is shown whole.
 */
export const foldSteps = (steps: readonly DrawnStep[], context: number | undefined): FoldedItem[] => {
  const marked = (step: DrawnStep): boolean => step.status !== undefined && step.status !== 'same';
  if (context === undefined || !steps.some(marked)) return steps.map((step) => ({ step }));
  const keep = steps.map((step) => step.kind === 'enters' || step.kind === 'stop');
  steps.forEach((step, at) => {
    if (!marked(step)) return;
    for (let k = Math.max(at - context, 0); k <= Math.min(at + context, steps.length - 1); k += 1) keep[k] = true;
  });
  const items: FoldedItem[] = [];
  let run: DrawnStep[] = [];
  const flush = (): void => {
    // A run of one is shown: its count would take the same room.
    if (run.length === 1) items.push({ step: run[0] as DrawnStep });
    else if (run.length > 1) items.push({ folded: run.length });
    run = [];
  };
  steps.forEach((step, at) => {
    if (keep[at] === true) {
      flush();
      items.push({ step });
    } else run.push(step);
  });
  flush();
  return items;
};

/**
 * Text Mermaid reads as text. A sequence diagram ends a statement at `;` and
 * reads `#` as the start of an entity, so both go in as entities, as do the
 * angle brackets it would read as markup (`render/mermaid.ts` does the same
 * for a flowchart's quotes).
 */
const ENTITY: Readonly<Record<string, string>> = { '#': '#35;', ';': '#59;', '<': '#lt;', '>': '#gt;', '%': '#37;' };

export const mermaidText = (text: string): string =>
  text.replace(/[\r\n]+/g, ' ').replace(/[#;<>%]/g, (found) => ENTITY[found] ?? found);

/**
 * What a walk left out, without the advice the walk's sentence ends with: the
 * flags that would show more are the command's, and differ between `flow` and
 * `diff`.
 */
export const notWalked = (truncated: string): string => truncated.split(';')[0]?.trim() ?? truncated;

/** A light wash that reads on a light and a dark page alike. */
const WASH: Readonly<Record<Exclude<StepStatus, 'same'>, string>> = {
  added: 'rgba(46,160,67,0.18)',
  removed: 'rgba(248,81,73,0.18)',
  changed: 'rgba(210,153,34,0.18)',
};

const BOX = 'rgba(128,128,128,0.08)';

const PREFIX: Readonly<Record<StepStatus, string>> = { same: '', added: '+ ', removed: '− ', changed: '~ ' };

/** A publish and a handler taking it are asynchronous; everything else waits for an answer. */
const ASYNC: ReadonlySet<string> = new Set(['emits', 'consumes']);

/** The drawn participants in declaration order: the caller, then each service's box in the order it is first met, then the rest. */
const declarationOrder = (sequence: DrawnSequence): Participant[] => {
  const byId = new Map(sequence.participants.map((participant) => [participant.id, participant]));
  const met: string[] = [];
  for (const step of sequence.steps) for (const id of [step.from, step.to]) if (!met.includes(id)) met.push(id);
  const slots: Array<{ service?: string; members: Participant[] }> = [];
  for (const id of met) {
    const participant = byId.get(id) ?? { id, label: id, kind: 'service' as const };
    const service = participant.kind === 'caller' || participant.kind === 'channel' || participant.kind === 'external' ? undefined : participant.service;
    const slot = service === undefined ? undefined : slots.find((item) => item.service === service);
    if (slot === undefined) slots.push({ ...(service === undefined ? {} : { service }), members: [participant] });
    else slot.members.push(participant);
  }
  return slots.flatMap((slot) => slot.members);
};

/**
 * One flow as a Mermaid sequence diagram (P116).
 *
 * A participant per service (or class), a channel and an outside API each one
 * of their own, a table inside its service's box. Steps in call order and
 * numbered; a loop as `loop`, a `Promise.all` as `par`. From a diff, added
 * steps sit in a green wash with their label prefixed `+`, removed ones in a
 * red wash drawn with the cross arrow and prefixed `−`, changed ones in amber
 * with a note naming what changed; a guess says so (I4); a place the walk
 * could not see past is a note where it stopped (I3), and so is what the walk
 * left out. Unchanged runs fold to a count (`context`).
 */
export const renderSequenceDiagram = (sequence: DrawnSequence, options: SequenceDiagramOptions = {}): string => {
  const participants = declarationOrder(sequence);
  const names = sanitiseIds(participants.map((participant) => participant.id));
  const name = (id: string): string => names.get(id) ?? sanitiseIds([id]).get(id) ?? 'n_unknown';
  const lines = ['sequenceDiagram', '  autonumber'];

  let box: string | undefined;
  for (const participant of participants) {
    const service = participant.kind === 'caller' || participant.kind === 'channel' || participant.kind === 'external' ? undefined : participant.service;
    if (service !== box) {
      if (box !== undefined) lines.push('  end');
      if (service !== undefined) lines.push(`  box ${BOX} ${mermaidText(service)}`);
      box = service;
    }
    const keyword = participant.kind === 'caller' ? 'actor' : 'participant';
    lines.push(`${box === undefined ? '  ' : '    '}${keyword} ${name(participant.id)} as ${mermaidText(participant.label)}`);
  }
  if (box !== undefined) lines.push('  end');

  const first = participants[0];
  const last = participants[participants.length - 1];
  const across = first === undefined || last === undefined ? 'n_unknown' : first === last ? name(first.id) : `${name(first.id)},${name(last.id)}`;

  let depth = 1;
  const out = (line: string): void => void lines.push(`${'  '.repeat(depth)}${line}`);
  let group: SequenceStep['group'];
  let wash: StepStatus | undefined;
  const closeWash = (): void => {
    if (wash === undefined) return;
    depth -= 1;
    out('end');
    wash = undefined;
  };
  const closeGroup = (): void => {
    closeWash();
    if (group === undefined) return;
    depth -= 1;
    out('end');
    group = undefined;
  };

  for (const item of foldSteps(sequence.steps, options.context)) {
    const step = 'step' in item ? item.step : undefined;
    const next = step?.group;
    if (next?.id !== group?.id) {
      closeGroup();
      if (next !== undefined) {
        out(`${next.kind} ${mermaidText(next.label)}`);
        depth += 1;
        group = next;
      }
    } else if (next !== undefined && next.kind === 'par' && next.branch !== group?.branch) {
      closeWash();
      depth -= 1;
      out(`and ${mermaidText(next.label)}`);
      depth += 1;
      group = next;
    }
    const status = step?.status !== undefined && step.status !== 'same' ? step.status : undefined;
    if (status !== wash) {
      closeWash();
      if (status !== undefined) {
        out(`rect ${WASH[status]}`);
        depth += 1;
        wash = status;
      }
    }
    if (step === undefined) {
      out(`Note over ${across}: ${(item as { folded: number }).folded} unchanged steps`);
      continue;
    }
    const prefix = PREFIX[step.status ?? 'same'];
    if (step.kind === 'stop') {
      out(`Note over ${name(step.from)}: ${mermaidText(`${prefix}stops here: ${step.label}`)}`);
      continue;
    }
    const arrow = step.status === 'removed' ? '-x' : ASYNC.has(step.kind) ? '-)' : '->>';
    const doubt = step.confidence === 'heuristic' ? ' (best guess)' : '';
    out(`${name(step.from)}${arrow}${name(step.to)}: ${mermaidText(`${prefix}${step.label}${doubt}`)}`);
    if (step.note !== undefined) {
      const ends = step.from === step.to ? name(step.from) : `${name(step.from)},${name(step.to)}`;
      out(`Note over ${ends}: ${mermaidText(step.note)}`);
    }
  }
  closeGroup();

  if (options.truncated !== undefined) out(`Note over ${across}: ${mermaidText(`not walked: ${notWalked(options.truncated)}`)}`);
  for (const line of options.footer ?? []) lines.push(`  %% ${line.replace(/[\r\n]+/g, ' ')}`);
  return `${lines.join('\n')}\n`;
};

/**
 * A walk drawn as a sequence (`flow --format sequence`): the same steps and
 * the same diagram a diff draws, with nothing marked. The command hands the
 * graph edge behind each row and the reason the walk stops at one, which the
 * tree does not carry.
 */
export const renderSequence = (tree: FlowNode, options: RenderOptions): string => {
  const sequence = sequenceOf(tree, {
    detail: options.sequenceDetail ?? 'service',
    ...(options.siteOf === undefined ? {} : { siteOf: options.siteOf }),
    ...(options.stopOf === undefined ? {} : { stopOf: options.stopOf }),
  });
  // The flags that show more are the command's, so they are said under the
  // diagram, where the tree says them.
  const footer = [...(options.truncated === undefined ? [] : [truncationLine(options.truncated, true)]), ...(options.footer ?? [])];
  return renderSequenceDiagram(sequence, {
    ...(options.truncated === undefined ? {} : { truncated: options.truncated }),
    ...(footer.length === 0 ? {} : { footer }),
  });
};
