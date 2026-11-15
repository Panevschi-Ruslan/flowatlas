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

describe('a table a repository base class is handed by the class extending it (P289)', () => {
  const REPOSITORY = `
declare class Client { put(input: { TableName: string; Item: unknown }): Promise<void> }
class Repository {
  private readonly client = new Client();
  constructor(private readonly table: string) {}
  save(item: unknown) { return this.client.put({ TableName: this.table, Item: item }); }
}
class OrdersRepository extends Repository {
  constructor() { super('orders'); }
  place(order: unknown) { return this.save(order); }
}
class NamedRepository extends Repository {}
class AuditRepository extends Repository {
  constructor(name: string) { super(name); }
}
abstract class Store {
  protected abstract readonly table: string;
  write(item: unknown) { return new Client().put({ TableName: this.table, Item: item }); }
}
class CartStore extends Store { protected readonly table = 'carts'; }
`;
  const walkedFrom = (source: string, method: string) => {
    const file = new Project({ useInMemoryFileSystem: true }).createSourceFile('repo.ts', REPOSITORY + source);
    const put = file
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => call.getText().includes('.put(') && call.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)?.getName() === method) as CallExpression;
    const table = put.getFirstDescendantByKindOrThrow(SyntaxKind.ObjectLiteralExpression).getPropertyOrThrow('TableName').getLastChildOrThrow();
    return forwardedPublish([heldAt(table)], diOf(file));
  };

  it("reads the table a subclass hands up in super(...), from its own methods and from an instance of it however it is had", () => {
    const out = walkedFrom(
      `
new OrdersRepository().place({});
new NamedRepository('stock').save({});
new AuditRepository('audit').save({});
class Checkout {
  constructor(private readonly orders: OrdersRepository) {}
  run() { return this.orders.save({}); }
}`,
      'save',
    );
    expect(out.sites.map((site) => `${site.values.map(show).join(' ')} at ${site.site.getText()}`)).toEqual([
      "written:'orders' at this.save(order)",
      "written:'stock' at new NamedRepository('stock').save({})",
      "written:'audit' at new AuditRepository('audit').save({})",
      "written:'orders' at this.orders.save({})",
    ]);
  });

  it('reads a field a base only declares as what the class extending it initialises it to', () => {
    const out = walkedFrom('new CartStore().write({});', 'write');
    expect(out.sites.map((site) => site.values.map(show).join(' '))).toEqual(["written:'carts'"]);
  });
});

describe('the jobs of a rest parameter and a list, and a way out of any length (P290)', () => {
  const file = (source: string): SourceFile => new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);
  /** Every queue each site reads for the `type` of what `send` is handed, and why where some are not. */
  const queues = (source: string, path: readonly string[] = ['type']): string[] => {
    const read = file(source);
    const call = read.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'send') as CallExpression;
    const out = forwardedPublish([heldValues(call.getArguments()[0] as never, path, call)], new DiMap());
    return out.sites.map((site) => {
      const [value] = site.values;
      if (value?.kind !== 'written') return `${value?.kind}: ${value?.kind === 'unread' ? value.why : ''}`;
      const names = (value.choices ?? [value.expression]).map((each) => each.getText()).join(' ');
      return value.partial === undefined ? names : `${names} | ${value.partial}`;
    });
  };

  it('reads every job a caller hands a rest parameter a loop goes through, a spread list and nothing too', () => {
    expect(
      queues(`
declare function send(job: unknown): void;
function chain(...jobs: ({ type: string } | undefined)[]) {
  for (const job of jobs) {
    if (!job) continue;
    send(job);
  }
}
const publishJob = () => ({ type: 'publish' });
chain({ type: 'resize' }, publishJob(), undefined);
const later = [{ type: 'archive' }];
later.push({ type: 'notify' });
chain(...later);
`),
    ).toEqual(["'resize' 'publish'", "'archive' 'notify'"]);
  });

  it('reads each child a caller hands a list mapped by a callback, and says why where one is not written out', () => {
    expect(
      queues(`
declare function send(job: unknown): void;
declare const followUp: { type: string };
function withChildren(children: { type: string }[]) {
  children.forEach((child) => send(child));
}
const children = [{ type: 'archive' }];
children.push(followUp);
withChildren(children);
`),
    ).toEqual(["'archive' | followUp is not written out where type would be read."]);
  });

  it('reads each branch of a condition a const is bound to, a branch of nothing none', () => {
    expect(
      queues(`
declare function send(job: unknown): void;
declare const urgent: boolean;
function one(job: { type: string } | undefined) { send(job); }
const lead = urgent ? { type: 'first' } : undefined;
one(lead);
`),
    ).toEqual(["'first'"]);
  });

  it('reads an element by its place in a list a caller writes', () => {
    expect(
      queues(`
declare function send(job: unknown): void;
function first(jobs: { type: string }[]) { send(jobs[0]); }
first([{ type: 'archive' }]);
`),
    ).toEqual(["'archive'"]);
  });

  it('follows a value out through any number of calls, and stops a recursion where it meets it again', () => {
    expect(
      queues(`
declare function send(job: unknown): void;
const one = (job: { type: string }) => send(job);
const two = (job: { type: string }) => one(job);
const three = (job: { type: string }) => two(job);
const four = (job: { type: string }) => three(job);
const five = (job: { type: string }) => four(job);
const six = (job: { type: string }, again: boolean): void => (again ? six(job, false) : five(job));
six({ type: 'deep' }, true);
`),
    ).toEqual(["'deep'"]);
  });
});

