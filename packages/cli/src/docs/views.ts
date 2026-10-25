/**
 * Each view a doc block can be drawn in (P120), as one Strategy row each.
 *
 * Every view is a renderer this tool already has, handed the subject the
 * server walked (`docSubjectOf`): the tree `flow` prints, the flowchart and the
 * sequence diagram `flow --format mermaid|sequence` draw, the prompt
 * `describe_for_prompt` answers with. Two are the docs' own: a contract table
 * of what each crossing sends and gets back, and a tour with a slot for the
 * author under every step. A view reads the graph and the walk, and writes
 * nothing anywhere (I7); the command does the one write.
 */
import { failuresOf, groupFailures, PROMPT_LIMITS, renderPrompt } from '@flowatlas/core';
import {
  positionFreeId,
  renderTour,
  sayStep,
  tourNotesOf,
  type DocBlock,
  type DocView,
  type GraphDb,
  type Participant,
  type SequenceStep,
  type TourStep,
} from '@flowatlas/linker';
import type { DocSubject, FlowNode } from '@flowatlas/mcp';
import { renderMermaid } from '../render/mermaid.js';
import { notWalked, renderSequenceDiagram } from '../render/sequence.js';
import { renderTree } from '../render/tree.js';

/** What a view writes between the markers, and what it has to say about the notes it could not place. */
export interface DrawnView {
  content: string;
  /** For a tour: the keys of notes whose step is gone, kept under "Orphaned notes". */
  orphaned?: string[];
}

type View = (db: GraphDb, block: DocBlock, subject: DocSubject) => DrawnView;

const fence = (language: string, text: string): string => `\`\`\`${language}\n${text.endsWith('\n') ? text : `${text}\n`}\`\`\`\n`;

/** What the walk left out, as a sentence about the block's own attributes rather than a command's flags. */
const notWalkedLine = (subject: DocSubject): string[] =>
  subject.truncated === undefined ? [] : [`not walked: ${notWalked(subject.truncated)} (raise max-nodes or depth on the block)`];

/** The lines a tree view ends with: what the path cannot follow, what reaches a symbol, what was cut. */
const footerOf = (subject: DocSubject): string[] => [
  ...(subject.node.type === 'channel' ? [] : [`unresolved on this path: ${subject.unresolvedOnPath}`]),
  ...(subject.node.type === 'entry' || subject.node.type === 'channel'
    ? []
    : [subject.reachedFrom.length === 0 ? 'reached from: no way in' : `reached from: ${subject.reachedFrom.map((entry) => entry.label).join(', ')}`]),
  ...notWalkedLine(subject),
];

const detailOf = (block: DocBlock): 0 | 1 | 2 => block.options.detail ?? 1;

const steps: View = (_db, block, subject) => ({
  content: fence('text', renderTree(subject.tree, { detail: detailOf(block), ascii: true, color: false, footer: footerOf(subject) })),
});

const mermaid: View = (_db, block, subject) => ({
  content: fence('mermaid', renderMermaid(subject.tree, { detail: detailOf(block), footer: footerOf(subject) })),
});

const sequence: View = (_db, _block, subject) => ({
  content: fence(
    'mermaid',
    renderSequenceDiagram(subject.sequence, {
      ...(subject.truncated === undefined ? {} : { truncated: subject.truncated }),
    }),
  ),
});

/**
 * The prompt `describe_for_prompt` answers with (P97's one renderer), its
 * headings moved two levels down so it sits under the page's own heading.
 */
