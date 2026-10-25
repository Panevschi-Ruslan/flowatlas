/**
 * The part of Mermaid's sequence-diagram grammar `renderSequenceDiagram` writes,
 * checked line by line (P116).
 *
 * Mermaid is not a dependency, so the diagrams are not parsed by Mermaid
 * itself; this holds every line to the statements the renderer is meant to
 * write - declarations, the boxes they sit in, messages, notes, and the
 * blocks around them - and to what each statement's text may hold: no `;`,
 * which ends a statement, and no `#` that does not start an entity. A
 * diagram the renderer writes and this refuses is a bug in one of the two.
 * Read by the tests, over hand-built flows and over every diagram in the
 * recorded snapshots; never by the command.
 */

const ID = '[A-Za-z_][A-Za-z0-9_]*';
const COLOR = 'rgba?\\(\\d+,\\d+,\\d+(?:,[0-9.]+)?\\)';

/** Text a statement may end with: anything but a `;`, or a `#` that starts no entity. */
const textProblem = (text: string): string | undefined => {
  const bare = text.replace(/#\w+;/g, '');
  if (bare.includes(';')) return 'a ";" ends the statement';
  if (bare.includes('#')) return 'a "#" that starts no entity';
  if (text.trim() === '') return 'no text';
  return undefined;
};

/** The problems with a diagram, each with its line; empty when it is one this grammar reads. */
export const sequenceProblems = (diagram: string): string[] => {
  const problems: string[] = [];
  const declared = new Set<string>();
  const blocks: string[] = [];
  let started = false;
  let messages = false;
  const lines = diagram.split('\n').map((line) => line.trim());
  if (lines[0] !== 'sequenceDiagram') problems.push('1: does not start with sequenceDiagram');
  const use = (id: string, at: number): void => {
    if (!declared.has(id)) problems.push(`${at}: ${id} is used before it is declared`);
  };
  const text = (value: string, at: number): void => {
    const problem = textProblem(value);
    if (problem !== undefined) problems.push(`${at}: ${problem}`);
  };
  lines.forEach((line, index) => {
    const at = index + 1;
    if (index === 0 || line === '' || line.startsWith('%%')) return;
    if (line === 'autonumber') {
      if (started) problems.push(`${at}: autonumber after the first statement`);
      return;
    }
    started = true;
    let match: RegExpExecArray | null;
    if ((match = new RegExp(`^box ${COLOR} (.+)$`).exec(line)) !== null) {
      if (messages || blocks.length > 0) problems.push(`${at}: a box after the first message or inside a block`);
      blocks.push('box');
      text(match[1] as string, at);
    } else if ((match = new RegExp(`^(?:actor|participant) (${ID}) as (.+)$`).exec(line)) !== null) {
      if (messages) problems.push(`${at}: a participant declared after the first message`);
      if (declared.has(match[1] as string)) problems.push(`${at}: ${match[1]} declared twice`);
      declared.add(match[1] as string);
      text(match[2] as string, at);
    } else if ((match = new RegExp(`^(${ID})(->>|-\\)|-x)(${ID}): (.*)$`).exec(line)) !== null) {
      messages = true;
      use(match[1] as string, at);
      use(match[3] as string, at);
      text(match[4] as string, at);
    } else if ((match = new RegExp(`^Note over (${ID})(?:,(${ID}))?: (.*)$`).exec(line)) !== null) {
      messages = true;
      use(match[1] as string, at);
      if (match[2] !== undefined) use(match[2], at);
      text(match[3] as string, at);
    } else if ((match = new RegExp(`^rect ${COLOR}$`).exec(line)) !== null) {
      blocks.push('rect');
    } else if ((match = /^(loop|par) (.+)$/.exec(line)) !== null) {
      blocks.push(match[1] as string);
      text(match[2] as string, at);
    } else if ((match = /^and (.+)$/.exec(line)) !== null) {
      if (blocks[blocks.length - 1] !== 'par') problems.push(`${at}: "and" outside a par`);
      text(match[1] as string, at);
    } else if (line === 'end') {
      if (blocks.pop() === undefined) problems.push(`${at}: "end" with no block open`);
    } else {
      problems.push(`${at}: not a statement this grammar knows: ${line}`);
    }
  });
  if (blocks.length > 0) problems.push(`end: ${blocks.join(', ')} never closed`);
  return problems;
};

/** Every `mermaid` block in a Markdown document whose first line says it is a sequence. */
export const sequenceBlocksIn = (markdown: string): string[] =>
  [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1] as string).filter((block) => block.startsWith('sequenceDiagram'));
