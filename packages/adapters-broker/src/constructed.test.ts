import { Project, SyntaxKind, type NewExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isResolved } from './channel-name.js';
import { constructsFrom, dispatchRecord, functionBehind, handlerInRecord, namesHandedTo, type HandlerTarget } from './constructed.js';

/**
 * Workers started by a construction, read once per queue their name stands
 * for (P271).
 */
const files = (sources: Record<string, string>): Record<string, SourceFile> => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: false, strict: true } });
  project.createSourceFile('node_modules/bullmq/index.d.ts', 'export declare class Worker { constructor(name: string, processor?: unknown); }');
  project.createSourceFile('node_modules/bullmq/package.json', '{"name":"bullmq","types":"index.d.ts"}');
  return Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, project.createSourceFile(name, text)]));
};

const workerIn = (file: SourceFile): NewExpression =>
  file.getDescendantsOfKind(SyntaxKind.NewExpression).find((made) => made.getExpression().getText() === 'Worker') as NewExpression;

const names = (made: NewExpression): string[] =>
  namesHandedTo(made.getArguments()[0] as never, { sharedPackages: [] })
    .flatMap((reading) => (isResolved(reading.resolution) ? reading.resolution.names : [`?${reading.resolution.why ?? reading.resolution.text}`]))
    .sort();

const nameOf = (target: HandlerTarget | undefined): string =>
  target === undefined ? '-' : target.kind === 'method' ? target.method.getName() : target.fn.name;

const HANDLERS = `
export async function sendReceipt(job: { data: { orderId: string } }) {}
export async function resizeImage(job: { data: { url: string } }) {}
export const refundOrder = async (job: { data: { orderId: string } }) => {};
`;

describe('the queues a worker made by a construction is started on', () => {
  it('reads one queue per key of the record a loop walks, through the function the name is handed to', () => {
    const { 'jobs.ts': jobs } = files({
      'handlers.ts': HANDLERS,
      'jobs.ts': `
import { Worker } from 'bullmq';
import { sendReceipt, resizeImage, refundOrder } from './handlers';
const handlers: Record<string, (job: unknown) => Promise<void>> = {
  'send-receipt': sendReceipt,
  'resize-image': resizeImage,
  refund: refundOrder,
};
const onFailure: Record<string, (job: unknown) => void> = {};
class Jobs {
  init() {
    for (const name of Object.keys(handlers)) this.start(name);
  }
  private start(name: string) {
    const run = (job: unknown) => handlers[name](job);
    const worker = new Worker(name, run);
    worker.on('failed', (job: unknown) => onFailure[name](job));
    return worker;
  }
}
`,
    });
    const made = workerIn(jobs as SourceFile);
    expect(constructsFrom(made, 'Worker', ['bullmq'])).toBe(true);
    expect(names(made)).toEqual(['refund', 'resize-image', 'send-receipt']);
    const record = dispatchRecord(made.getArguments()[0] as never, made.getArguments()[1]);
    expect(record?.getText()).toBe('handlers');
    expect(nameOf(handlerInRecord(record as never, 'send-receipt', undefined))).toBe('sendReceipt');
    expect(nameOf(handlerInRecord(record as never, 'refund', undefined))).toBe('refundOrder');
  });

  it('reads a list written out, an enum, entries and a callback of forEach', () => {
    const { 'jobs.ts': jobs } = files({
      'handlers.ts': HANDLERS,
      'jobs.ts': `
import { Worker } from 'bullmq';
import { sendReceipt } from './handlers';
enum Queue { mail = 'mail-queue', images = 'image-queue' }
const extra = ['audit'] as const;
const QUEUES = [...extra, 'billing'];
export const a = () => { for (const name of QUEUES) new Worker(name, sendReceipt); };
export const b = () => Object.values(Queue).forEach((name) => new Worker(name, sendReceipt));
export const c = () => { for (const [name, run] of Object.entries({ 'x-queue': sendReceipt })) new Worker(name, run); };
`,
    });
    const made = (jobs as SourceFile).getDescendantsOfKind(SyntaxKind.NewExpression);
    expect(made.map(names)).toEqual([['audit', 'billing'], ['image-queue', 'mail-queue'], ['x-queue']]);
    const [, , third] = made;
    const reading = namesHandedTo(third?.getArguments()[0] as never, { sharedPackages: [] })[0];
    expect(nameOf(functionBehind(third?.getArguments()[1] as never, undefined, reading?.bound ?? new Map()))).toBe('sendReceipt');
  });

  it('says why where the list is not written out or nothing calls the function', () => {
    const { 'jobs.ts': jobs } = files({
      'jobs.ts': `
import { Worker } from 'bullmq';
declare const fromSettings: string[];
export const a = () => { for (const name of fromSettings) new Worker(name); };
export function b(name: string) { return new Worker(name); }
`,
    });
    const [first, second] = (jobs as SourceFile).getDescendantsOfKind(SyntaxKind.NewExpression);
    expect(names(first as NewExpression)[0]).toContain('fromSettings is not a list written out');
    expect(names(second as NewExpression)[0]).toContain('nothing calls its function');
  });

  it('reads the queue a base class keeps from each class that extends it, through a class a condition chooses (P286)', () => {
    const { 'jobs.ts': jobs } = files({
      'jobs.ts': `
import { Worker } from 'bullmq';
enum Topic { Mail = 'mail', Billing = 'billing' }
class Client {
  static readonly paid = false;
  open(topic: string, processor: unknown) {
    const Made = !Client.paid ? Worker : require('worker-paid').PaidWorker;
    return new Made(topic, processor);
  }
}
class WorkerBase {
  constructor(public readonly topic: Topic, private readonly client: Client) {}
  start(processor: unknown) { this.client.open(this.topic, processor); }
}
class MailWorker extends WorkerBase { constructor(client: Client) { super(Topic.Mail, client); } }
class BillingWorker extends WorkerBase { constructor(client: Client) { super(Topic.Billing, client); } }
class LateBilling extends BillingWorker {}
class Any extends WorkerBase {}
export const custom = new Any('audit' as Topic, new Client());
`,
    });
    const made = (jobs as SourceFile).getDescendantsOfKind(SyntaxKind.NewExpression).find((each) => each.getExpression().getText() === 'Made') as NewExpression;
    expect(constructsFrom(made, 'Worker', ['bullmq'])).toBe(true);
    expect(names(made)).toEqual(['audit', 'billing', 'mail']);
    const through = namesHandedTo(made.getArguments()[0] as never, { sharedPackages: [] }).map((reading) => reading.through.join(' > '));
    expect(through).toContain('Client.open > MailWorker');
    expect(through).toContain('Client.open > new Any');
  });

  it('says why where nothing builds the class a field is kept by (P286)', () => {
    const { 'jobs.ts': jobs } = files({
      'jobs.ts': `
import { Worker } from 'bullmq';
export class Lone {
  constructor(private readonly topic: string) {}
  start() { return new Worker(this.topic); }
}
`,
    });
    expect(names(workerIn(jobs as SourceFile))[0]).toContain('nothing here builds it');
  });

  it('is not a worker unless the class is the transport’s', () => {
    const { 'jobs.ts': jobs } = files({
      'jobs.ts': `
class Worker { constructor(name: string) {} }
export const a = new Worker('mail');
`,
    });
    expect(constructsFrom(workerIn(jobs as SourceFile), 'Worker', ['bullmq'])).toBe(false);
  });
});