const prompt: View = (_db, _block, subject) => {
  const text = subject.prompt === undefined ? '' : renderPrompt(subject.prompt, PROMPT_LIMITS);
  return { content: text.replace(/^(#{1,4}) /gm, (_whole, marks: string) => `${marks}## `) };
};

const shortType = (id: string): string => id.slice(id.lastIndexOf('#') + 1);

/** A cell of a table: pipes escaped, nothing at all said as a dash. */
const cell = (text: string | undefined): string => (text === undefined || text === '' ? '—' : text.replace(/\|/g, '\\|'));

const typesCell = (ids: readonly string[] | undefined): string =>
  cell(ids === undefined ? undefined : ids.map((id) => `\`${shortType(id)}\``).join(', '));

/** The most fields a shape lists before it counts the rest. */
const MAX_FIELDS = 12;

/** One shape as a line: its fields with their types, as the registry has them. */
const shapeLine = (db: GraphDb, id: string): string => {
  const entry = db.type(id);
  if (entry === undefined) return `- \`${shortType(id)}\`: not in the type registry`;
  const fields = (entry.fields ?? []).map((field) => `\`${field.name}${field.optional ? '?' : ''}: ${shortType(field.type)}\``);
  const members = entry.members === undefined || entry.members.length === 0 ? [] : [`one of ${entry.members.map((member) => `\`${member}\``).join(', ')}`];
  const said = [...fields.slice(0, MAX_FIELDS), ...(fields.length > MAX_FIELDS ? [`${fields.length - MAX_FIELDS} more`] : []), ...members];
  return `- \`${entry.name}\` (${entry.kind}, ${entry.declaredIn.split('#')[0]}): ${said.length === 0 ? 'no fields read' : said.join(', ')}`;
};

/** The kinds of step a contract lists: the ones that cross a boundary, and where the walk stopped (I3). */
const CONTRACT_STEPS: ReadonlySet<SequenceStep['kind']> = new Set(['enters', 'http_calls', 'hits', 'emits', 'consumes', 'triggers', 'stop']);

/**
 * Request and response shapes, failures, as a table: one row per crossing of
 * the flow with what it sends, what it gets back and what the receiving
 * handler declares it takes; then each shape's fields, and what the way in
 * can fail with.
 */
const contract: View = (db, _block, subject) => {
  const { participants } = subject.sequence;
  const name = (id: string): string => participants.find((participant: Participant) => participant.id === id)?.label ?? id;
  const rows = subject.sequence.steps.filter((step) => CONTRACT_STEPS.has(step.kind));
  const lines = ['| # | Step | Sends | Gets back | Handler takes |', '|---|---|---|---|---|'];
  rows.forEach((step, index) => {
    const what =
      step.kind === 'stop'
        ? `${name(step.from)} stops here: ${step.label}`
        : `${name(step.from)} → ${name(step.to)} \`${step.label}\`${step.confidence === 'heuristic' ? ' (best guess)' : ''}`;
    lines.push(`| ${index + 1} | ${cell(what)} | ${typesCell(step.params)} | ${typesCell(step.returns === undefined ? undefined : [step.returns])} | ${typesCell(step.takes)} |`);
  });
  if (rows.length === 0) lines.push('| — | nothing crosses a boundary on this walk | — | — | — |');
  const ids = [...new Set(rows.flatMap((step) => [...(step.params ?? []), ...(step.returns === undefined ? [] : [step.returns]), ...(step.takes ?? [])]))].sort();
  if (ids.length > 0) lines.push('', '**Shapes**', '', ...ids.map((id) => shapeLine(db, id)));
  if (subject.node.type === 'entry') {
    const fails = groupFailures(failuresOf(subject.node));
    lines.push(
      '',
      fails.length === 0
        ? '**Fails with:** no failure was read from the code on this path'
        : `**Fails with:** ${fails.map((item) => `${item.status ?? 'unknown status'} \`${item.exception}\`${item.sites > 1 ? ` (${item.sites} places)` : ''}`).join(', ')}`,
    );
  }
  lines.push(...notWalkedLine(subject).map((line) => `\n_${line}_`));
  return { content: `${lines.join('\n')}\n` };
};

/** The rows of a walk a tour stops at: every node once, in walk order, without the headings and settings. */
const tourRows = (tree: FlowNode): FlowNode[] => {
  const rows: FlowNode[] = [];
  const seen = new Set<string>();
  const visit = (row: FlowNode): void => {
    const node = row.node;
    if (node.type !== 'group' && node.type !== 'config_key' && node.ref !== true) {
      const key = positionFreeId(node);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }
    for (const child of row.children) visit(child);
  };
  visit(tree);
  return rows;
};

/**
 * A numbered walkthrough: one line per step, with the service and the place
 * it is written, and under each the author's note, kept by step key across
 * regenerations (D4).
 */
const tour: View = (_db, block, subject) => {
  const tourSteps: TourStep[] = tourRows(subject.tree).map((row) => {
    const where = [row.node.service, row.node.loc === undefined ? undefined : `\`${row.node.loc}\``].filter((part) => part !== undefined);
    return { key: positionFreeId(row.node), text: `**${row.node.label}**${where.length === 0 ? '' : ` · ${where.join(' · ')}`}` };
  });
  const trailer = notWalkedLine(subject).map((line) => `_${line}_`);
  const drawn = renderTour(tourSteps, tourNotesOf(block.content), trailer);
  return { content: drawn.text, ...(drawn.orphaned.length === 0 ? {} : { orphaned: drawn.orphaned }) };
};

export const DOC_VIEW_RENDERERS: Readonly<Record<DocView, View>> = { steps, mermaid, sequence, prompt, contract, tour };

/** A block's content in its view. */
export const renderDocView = (db: GraphDb, block: DocBlock, subject: DocSubject): DrawnView =>
  DOC_VIEW_RENDERERS[block.view ?? 'steps'](db, block, subject);

/**
 * A participant only the recorded steps name, by its id: what the graph
 * would call it, so a removed step reads as the one it was.
 */
const labelOfId = (id: string): string => {
  const table = /^table:[^/]*\/(.+)$/.exec(id);
  if (table !== null) return `${table[1]} (table)`;
  const store = /^store:[^/]*\/(.+)$/.exec(id);
  if (store !== null) return `${store[1]} (store)`;
  if (id.startsWith('channel:')) return id.slice('channel:'.length);
  if (id.startsWith('external:')) return id.slice('external:'.length);
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
};

/** A changed step said as a line: `+ orders → billing POST /invoices`. */
export const sayChange = (step: Parameters<typeof sayStep>[0], subject: DocSubject | undefined): string => {
  const participants = subject?.sequence.participants ?? [];
  const known = new Set(participants.map((participant) => participant.id));
  const missing = [step.from, step.to]
    .filter((id) => !known.has(id))
    .map((id): Participant => ({ id, label: labelOfId(id), kind: 'service' }));
  return sayStep(step, [...participants, ...missing]);
};
