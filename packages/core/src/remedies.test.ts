import { describe, expect, it } from 'vitest';
import { ROW_KINDS } from './model/row-kind.js';
import { PATTERN_CAUSES } from './patterns/schema.js';
import { renderPrompt, type PromptSubject } from './prompt-text.js';
import { REMEDIES, remediesOf, remedyLinesOf } from './remedies.js';

const gaps = [...ROW_KINDS].filter(([, kind]) => kind === 'gap').map(([reason]) => reason);

describe('REMEDIES', () => {
  it('closes every gap reason one way at least, and accepting it besides', () => {
    for (const reason of gaps) {
      const lines = remedyLinesOf(`gap:svc|src/a.ts|${reason}`);
      expect(remediesOf(reason).length, reason).toBeGreaterThan(0);
      expect(lines.length, reason).toBeGreaterThanOrEqual(2);
      expect(lines.at(-1), reason).toContain('flowatlas accept');
    }
  });

  it('names only reasons the catalogue knows, so a rename cannot leave one behind', () => {
    for (const reason of REMEDIES.keys()) expect(ROW_KINDS.has(reason), reason).toBe(true);
  });

  it("lists a pattern for exactly the causes a pattern reads (P121's PATTERN_CAUSES)", () => {
    const pattern = [...REMEDIES].filter(([, ways]) => ways.includes('pattern')).map(([reason]) => reason).sort();
    expect(pattern).toEqual([...PATTERN_CAUSES].sort());
  });

  it('says the missing repository by name when the gap is evidence for one', () => {
    const [link, setting] = remedyLinesOf('gap:gateway|src/pay.ts|unknown-base-url-env', 'payments');
    expect(link).toContain('one for "payments" looks missing here');
    expect(setting).toContain('services[].baseUrlEnv');
    expect(remedyLinesOf('gap:gateway|src/pay.ts|unknown-base-url-env')[0]).toContain('flowatlas doctor --missing');
  });

  it('closes a blind spot of traffic by linking the repository, or by finding and describing it (P144)', () => {
    expect(remediesOf('seen-not-in-code')).toEqual(['link', 'traffic']);
    const [link, found, accept] = remedyLinesOf('gap:payments||seen-not-in-code', 'payments');
    expect(link).toContain('one for "payments" looks missing here');
    expect(link).toContain('`flowatlas link <path>`');
    expect(found).toContain('`cant_follow`');
    expect(accept).toContain('`flowatlas accept seen-not-in-code --service payments --note');
    expect(remedyLinesOf('gap:gateway||seen-not-in-code')[0]).toContain('`flowatlas doctor --missing` names the likely one');
  });

  it('closes a subscription nothing writes to by linking the repository its writer is in, or accepting it (P204)', () => {
    for (const reason of ['stream-no-writer', 'subscription-matches-nothing']) {
      expect(remediesOf(reason), reason).toEqual(['link']);
      const [link, accept] = remedyLinesOf(`gap:jobs|infra/main.tf|${reason}`, 'payments');
      expect(link, reason).toContain('one for "payments" looks missing here');
      expect(accept, reason).toContain(`flowatlas accept ${reason} --service jobs --file infra/main.tf`);
    }
  });

  it('writes the accept command a shell takes, quoting what needs it', () => {
    expect(remedyLinesOf('gap:web|src/my app.ts|api-path-dynamic').at(-1)).toBe(
      "- Or, if it is right as it is, accept it: `flowatlas accept api-path-dynamic --service web --file 'src/my app.ts' --note '<why this one is fine>'`.",
    );
    expect(remedyLinesOf('gap:||file-not-parsed').at(-1)).toContain("`flowatlas accept file-not-parsed --note '<why this one is fine>'`");
  });
});

describe('a check as a task (Copy for agent)', () => {
  const subject: PromptSubject = {
    id: 'gap:gateway|src/pay.ts|unknown-base-url-env',
    label: 'unknown-base-url-env',
    type: 'check',
    kind: 'action',
    service: 'gateway',
    loc: 'src/pay.ts',
    check: { places: [{ loc: 'src/pay.ts:12', message: 'no service declares PAYMENTS_URL' }], missing: 'payments' },
    steps: [],
    stepsCut: 0,
    gaps: [],
  };

  it('says how to close it on every check, and the task only when asked', () => {
    const plain = renderPrompt(subject);
    expect(plain).toContain('## How to close it');
    expect(plain).not.toContain('## Task');
    const task = renderPrompt({ ...subject, task: 'close' });
    expect(task.indexOf('## Task')).toBeLessThan(task.indexOf('## Where'));
    expect(task).toContain('`flowatlas doctor --reason unknown-base-url-env`');
  });
});