describe('a batch a layer plans, splits and hands back from an error (P298)', () => {
  const file = (source: string): SourceFile => new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);
  const queues = (source: string): string[] => {
    const read = file(source);
    const call = read.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'send') as CallExpression;
    const out = forwardedPublish([heldValues(call.getArguments()[0] as never, ['type'], call)], new DiMap());
    return out.sites.map((site) => {
      const [value] = site.values;
      const at = site.site.getExpression().getText();
      if (value?.kind !== 'written') return `${at}: ${value?.kind}`;
      return `${at}: ${(value.choices ?? [value.expression]).map((each) => each.getText()).join(' ')}`;
    });
  };
  const LAYER = `
declare function send(job: unknown): void;
declare function relay(jobs: { type: string; delay?: number }[]): Promise<void>;
type Job = { type: string; delay?: number };
class Refused extends Error {
  constructor(public readonly unsent: Job[], reason: string) { super(reason); }
}
class Layer {
  async addBulk(jobs: Job[]) { await this.dispatch(jobs); }
  private async dispatch(jobs: Job[]) {
    const { now, later } = this.plan(jobs);
    if (now.length > 0) this.toQueue(now);
    try {
      await this.forward(later);
    } catch (error) {
      this.fallBack(error, [...later]);
    }
  }
  private plan(jobs: Job[]): { now: Job[]; later: Job[] } {
    const { slow, fast } = this.split(jobs);
    if (slow.length === 0) return { now: [], later: fast };
    return { now: slow, later: fast };
  }
  private split(jobs: Job[]) {
    const slow: Job[] = [];
    const fast: Job[] = [];
    for (const job of jobs) {
      if ((job.delay ?? 0) > 900) slow.push(job);
      else fast.push(job);
    }
    return { slow, fast };
  }
  private async forward(jobs: Job[]) {
    try {
      await relay(jobs);
    } catch (error) {
      throw new Refused(jobs, String(error));
    }
  }
  private fallBack(error: unknown, jobs: Job[]) {
    const unsent = error instanceof Refused ? error.unsent : jobs;
    this.toQueue(unsent);
  }
  private toQueue(jobs: Job[]) { send(jobs[0]); }
}
`;

  it('reads a job through the record a planning method answers, destructured, and through the list an error carries back', () => {
    expect(queues(`${LAYER}\nnew Layer().addBulk([{ type: 'issue' }, { type: 'remind', delay: 3600 }]);`)).toEqual([
      "new Layer().addBulk: 'issue' 'remind'",
    ]);
  });

  it('reads a value that is one of a parameter and what a caught error was thrown with, each on its own', () => {
    const read = file(`${LAYER}\nnew Layer().addBulk([{ type: 'issue' }]);`);
    const call = read.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getText() === 'this.toQueue(unsent)') as CallExpression;
    const held = heldValues(call.getArguments()[0] as never, ['0', 'type'], call);
    expect(held.kind).toBe('several');
    expect(held.kind === 'several' ? held.options.map((option) => (option.kind === 'parameter' ? `${option.parameter.getName()}.${option.path.join('.')}` : option.kind)) : []).toEqual([
      'error.unsent.0.type',
      'jobs.0.type',
    ]);
  });
});

