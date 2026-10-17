import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseRulesReport } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliError, EXIT } from '../exit.js';
import { runAccept } from './accept.js';
import { buildProject } from './build.js';
import { runDoctorCommand } from './doctor.js';
import { runRules } from './rules.js';

/**
 * `fixtures/multi-repo-rules` (P114): the bookshop with tags and five rules,
 * three of which its code breaks once each, one it keeps, and one naming a
 * service that does not exist. A second copy, whose billing has no handler of
 * `order.created`, breaks the fourth.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-rules-'));
const dir = join(scratch, 'multi-repo-rules');
const config = join(dir, 'flowatlas.config.json');
const quietDir = join(scratch, 'quiet');
const quietConfig = join(quietDir, 'flowatlas.config.json');

/** Billing's consumer with the handler of `order.created` taken out: the variant (P114). */
const QUIET_CONSUMER = `import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import type { InvoiceRequestedEvent } from './invoice.dto';
import { InvoicesService } from './invoices.service';

@Controller()
export class InvoicesConsumer {
  constructor(private readonly invoices: InvoicesService) {}

  @EventPattern('invoice.requested')
  onInvoiceRequested(@Payload() event: InvoiceRequestedEvent): void {
    this.invoices.create({ orderId: event.orderId, amount: event.amount });
  }
}
`;
const baseline = join(scratch, 'baseline.json');
const io = { out(): void {}, err(): void {}, tty: false };

