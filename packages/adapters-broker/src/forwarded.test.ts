import { DiMap } from '@flowatlas/core';
import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { forwardedPublish, heldAt, heldAtSite, heldValues, type Held } from './forwarded.js';

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

describe('a value read where its record is built further in (P286)', () => {
  const held = (source: string): string[] => {
    const file = new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);
    const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression).filter((each) => each.getExpression().getText() === 'enqueue');
    return calls.flatMap((call) => {
      const value = heldValues(call.getArguments()[0] as never, ['type'], call);
      if (value.kind !== 'written') return [`${value.kind}:${value.kind === 'unread' ? value.why : value.expression.getText()}`];
      return (value.choices ?? [value.expression]).map((each) => each.getText());
    });
  };

  it('reads the record an async function answers, its kind the caller hands it', () => {
    expect(
      held(`
declare function enqueue(job: unknown): void;
async function buildMove(options: { id: string; type: 'move-out' | 'move-in' }) {
  const { id, type } = options;
  await Promise.resolve(id);
  return { type, payload: { id } };
}
export async function run() { enqueue(await buildMove({ id: '1', type: 'move-out' })); }
`),
    ).toEqual(["'move-out'"]);
  });

  it('reads every record a function may answer, and none where it answers nothing', () => {
    expect(
      held(`
declare function enqueue(job: unknown): void;
function notifyJob(target: string) { return { type: 'notify', payload: { target } }; }
async function thumbnailIfNeeded(url: string, notify: boolean) {
  if (url.endsWith('.png')) return { type: 'thumbnail' as const, payload: { url } };
  if (notify) return notifyJob(url);
  return undefined;
}
export async function run() { enqueue(await thumbnailIfNeeded('a.png', true)); }
`),
    ).toEqual(["'thumbnail'", "'notify'"]);
  });

  it('reads a record spread into another, and each branch of a condition', () => {
    expect(
      held(`
declare function enqueue(job: unknown): void;
function notifyJob(target: string) { return { type: 'notify', payload: { target } }; }
export function run(urgent: boolean) {
  const job = { ...notifyJob('a'), delay: 10 };
  enqueue(job);
  enqueue({ type: urgent ? 'ping-fast' : 'ping', payload: {} });
}
`),
    ).toEqual(["'notify'", "'ping-fast'", "'ping'"]);
  });

  it('waits on the caller where the record is a parameter', () => {
    expect(
      held(`
declare function enqueue(job: unknown): void;
export function run(job: { type: string }) { enqueue({ ...job, delay: 1 }); }
`),
    ).toEqual(['parameter:job']);
  });
});

describe('a queue an instance is set up with, and one its subclasses hand their base (P286)', () => {
  it('reads the queue set by another method of the client, and the topic each subclass hands its base', () => {
    const file = new Project({ useInMemoryFileSystem: true }).createSourceFile(
      'a.ts',
      `
declare class Queue { constructor(name: string); add(job: string, data: unknown): Promise<void> }
enum Topic { Mail = 'mail', Billing = 'billing' }
class Client {
  private queue: Queue;
  open(topic: string) { this.queue = new Queue(topic); }
  add(name: string, data: unknown) { return this.queue.add(name, data); }
}
class QueueBase {
  private client: Client;
  constructor(public readonly topic: Topic, client: Client) { this.client = client; }
  open() { this.client.open(this.topic); }
  add(job: { name: string; data: unknown }) { return this.client.add(job.name, job.data); }
}
class MailQueue extends QueueBase { constructor() { super(Topic.Mail, new Client()); this.open(); } }
class BillingQueue extends QueueBase { constructor(client: Client) { super(Topic.Billing, client); } }
const mail = new MailQueue();
const billing = new BillingQueue(new Client());
export const a = () => mail.add({ name: 'welcome', data: {} });
export const b = () => billing.add({ name: 'invoice', data: {} });
`,
    );
    const call = file.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getText().startsWith('this.queue.add')) as CallExpression;
    const queue = heldAtSite(file.getDescendantsOfKind(SyntaxKind.NewExpression)[0]?.getArguments()[0] as never, call);
    expect(queue.kind).toBe('set');
    const [name] = call.getArguments();
    const out = forwardedPublish([queue, heldAt(name as never)], new DiMap(), 2);
    expect(out.sites.map((site) => site.values.map(show))).toEqual([
      ['written:Topic.Mail', "written:'welcome'"],
      ['written:Topic.Billing', "written:'invoice'"],
    ]);
    expect(out.sites[0]?.through).toEqual(['Client.add', 'QueueBase.add']);
  });
});