describe('what a catch is handed, where a package may have thrown it (P304)', () => {
  const file = (source: string): SourceFile => new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);
  const heldAtSend = (source: string, path: readonly string[]): Held => {
    const read = file(source);
    const call = read.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'send') as CallExpression;
    return heldValues(call.getArguments()[0] as never, path, call);
  };
  const HEAD = `
import axios from 'axios';
import { Queue } from 'bullmq';
declare function send(job: unknown): void;
class Rejected extends Error {
  constructor(public readonly jobType: string) { super(jobType); }
}
`;

  it('says a field read off an error a package throws is not read, naming the call', () => {
    const held = heldAtSend(
      `${HEAD}
class Relay {
  async push() {
    try {
      await axios.post('relay', {});
    } catch (error) {
      send({ type: error.response.data.type });
    }
  }
}`,
      ['type'],
    );
    expect(held.kind).toBe('unread');
    expect(held.kind === 'unread' ? held.why : '').toMatch(/error of axios, which axios\.post\(\) throws/);
  });

  it('reads what the repository throws and keeps why the package error is not read beside it', () => {
    const held = heldAtSend(
      `${HEAD}
class Relay {
  private readonly queue = new Queue('relay');
  private check(type: string): void {
    if (type === '') throw new Rejected('audit');
  }
  async push(type: string) {
    try {
      this.check(type);
      await this.queue.add(type, {});
    } catch (error) {
      send({ type: error.jobType });
    }
  }
}`,
      ['type'],
    );
    expect(held.kind).toBe('written');
    expect(held.kind === 'written' ? (held.choices ?? [held.expression]).map((each) => each.getText()) : []).toEqual(["'audit'"]);
    expect(held.kind === 'written' ? held.partial : '').toMatch(/error of bullmq, which this\.queue\.add\(\) throws/);
  });

  it('follows a method of another instance of the repository for what it throws', () => {
    const held = heldAtSend(
      `${HEAD}
class Checker {
  check(type: string): void {
    if (type === '') throw new Rejected('audit');
  }
}
class Relay {
  constructor(private readonly checker: Checker) {}
  push(type: string) {
    try {
      this.checker.check(type);
    } catch (error) {
      send({ type: error.jobType });
    }
  }
}`,
      ['type'],
    );
    expect(held.kind === 'written' ? [(held.choices ?? [held.expression]).map((each) => each.getText()), held.partial] : held.kind).toEqual([["'audit'"], undefined]);
  });

  it('keeps following a value of the scope around the try block a catch only re-uses', () => {
    const read = file(`${HEAD}
class Relay {
  async push(type: string) {
    try {
      await axios.post('relay', { type });
    } catch (error) {
      send({ type });
    }
  }
}
new Relay().push('remind');`);
    const call = read.getDescendantsOfKind(SyntaxKind.CallExpression).find((each) => each.getExpression().getText() === 'send') as CallExpression;
    const out = forwardedPublish([heldValues(call.getArguments()[0] as never, ['type'], call)], new DiMap());
    expect(out.sites.map((site) => (site.values[0]?.kind === 'written' ? site.values[0].expression.getText() : site.values[0]?.kind))).toEqual(["'remind'"]);
  });

  it('does not take a call of the language, or of a value of the repository, for a package', () => {
    const held = heldAtSend(
      `${HEAD}
class Relay {
  async push(jobs: string[]) {
    try {
      JSON.parse('{}');
      jobs.push('x');
    } catch (error) {
      send({ type: error.jobType });
    }
  }
}`,
      ['type'],
    );
    expect(held.kind === 'unread' ? held.why : held.kind).toMatch(/nothing it throws is written in this repository/);
  });
});