beforeAll(async () => {
  cpSync(join(ROOT, 'fixtures', 'multi-repo-rules'), dir, {
    recursive: true,
    filter: (from) => !from.split(sep).includes('.flowatlas'),
  });
  cpSync(dir, quietDir, { recursive: true, filter: (from) => !from.split(sep).includes('.flowatlas') });
  writeFileSync(join(quietDir, 'billing', 'src', 'invoices', 'invoices.consumer.ts'), QUIET_CONSUMER);
  await buildProject({ config, builtAt: FIXED });
  await buildProject({ config: quietConfig, builtAt: FIXED });
}, 300_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('flowatlas rules (P114)', () => {
  it('lists the three violations, each at the crossing hop with the rule\'s note', () => {
    const run = runRules({ config }, io);
    expect(run.report.violations.map((item) => [item.rule, item.at?.service, item.at?.file, item.at?.line])).toEqual([
      ['frontends-reach-only-edge', 'web', 'src/app/orders-api.service.ts', 34],
      ['only-billing-consumes-order-events', 'gateway', 'src/audit/order-audit.consumer.ts', 14],
      ['only-orders-writes-orders', 'billing', 'src/invoices/invoices.service.ts', 33],
    ]);
    expect(run.report.rules.find((rule) => rule.name === 'order-created-keeps-a-consumer')?.status).toBe('held');
    expect(run.text).toContain('why: the browser talks to the gateway, never to a domain service');
    expect(run.text).toContain('at web/src/app/orders-api.service.ts:34');
    expect(run.exitCode).toBe(EXIT.ok);
  });

  it('never passes a rule that names nothing: it is unchecked, with rule-matches-nothing', () => {
    const run = runRules({ config }, io);
    expect(run.report.unchecked).toEqual([expect.objectContaining({ rule: 'typo-rule', reason: 'rule-matches-nothing', selector: 'service biling' })]);
    expect(run.report.rules.find((rule) => rule.name === 'typo-rule')?.status).toBe('unchecked');
  });

  it('fails at --fail-on error and warning, not at none', () => {
    expect(runRules({ config, failOn: 'error' }, io).exitCode).toBe(EXIT.failed);
    expect(runRules({ config, failOn: 'warning' }, io).exitCode).toBe(EXIT.failed);
    expect(runRules({ config, failOn: 'none' }, io).exitCode).toBe(EXIT.ok);
    // The typo alone still fails: a rule nobody could check is not a pass (I3).
    expect(runRules({ config, failOn: 'error', rule: ['typo-rule'] }, io).exitCode).toBe(EXIT.failed);
    expect(runRules({ config, failOn: 'error', rule: ['order-created-keeps-a-consumer'] }, io).exitCode).toBe(EXIT.ok);
  });

  it('writes the whole report to rules.json, whatever --max-nodes printed', () => {
    const run = runRules({ config, maxNodes: '1' }, io);
    expect(run.text).toContain('… 2 more; the whole report is in');
    const written = parseRulesReport(JSON.parse(readFileSync(run.file as string, 'utf8')));
    expect(written.violations).toHaveLength(3);
    expect(written.rulesFormatVersion).toBe(1);
  });

  it('narrows by rule and by service, the file still whole', () => {
    const run = runRules({ config, service: 'billing', format: 'json' }, io);
    expect(run.shown.violations.map((item) => item.rule)).toEqual(['only-orders-writes-orders']);
    expect(run.report.violations).toHaveLength(3);
    expect(() => runRules({ config, rule: ['no-such-rule'] }, io)).toThrow(CliError);
  });

  it('--list says how many nodes each side selects', () => {
    const run = runRules({ config, list: true }, io);
    const line = run.text.split('\n').find((text) => text.startsWith('typo-rule'));
    expect(line).toBe('typo-rule  forbid  error  from=32 to=0  (unchecked: a side selects nothing)');
    expect(run.text).toMatch(/^frontends-reach-only-edge {2}tags {2}error {2}source=\d+ mayReach edge=\d+$/m);
  });

  it('breaks the fourth rule on a copy whose billing no longer consumes order.created', () => {
    const run = runRules({ config: quietConfig, failOn: 'error' }, io);
    const missing = run.report.violations.find((item) => item.rule === 'order-created-keeps-a-consumer');
    expect(missing?.message).toBe('nothing channel order.created selects reaches service billing any more');
    expect(run.report.violations).toHaveLength(4);
    expect(run.exitCode).toBe(EXIT.failed);
  });

  it('renders markdown and github annotations at the crossing hop', () => {
    expect(runRules({ config, format: 'markdown' }, io).text).toContain('| `only-orders-writes-orders` |');
    const github = runRules({ config, format: 'github' }, io).text;
    expect(github).toContain('::error file=billing/src/invoices/invoices.service.ts,line=33,title=rule only-orders-writes-orders::');
    expect(github).toContain('::error title=rule typo-rule%3A rule-matches-nothing::');
  });
});

describe('rules in doctor and accept (P114)', () => {
  it('doctor --accept, then --strict exits 0; one more violation fails it naming only the new one', () => {
    runDoctorCommand({ config, accept: true, baseline }, io);
    const held = JSON.parse(readFileSync(baseline, 'utf8'));
    expect(held.baselineFormatVersion).toBe(2);
    expect(Object.keys(held.rules)).toHaveLength(4);
    expect(runDoctorCommand({ config, strict: true, baseline }, io).exitCode).toBe(EXIT.ok);

    const written = JSON.parse(readFileSync(config, 'utf8'));
    const more = join(dir, 'flowatlas.more.config.json');
    writeFileSync(
      more,
      JSON.stringify({ ...written, rules: [...written.rules, { name: 'gateway-not-billing', forbid: { from: { service: 'gateway' }, to: { service: 'billing' } } }] }),
    );
    const strict = runDoctorCommand({ config: more, strict: true, baseline }, io);
    expect(strict.exitCode).toBe(EXIT.failed);
    expect(strict.report.rules.violations.filter((item) => item.new).map((item) => item.rule)).toEqual(['gateway-not-billing']);
    expect(strict.report.verdict.reasons).toContain('1 architecture rule violation at error the baseline does not hold');
    expect(runDoctorCommand({ config: more, strict: true, baseline, rules: false }, io).exitCode).toBe(EXIT.ok);
  });

  it('reads a baseline of format 1 as one that accepted no violation', () => {
    const held = JSON.parse(readFileSync(baseline, 'utf8'));
    const old = join(scratch, 'baseline-v1.json');
    const { rules: _rules, ...rest } = held;
    writeFileSync(old, JSON.stringify({ ...rest, baselineFormatVersion: 1 }));
    const strict = runDoctorCommand({ config, strict: true, baseline: old }, io);
    expect(strict.exitCode).toBe(EXIT.failed);
    expect(strict.report.rules.new).toBe(4);
  });

  it('accept rule:<name> excuses the violations it names, and they are listed as excused', () => {
    const db = join(dir, '.flowatlas', 'graph.db');
    expect(() => runAccept('rule:only-orders-writes-orders', { config, db, service: 'billing', print: () => {} })).toThrow(/needs|reason/);
    const accepted = runAccept('rule:only-orders-writes-orders', {
      config,
      db,
      service: 'billing',
      note: 'the backfill job, until it is done',
      acceptedAt: FIXED,
      print: () => {},
    });
    expect(accepted.covered).toBe(1);
    const run = runRules({ config }, io);
    expect(run.report.violations.map((item) => item.rule)).not.toContain('only-orders-writes-orders');
    expect(run.report.excused).toEqual([expect.objectContaining({ rule: 'only-orders-writes-orders', excusedBy: 'the backfill job, until it is done' })]);
    expect(() => runAccept('rule:no-such-rule', { config, db, note: 'x', print: () => {} })).toThrow(/no rule named/);
  });

  it('refuses a rule that fails its schema with exit 2, naming it', () => {
    const written = JSON.parse(readFileSync(config, 'utf8'));
    const bad = join(dir, 'flowatlas.bad.config.json');
    writeFileSync(bad, JSON.stringify({ ...written, rules: [{ name: 'two-shapes', forbid: written.rules[4].forbid, tags: written.rules[0].tags }] }));
    let caught: unknown;
    try {
      runRules({ config: bad }, io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).code).toBe(EXIT.cannotRun);
    expect((caught as CliError).message).toContain('rule-invalid: rule "two-shapes"');
    expect(() => runDoctorCommand({ config: bad }, io)).toThrow(/rule-invalid/);
  });
});
