import { DiMap } from '@flowatlas/core';
import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { forwardedPublish, heldAt, type Held } from './forwarded.js';

/**
 * Following the values of a publish out of a layer of the repository's own
 * to the calls that decide them (P267).
 */
const COMMON = `
import { Inject } from '@nestjs/common';
declare class Queue { constructor(name: string); add(job: string, data: unknown): Promise<void> }
enum QueueName { mail = 'mail-queue', cron = 'cron-queue' }
const queueToken = (name: string): string => 'QUEUE_' + name;
const InjectJobQueue = (name: QueueName) => Inject(queueToken(name));
interface Driver { add(queueName: QueueName, jobName: string, data: unknown): Promise<void> }
class BrokerDriver implements Driver {
  private readonly queues: Record<string, Queue> = {};
  register(name: QueueName): void { this.queues[name] = new Queue(name); }
  add(queueName: QueueName, jobName: string, data: unknown): Promise<void> { return this.queues[queueName].add(jobName, data); }
}
class LocalDriver implements Driver {
  add(queueName: QueueName, jobName: string, data: unknown): Promise<void> { return Promise.resolve(); }
}
class JobQueue {
  constructor(private readonly driver: Driver, private readonly queueName: QueueName) {}
  add(jobName: string, data: unknown): Promise<void> { return this.driver.add(this.queueName, jobName, data); }
}
const providers = Object.values(QueueName).map((name) => ({
  provide: queueToken(name),
  useFactory: (driver: Driver) => new JobQueue(driver, name),
}));
`;

const project = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } }).createSourceFile(
    'a.ts',
    COMMON + source,
  );

/** The broker's call: the one `add` made on an entry of the registry. */
const brokerCall = (file: SourceFile): CallExpression =>
  file.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => call.getText().startsWith('this.queues[queueName].add')) as CallExpression;

/** The DI map a NestJS reader would have built: each class's constructor parameters by property. */
const diOf = (file: SourceFile): DiMap => {
  const di = new DiMap();
  for (const owner of file.getClasses()) {
    for (const [index, parameter] of (owner.getConstructors()[0]?.getParameters() ?? []).entries()) {
      di.set(owner, {
        property: parameter.getName(),
        parameter,
        index,
        via: 'type',
        resolution: { kind: 'unresolved', reason: 'test', hint: '', text: '' },
      });
    }
  }
  return di;
};

const show = (held: Held | undefined): string =>
  held === undefined ? '-' : `${held.kind}:${held.expression.getText()}`;

const walked = (file: SourceFile) => {
  const call = brokerCall(file);
  const [job, data] = call.getArguments();
  const queue = call.getFirstDescendantByKindOrThrow(SyntaxKind.ElementAccessExpression).getArgumentExpressionOrThrow();
  return forwardedPublish([heldAt(queue), heldAt(job as never), heldAt(data as never)], diOf(file));
};

describe('what a value of a publish is where it is written', () => {
  it('reads a parameter, a property of a destructured one, and a field the constructor takes', () => {
    const file = project(`
function send({ queue: { name } }: { queue: { name: string } }, job: string) { return [name, job]; }
class Holder {
  private readonly assigned: string;
  constructor(private readonly own: string, given: string) { this.assigned = given; }
  read() { return [this.own, this.assigned]; }
}`);
    const ids = file.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression).flatMap((array) => array.getElements());
    const kinds = ids.map((each) => heldAt(each));
    expect(kinds.map((each) => each.kind)).toEqual(['parameter', 'parameter', 'field', 'field']);
    expect(kinds[0]?.kind === 'parameter' ? kinds[0].path : undefined).toEqual(['queue', 'name']);
    expect(kinds.slice(2).map((each) => (each.kind === 'field' ? each.index : -1))).toEqual([0, 1]);
  });
});

describe('a publish followed out to the calls that decide it', () => {
  it('reads the queue an injected instance was built with, through the token its decorator asks for', () => {
    const file = project(`
class Welcome {
  constructor(@InjectJobQueue(QueueName.mail) private readonly mailQueue: JobQueue) {}
  send() { return this.mailQueue.add('send-mail', { to: 'a' }); }
}`);
    const out = walked(file);
    expect(out.here).toBe(false);
    expect(out.sites.map((site) => site.values.map(show))).toEqual([
      ['written:QueueName.mail', "written:'send-mail'", "written:{ to: 'a' }"],
    ]);
    expect(out.sites[0]?.through).toEqual(['BrokerDriver.add', 'JobQueue.add']);
    // `this.driver.add` may run the local driver instead.
    expect(out.sites[0]?.undecided).toBe(true);
  });

  it('reads the queue of an instance constructed where it is used', () => {
    const file = project(`
class Digest {
  private readonly queue = new JobQueue(new LocalDriver(), QueueName.cron);
  send(job: string) { return this.queue.add(job, {}); }
}`);
    expect(walked(file).sites.map((site) => site.values.map(show))).toEqual([['written:QueueName.cron', 'parameter:job', 'written:{}']]);
  });

  it('says why where the instance cannot be read, and draws it at the caller', () => {
    const file = project(`
class Audit {
  constructor(@Inject('AUDIT') private readonly audit: JobQueue) {}
  send() { return this.audit.add('audit', {}); }
}`);
    const [site] = walked(file).sites;
    expect(site?.values[0]?.kind).toBe('unread');
    expect(site?.values[0]?.kind === 'unread' ? site.values[0].why : '').toContain('this.audit is an instance of JobQueue');
  });

  it('keeps the broker’s call where nothing calls the layer', () => {
    const out = walked(project(''));
    expect(out.sites).toEqual([]);
    expect(out.here).toBe(true);
  });
});
