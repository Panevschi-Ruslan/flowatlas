import { Project, SyntaxKind, type CallExpression, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { locatedExpressions, locatedSlots, locatorApplies, type NameLocator } from './locator.js';

/**
 * A path through an argument, and through what a class is constructed with.
 *
 * The shape a client that sends commands is written in: the name two and three
 * keys inside the input, often inside a list, and the input handed to a
 * constructor in the call or in a constant a statement earlier.
 */
const parse = (source: string): SourceFile =>
  new Project({ useInMemoryFileSystem: true }).createSourceFile('a.ts', source);

const callTo = (file: SourceFile, method: string): CallExpression => {
  const call = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((item) => item.getExpression().getText().endsWith(`.${method}`));
  if (call === undefined) throw new Error(`no .${method}() in the source`);
  return call;
};

/** Each slot as text: what it reached, where it stopped, or nothing written. */
const slots = (site: CallExpression, locator: NameLocator): (string | undefined)[] =>
  locatedSlots(site, locator).map((slot) =>
    slot === undefined ? undefined : `${slot.reached ? '' : 'stopped at '}${slot.expression.getText()}`,
  );

const DETAIL_TYPE: NameLocator = {
  kind: 'constructed-argument-path',
  class: 'PutCommand',
  path: ['Entries', '*', 'DetailType'],
};

describe('a path through what a class is constructed with', () => {
  it('reads a command built in the call that sends it', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [{ DetailType: 'LoanCreated' }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads a command built in a constant and sent a statement later', () => {
    const file = parse(`const command = new PutCommand({ Entries: [{ DetailType: 'LoanCreated' }] });
client.send(command);`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads a class reached through a namespace', () => {
    const file = parse(`client.send(new sdk.PutCommand({ Entries: [{ DetailType: 'LoanCreated' }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads one slot per element of a list, in order', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [
  { DetailType: 'HoldPlaced' },
  { DetailType: 'HoldQueued' },
] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'HoldPlaced'", "'HoldQueued'"]);
  });

  it('follows records and lists kept in constants', () => {
    const file = parse(`const entry = { DetailType: 'LoanCreated' };
const input = { Entries: [entry] } as const;
client.send(new PutCommand(input));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('follows a shorthand property to the constant it copies', () => {
    const file = parse(`const Entries = [{ DetailType: 'LoanCreated' }];
client.send(new PutCommand({ Entries }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  // The name at the end is handed over as written: whether it is a literal, a
  // constant or a member of a shared enum is for the reader of names to say.
  it('hands the name over as written, not as the value it is bound to', () => {
    const file = parse(`const LOAN_CREATED = 'LoanCreated';
client.send(new PutCommand({ Entries: [{ DetailType: LOAN_CREATED }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(['LOAN_CREATED']);
  });

  // Kept rather than dropped, so a sibling path over the same list stays on the
  // same index: the second entry's bus is the second entry's.
  it('keeps an element that does not write the key, as nothing written', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [
  { DetailType: 'HoldPlaced' },
  { Bus: 'library', DetailType: 'HoldQueued' },
] }));`);
    const bus: NameLocator = { kind: 'constructed-argument-path', class: 'PutCommand', path: ['Entries', '*', 'Bus'] };
    expect(slots(callTo(file, 'send'), bus)).toEqual([undefined, "'library'"]);
  });

  it('stops at a list that is not written out, and says where', () => {
    const file = parse(`client.send(new PutCommand({ Entries: entries.map((each) => each) }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(['stopped at entries.map((each) => each)']);
  });

  it('stops at a spread element of a list', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [...more] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(['stopped at ...more']);
  });

  // A spread may be where the key comes from, so the key is not absent: calling
  // it absent would let a description fill in a default for a value written
  // somewhere else.
  it('stops at a spread written after the key could have been', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [{ ...defaults }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(['stopped at defaults']);
  });

  it('reads a key written after a spread, which wins', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [{ ...defaults, DetailType: 'LoanCreated' }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads a quoted key as the key it spells', () => {
    const file = parse(`client.send(new PutCommand({ 'Entries': [{ "DetailType": 'LoanCreated' }] }));`);
    expect(slots(callTo(file, 'send'), DETAIL_TYPE)).toEqual(["'LoanCreated'"]);
  });

  it('reads a later argument of the constructor', () => {
    const file = parse(`bus.put(new LibraryEvent('library.loans', { type: 'LoanCreated' }));`);
    expect(
      slots(callTo(file, 'put'), { kind: 'constructed-argument-path', class: 'LibraryEvent', index: 1, path: ['type'] }),
    ).toEqual(["'LoanCreated'"]);
  });

  it('reads the constructor argument itself when the path is empty', () => {
    const file = parse(`bus.put(new LibraryEvent('LoanCreated'));`);
    expect(
      slots(callTo(file, 'put'), { kind: 'constructed-argument-path', class: 'LibraryEvent', path: [] }),
    ).toEqual(["'LoanCreated'"]);
  });

  it('reads nothing written when the constructor is given nothing', () => {
    const file = parse(`bus.put(new LibraryEvent());`);
    expect(
      slots(callTo(file, 'put'), { kind: 'constructed-argument-path', class: 'LibraryEvent', path: ['type'] }),
    ).toEqual([undefined]);
  });
});

describe('a path through a plain argument', () => {
  it('reads it the same way', () => {
    const file = parse(`client.putEvents({ Entries: [{ DetailType: 'LoanRenewed' }] });`);
    expect(
      slots(callTo(file, 'putEvents'), { kind: 'argument-path', index: 0, path: ['Entries', '*', 'DetailType'] }),
    ).toEqual(["'LoanRenewed'"]);
  });

  it('reaches nothing when the argument is not there', () => {
    const file = parse(`client.putEvents();`);
    expect(slots(callTo(file, 'putEvents'), { kind: 'argument-path', index: 0, path: ['Entries'] })).toEqual([]);
  });

  it('stops at an argument that is not a record', () => {
    const file = parse(`client.putEvents(input);`);
    expect(slots(callTo(file, 'putEvents'), { kind: 'argument-path', index: 0, path: ['Entries'] })).toEqual([
      'stopped at input',
    ]);
  });

  it('hands every element to the first-match reading as well', () => {
    const file = parse(`client.send(new PutCommand({ Entries: [{ DetailType: 'A' }, { DetailType: 'B' }] }));`);
    expect(locatedExpressions(callTo(file, 'send'), [DETAIL_TYPE]).map((node) => node.getText())).toEqual([
      "'A'",
      "'B'",
    ]);
  });
});

describe('a locator that names the class it reads', () => {
  const PUT: NameLocator = { kind: 'constructed-argument-path', class: 'PutCommand', path: ['Name'] };

  it('applies to a call handed that class', () => {
    const file = parse(`client.send(new PutCommand({ Name: 'a' }));`);
    expect(locatorApplies(callTo(file, 'send'), PUT)).toBe(true);
  });

  it('does not apply to a call handed another, and reaches nothing there', () => {
    const file = parse(`client.send(new ReceiveCommand({ Name: 'a' }));`);
    expect(locatorApplies(callTo(file, 'send'), PUT)).toBe(false);
    expect(locatedSlots(callTo(file, 'send'), PUT)).toEqual([]);
  });

  // Of the shape, with its address not written here: the caller reports it,
  // rather than reading the call as some other operation.
  it('applies to a value the checker says is one, and stops at it', () => {
    const file = parse(`class PutCommand { constructor(readonly input: { Name: string }) {} }
const forward = (command: PutCommand) => client.send(command);`);
    const site = callTo(file, 'send');
    expect(locatorApplies(site, PUT)).toBe(true);
    expect(slots(site, PUT)).toEqual(['stopped at command']);
  });

  // With nothing installed the checker knows no such class, and the annotation
  // is the one statement left of what the value is.
  it('applies to a value annotated with the class when the class is declared nowhere', () => {
    const file = parse(`const forward = (command: sdk.PutCommand) => client.send(command);`);
    const site = callTo(file, 'send');
    expect(locatorApplies(site, PUT)).toBe(true);
    expect(slots(site, PUT)).toEqual(['stopped at command']);
  });

  it('applies everywhere for every other kind of locator', () => {
    const file = parse(`client.send('a');`);
    expect(locatorApplies(callTo(file, 'send'), { kind: 'argument', index: 0 })).toBe(true);
  });
});

describe('a key of every node of a tree, and records built further in (P286)', () => {
  const QUEUES: NameLocator = { kind: 'argument-tree', index: 0, key: 'queueName', children: 'children' };

  it('reads the root first and each child after its parent', () => {
    const file = parse(`flows.add({ queueName: 'close', children: [
  { queueName: 'archive', children: [{ queueName: 'compress' }] },
  { queueName: 'notify' },
] });`);
    expect(slots(callTo(file, 'add'), QUEUES)).toEqual(["'close'", "'archive'", "'compress'", "'notify'"]);
  });

  it('reads each tree of a list, and stops at a list of children not written out', () => {
    const file = parse(`declare const later: unknown[];
flows.addBulk([{ queueName: 'a' }, { queueName: 'b', children: later }]);`);
    expect(slots(callTo(file, 'addBulk'), { ...QUEUES, path: ['*'] })).toEqual(["'a'", "'b'", 'stopped at later']);
  });

  it('reads a key through a record spread in from what a method of the class builds', () => {
    const file = parse(`class Jobs {
  run(type: string) { return flows.add({ ...this.node(type), children: [] }); }
  private node(kind: string) { return { name: 'job', queueName: kind }; }
}`);
    // The method's parameter is what the call hands it: `run`'s own `type`.
    expect(slots(callTo(file, 'add'), QUEUES)).toEqual(['type']);
  });

  it('reads a queue made by a class a condition chooses, set in another method', () => {
    const file = parse(`class Client {
  private queue: Queue;
  open(topic: string) {
    const Made = paid ? PaidQueue : Queue;
    this.queue = new Made(topic);
  }
  add(job: string) { return this.queue.add(job); }
}`);
    expect(slots(callTo(file, 'add'), { kind: 'receiver-constructed-path', class: 'Queue', path: [] })).toEqual(['topic']);
  });

  it('reads a queue a field is declared with, with or without modifiers, static through the class (P308)', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const kept = parse(`class Mailer {
  private readonly queue = new Queue('emails');
  send(job: string) { return this.queue.add(job); }
}`);
    expect(slots(callTo(kept, 'add'), MADE)).toEqual(["'emails'"]);
    const bare = parse(`class Mailer {
  queue = new Queue('emails');
  send(job: string) { return this.queue.add(job); }
}`);
    expect(slots(callTo(bare, 'add'), MADE)).toEqual(["'emails'"]);
    const shared = parse(`class Reports {
  static readonly queue = new Queue('reports');
  static daily() { return Reports.queue.add('daily'); }
}`);
    expect(slots(callTo(shared, 'add'), MADE)).toEqual(["'reports'"]);
    const inStatic = parse(`class Reports {
  static queue = new Queue('reports');
  static daily() { return this.queue.add('daily'); }
}`);
    expect(slots(callTo(inStatic, 'add'), MADE)).toEqual(["'reports'"]);
  });

  it('does not read a declared value a field is given another value beside, or changed in place', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const reset = parse(`class Mailer {
  private queue = new Queue('emails');
  constructor(name: string) { this.queue = new Queue(name); }
  send(job: string) { return this.queue.add(job); }
}`);
    expect(slots(callTo(reset, 'add'), MADE)).toEqual(['stopped at this.queue']);
    const swapped = parse(`class Mailer {
  private queue = new Queue('emails');
  private spare = new Queue('spare');
  swap() { [this.queue, this.spare] = [this.spare, this.queue]; }
  send(job: string) { return this.queue.add(job); }
}`);
    expect(slots(callTo(swapped, 'add'), MADE)).toEqual(['stopped at this.queue']);
  });

  it('reads a static field another module writes once, and none it writes twice (P316)', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('queues.ts', 'export class Queues { static mail: Queue; static audit: Queue; }');
    project.createSourceFile('setup.ts', `import { Queues } from './queues';
export const setup = () => { Queues.mail = new Queue('mail'); Queues.audit = new Queue('audit'); };
export const reset = () => { Queues.audit = new Queue('audit-2'); };`);
    const user = project.createSourceFile('user.ts', `import { Queues } from './queues';
export const welcome = () => Queues.mail.add('welcome');
export const audit = () => Queues.audit.add('entry');`);
    const [mail, audit] = user.getDescendantsOfKind(SyntaxKind.CallExpression);
    expect(slots(mail as CallExpression, MADE)).toEqual(["'mail'"]);
    expect(slots(audit as CallExpression, MADE)).toEqual(['stopped at Queues.audit']);
  });

  it('reads a field a base class declares, sets or keeps from super(...) in a class extending it (P316)', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const declared = parse(`class Base { protected queue = new Queue('base'); }
class Mailer extends Base { send(job: string) { return this.queue.add(job); } }`);
    expect(slots(callTo(declared, 'add'), MADE)).toEqual(["'base'"]);
    const set = parse(`class Base { protected queue: Queue; constructor() { this.queue = new Queue('set'); } }
class Mailer extends Base { send(job: string) { return this.queue.add(job); } }`);
    expect(slots(callTo(set, 'add'), MADE)).toEqual(["'set'"]);
    const handed = parse(`class Base { constructor(protected queue: Queue) {} }
class Middle extends Base { constructor(made: Queue) { super(made); } }
class Mailer extends Middle { constructor() { super(new Queue('handed')); } send(job: string) { return this.queue.add(job); } }`);
    expect(slots(callTo(handed, 'add'), MADE)).toEqual(["'handed'"]);
    const kept = parse(`class Base { protected queue: Queue; constructor(queue: Queue) { this.queue = queue; } }
class Mailer extends Base { constructor() { super(new Queue('kept')); } send(job: string) { return this.queue.add(job); } }`);
    expect(slots(callTo(kept, 'add'), MADE)).toEqual(["'kept'"]);
    // Taken by the class itself: whoever builds it decides, as before.
    const own = parse(`class Base { constructor(protected queue: Queue) {} }
class Mailer extends Base { send(job: string) { return this.queue.add(job); } }`);
    expect(slots(callTo(own, 'add'), MADE)).toEqual(['stopped at this.queue']);
    // Set again in the class extending it: two values.
    const reset = parse(`class Base { protected queue = new Queue('base'); }
class Mailer extends Base { open() { this.queue = new Queue('other'); } send(job: string) { return this.queue.add(job); } }`);
    expect(slots(callTo(reset, 'add'), MADE)).toEqual(['stopped at this.queue']);
  });

  it('counts a static field written through the class under any - an alias, an assertion, a parameter (P322)', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const read = (setup: string): (string | undefined)[] => {
      const project = new Project({ useInMemoryFileSystem: true });
      project.createSourceFile('queues.ts', "export class Queues { static mail: Queue = new Queue('mail'); }");
      project.createSourceFile('setup.ts', `import { Queues } from './queues';\n${setup}`);
      const user = project.createSourceFile('user.ts', "import { Queues } from './queues';\nexport const welcome = () => Queues.mail.add('welcome');");
      return slots(user.getDescendantsOfKind(SyntaxKind.CallExpression)[0] as CallExpression, MADE);
    };
    expect(read('export const nothing = 1;')).toEqual(["'mail'"]);
    for (const setup of [
      "const R: any = Queues;\nexport const reset = () => { R.mail = new Queue('other'); };",
      "const R: any = Queues;\nconst again = R;\nexport const reset = () => { again['mail'] = new Queue('other'); };",
      "let R: any;\nR = Queues;\nexport const reset = () => { R.mail = new Queue('other'); };",
      "export const reset = () => { (Queues as any).mail = new Queue('other'); };",
      "const fill = (target: any) => { target.mail = new Queue('other'); };\nexport const reset = () => fill(Queues);",
      "const R: any = Queues;\nexport const reset = () => { R.mail += 1; };",
    ]) {
      expect(read(setup)).toEqual(['stopped at Queues.mail']);
    }
    // One write through an alias, and no initializer: that write is the value.
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('queues.ts', 'export class Queues { static mail: Queue; }');
    project.createSourceFile('setup.ts', "import { Queues } from './queues';\nconst R: any = Queues;\nexport const setup = () => { R.mail = new Queue('aliased'); };");
    const user = project.createSourceFile('user.ts', "import { Queues } from './queues';\nexport const welcome = () => Queues.mail.add('welcome');");
    expect(slots(user.getDescendantsOfKind(SyntaxKind.CallExpression)[0] as CallExpression, MADE)).toEqual(["'aliased'"]);
  });

  it('reads a static field through what stands for its class under any, and by a key (P328)', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const read = (user: string, setup = 'export const nothing = 1;'): (string | undefined)[] => {
      const project = new Project({ useInMemoryFileSystem: true });
      project.createSourceFile('queues.ts', "export class Queues { static mail: Queue = new Queue('mail'); }\nexport class Other { static mail: Queue = new Queue('other'); }");
      project.createSourceFile('setup.ts', `import { Queues } from './queues';\n${setup}`);
      const file = project.createSourceFile('user.ts', `import { Queues, Other } from './queues';\n${user}`);
      return slots(callTo(file, 'add'), MADE);
    };
    for (const user of [
      "const R: any = Queues;\nexport const welcome = () => R.mail.add('welcome');",
      "const R = Queues;\nconst again: any = R;\nexport const welcome = () => again.mail.add('welcome');",
      "let R: any;\nR = Queues;\nexport const welcome = () => R.mail.add('welcome');",
      "export const welcome = () => (Queues as any).mail.add('welcome');",
      "const R: any = Queues;\nexport const welcome = () => R['mail'].add('welcome');",
      "const KEY = 'mail';\nexport const welcome = () => Queues[KEY].add('welcome');",
      "const send = (target: any) => target.mail.add('welcome');\nexport const welcome = () => send(Queues);",
      "function send(target: any = Queues) { return target.mail.add('welcome'); }\nexport const welcome = () => send();",
    ]) {
      expect(read(user)).toEqual(["'mail'"]);
    }
    // A parameter handed something not a class is not a field; one handed two classes is either's (P332).
    expect(read("const send = (target: any) => target.mail.add('welcome');\nexport const a = () => send(Queues);\nexport const b = () => send(Other);")).toEqual(["'mail'", "'other'"]);
    expect(read("const send = (target: any) => target.mail.add('welcome');\nexport const a = () => send(Queues);\nexport const b = () => send({ mail: null });")).toEqual(['stopped at target.mail']);
    // A read through an alias sees every write, through an alias or not.
    expect(read("const R: any = Queues;\nexport const welcome = () => R.mail.add('welcome');", "export const reset = () => { Queues.mail = new Queue('reset'); };")).toEqual(['stopped at R.mail']);
    expect(read("export const welcome = () => Queues.mail.add('welcome');", "const KEY = 'mail';\nexport const reset = () => { Queues[KEY] = new Queue('reset'); };")).toEqual(['stopped at Queues.mail']);
    expect(read("export const welcome = () => Queues.mail.add('welcome');", "export const reset = (key: string) => { (Queues as any)[key] = new Queue('reset'); };")).toEqual(['stopped at Queues.mail']);
  });

  it("counts a field written as this['queue'] or this[KEY], and one written by a key not read as changed (P328)", () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const reader = "send(job: string) { return this.queue.add(job); }";
    expect(slots(callTo(parse(`class Mailer { queue = new Queue('base'); open() { this['queue'] = new Queue('other'); } ${reader} }`), 'add'), MADE)).toEqual(['stopped at this.queue']);
    expect(slots(callTo(parse(`const KEY = 'queue';\nclass Mailer { queue = new Queue('base'); open() { this[KEY] = new Queue('other'); } ${reader} }`), 'add'), MADE)).toEqual(['stopped at this.queue']);
    expect(slots(callTo(parse(`class Mailer { queue: Queue; open() { this['queue'] = new Queue('only'); } ${reader} }`), 'add'), MADE)).toEqual(["'only'"]);
    expect(slots(callTo(parse(`class Mailer { queue = new Queue('base'); set(key: string, value: Queue) { (this as any)[key] = value; } ${reader} }`), 'add'), MADE)).toEqual(['stopped at this.queue']);
    // Another key, written out, leaves it as it was; a read by a key is the field.
    expect(slots(callTo(parse(`class Mailer { queue = new Queue('base'); other = 1; open() { this['other'] = 2; } ${reader} }`), 'add'), MADE)).toEqual(["'base'"]);
    expect(slots(callTo(parse("class Mailer { queue = new Queue('base'); send(job: string) { return this['queue'].add(job); } }"), 'add'), MADE)).toEqual(["'base'"]);
    // A static field written through `this` in a static member by a key.
    expect(slots(callTo(parse("class Queues { static mail = new Queue('mail'); static reset() { this['mail'] = new Queue('reset'); } }\nexport const welcome = () => Queues.mail.add('welcome');"), 'add'), MADE)).toEqual(['stopped at Queues.mail']);
  });

  it('counts each key Object.assign lays over this or over the class as a write of the field (P332)', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const reader = 'send(job: string) { return this.queue.add(job); }';
    const read = (source: string): (string | undefined)[] => slots(callTo(parse(source), 'add'), MADE);
    expect(read(`class Mailer { queue: Queue; constructor() { Object.assign(this, { queue: new Queue('assigned') }); } ${reader} }`)).toEqual(["'assigned'"]);
    expect(read(`class Mailer { queue = new Queue('base'); open() { Object.assign(this, { queue: new Queue('other') }); } ${reader} }`)).toEqual(['stopped at this.queue']);
    expect(read(`class Mailer { queue = new Queue('base'); open() { Object.assign(this, { other: 1 }, null); } ${reader} }`)).toEqual(["'base'"]);
    // The last source that surely writes the key hides those before it.
    expect(read(`const defaults = { queue: new Queue('first') };\nclass Mailer { queue: Queue; constructor() { Object.assign(this, defaults, { queue: new Queue('last') }); } ${reader} }`)).toEqual(["'last'"]);
    // A source handed in is what each caller hands, each new for a constructor's.
    expect(read(`class Mailer { queue: Queue; configure(options: { queue: Queue }) { Object.assign(this, options); } ${reader} }\nnew Mailer().configure({ queue: new Queue('configured') });`)).toEqual(["'configured'"]);
    expect(read(`class Mailer { queue!: Queue; constructor(options: { queue: Queue }) { Object.assign(this, options); } ${reader} }\nnew Mailer({ queue: new Queue('built') });`)).toEqual(["'built'"]);
    expect(read(`class Mailer { queue!: Queue; constructor(options: { queue: Queue }) { Object.assign(this, options); } ${reader} }\nnew Mailer({ queue: new Queue('a') });\nnew Mailer({ queue: new Queue('b') });`)).toEqual(['stopped at this.queue']);
    expect(read(`class Mailer { queue!: Queue; constructor(queue: Queue) { Object.assign(this, { queue }); } ${reader} }\nnew Mailer(new Queue('kept'));`)).toEqual(['stopped at this.queue']);
    // A source not read may write any field, as a write by a key not read may.
    expect(read(`class Mailer { queue = new Queue('base'); open() { Object.assign(this, JSON.parse(text)); } ${reader} }`)).toEqual(['stopped at this.queue']);
    expect(read(`class Mailer { queue = new Queue('base'); open(options: any) { Object.assign(this, options); } ${reader} }`)).toEqual(['stopped at this.queue']);
    // A static field: through the class, what stands for it, and this in a static member.
    for (const setup of [
      "Object.assign(Queues, { mail: new Queue('assigned') });",
      "const R: any = Queues;\nObject.assign(R, { mail: new Queue('assigned') });",
      "const fill = (target: any) => Object.assign(target, { mail: new Queue('assigned') });\nfill(Queues);",
    ]) {
      expect(read(`class Queues { static mail: Queue; static audit = new Queue('audit'); }\n${setup}\nexport const welcome = () => Queues.mail.add('welcome');`)).toEqual(["'assigned'"]);
    }
    expect(read("class Queues { static mail: Queue; static setup() { Object.assign(this, { mail: new Queue('assigned') }); } }\nexport const welcome = () => Queues.mail.add('welcome');")).toEqual(["'assigned'"]);
    expect(read("class Queues { static mail = new Queue('mail'); }\nObject.assign(Queues, { audit: 1 });\nexport const welcome = () => Queues.mail.add('welcome');")).toEqual(["'mail'"]);
    expect(read("class Queues { static mail = new Queue('mail'); }\nObject.assign(Queues, loaded());\nexport const welcome = () => Queues.mail.add('welcome');")).toEqual(['stopped at Queues.mail']);
    // The queue a field holds changed in place is not the field written.
    expect(read("class Queues { static mail = new Queue('mail'); }\nObject.assign(Queues.mail, { mail: 1 });\nexport const welcome = () => Queues.mail.add('welcome');")).toEqual(["'mail'"]);
  });

  it('reads a read through a name that may stand for two classes as either class\'s own field, saying which (P332)', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const read = (extra: string): { text?: string; heldIn?: string }[] => {
      const file = parse(`class Queues { static mail = new Queue('mail'); }
class Archive { static mail = new Queue('archive'); }
${extra}
const send = (target: any) => target.mail.add('welcome');
export const a = () => send(Queues);
export const b = () => send(Archive);`);
      return locatedSlots(callTo(file, 'add'), MADE).map((slot) => ({
        ...(slot === undefined ? {} : { text: `${slot.reached ? '' : 'stopped at '}${slot.expression.getText()}` }),
        ...(slot?.heldIn === undefined ? {} : { heldIn: slot.heldIn }),
      }));
    };
    expect(read('')).toEqual([
      { text: "'mail'", heldIn: 'Queues.mail' },
      { text: "'archive'", heldIn: 'Archive.mail' },
    ]);
    // A field given two values is that field, not read further.
    expect(read("export const reset = () => { Archive.mail = new Queue('again'); };")).toEqual([
      { text: "'mail'", heldIn: 'Queues.mail' },
      { text: 'stopped at mail', heldIn: 'Archive.mail' },
    ]);
    // Two classes sharing one field a base declares: that field, as before.
    const shared = parse(`class Base { static mail = new Queue('base'); }
class Queues extends Base {}
class Archive extends Base {}
const send = (target: any) => target.mail.add('welcome');
export const a = () => send(Queues);
export const b = () => send(Archive);`);
    expect(slots(callTo(shared, 'add'), MADE)).toEqual(["'base'"]);
  });

  it('counts what a class extending the reader sets, where its instances run the reading member (P322)', () => {
    const MADE: NameLocator = { kind: 'receiver-constructed-path', class: 'Queue', path: [] };
    const sets = parse(`class Mailer { protected queue = new Queue('base'); send(job: string) { return this.queue.add(job); } }
class Urgent extends Mailer { open() { this.queue = new Queue('urgent'); } }`);
    expect(slots(callTo(sets, 'add'), MADE)).toEqual(['stopped at this.queue']);
    const deeper = parse(`class Base { protected queue: Queue; }
class Mailer extends Base { send(job: string) { return this.queue.add(job); } }
class Middle extends Mailer {}
class Urgent extends Middle { queue = new Queue('urgent'); }
class Other extends Base { open() { this.queue = new Queue('other'); } }`);
    expect(slots(callTo(deeper, 'add'), MADE)).toEqual(["'urgent'"]);
    const taken = parse(`class Mailer { protected queue = new Queue('base'); send(job: string) { return this.queue.add(job); } }
class Urgent extends Mailer { constructor(protected queue: Queue) { super(); } }`);
    expect(slots(callTo(taken, 'add'), MADE)).toEqual(['stopped at this.queue']);
    // The class below declares the reading member again and never calls it: its writes are never read there.
    const overridden = parse(`class Mailer { protected queue = new Queue('base'); send(job: string) { return this.queue.add(job); } }
class Urgent extends Mailer { open() { this.queue = new Queue('urgent'); } send(job: string) { return this.queue.add(job, { lifo: true }); } }`);
    expect(slots(callTo(overridden, 'add'), MADE)).toEqual(["'base'"]);
    const calledBack = parse(`class Mailer { protected queue = new Queue('base'); send(job: string) { return this.queue.add(job); } }
class Urgent extends Mailer { open() { this.queue = new Queue('urgent'); } send(job: string) { return super.send(job); } }`);
    expect(slots(callTo(calledBack, 'add'), MADE)).toEqual(['stopped at this.queue']);
  });

  it('reads each record a function may answer, awaited', () => {
    const file = parse(`async function build(kind: boolean) {
  if (kind) return { type: 'a' };
  return { type: 'b' };
}
async function run() { queue.send(await build(true)); }`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(["'a'", "'b'"]);
  });
});

describe('a tree built in a loop, lists filled by push, an element by its place (P290)', () => {
  const QUEUES: NameLocator = { kind: 'argument-tree', index: 0, key: 'queueName', children: 'children' };

  it('reads a tree a let holds, reassigned in a loop, once for each record it is given', () => {
    const file = parse(`function chain(...jobs: { type: string }[]) {
  let last;
  for (const job of jobs) {
    last = { name: 'job', queueName: job.type, children: last ? [last] : [] };
  }
  return flows.add(last);
}`);
    // The child is the record the loop built before: read once, not again under itself.
    expect(slots(callTo(file, 'add'), QUEUES)).toEqual(['job.type']);
  });

  it('reads each value a let is given, and not one also changed in place', () => {
    const given = parse(`let kind = 'a';
if (later) kind = 'b';
queue.send([kind]);`);
    expect(slots(callTo(given, 'send'), { kind: 'argument-path', index: 0, path: ['*'] })).toEqual(['kind']);
    const counted = parse(`let kind = 'a';
kind += 'b';
queue.send({ type: kind });`);
    expect(slots(callTo(counted, 'send'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(['kind']);
    const chosen = parse(`let record = { type: 'a' };
if (later) record = { type: 'b' };
queue.send(record);`);
    expect(slots(callTo(chosen, 'send'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(["'a'", "'b'"]);
    const changed = parse(`let record = { type: 'a' };
[record] = others;
queue.send(record);`);
    expect(slots(callTo(changed, 'send'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(['stopped at record']);
  });

  it('reads the elements a list is written with and those pushed onto it, spread lists included', () => {
    const file = parse(`function more() { return [{ type: 'c' }]; }
const jobs = [{ type: 'a' }];
jobs.push({ type: 'b' });
jobs.push(...more());
queue.send(jobs);`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['*', 'type'] })).toEqual(["'a'", "'b'", "'c'"]);
  });

  it('reads every list a method may answer spread into a list, one it fills with push included', () => {
    const file = parse(`class OrderUpdater {
  private receipts(changed: boolean) {
    const jobs = [];
    if (changed) jobs.push({ type: 'receipt' });
    return jobs;
  }
  private notices(any: boolean) {
    if (!any) return [];
    return [{ type: 'notice' }];
  }
  run() {
    const jobs = [];
    jobs.push(...this.receipts(true));
    jobs.push(...this.notices(false));
    queue.send(jobs);
  }
}`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['*', 'type'] })).toEqual(["'receipt'", "'notice'"]);
  });

  it('reads the children of a flow mapped by a method, each child as the method builds it', () => {
    const file = parse(`class Jobs {
  run(parent: { type: string }, children: { type: string }[]) {
    return flows.add({ ...this.node(parent), children: children.map((child) => this.node(child)) });
  }
  private node(job: { type: string }) { return { name: 'job', queueName: job.type }; }
}`);
    expect(slots(callTo(file, 'add'), QUEUES)).toEqual(['job.type', 'job.type']);
  });

  it('reads each branch of a condition a list is chosen by, a list of none none', () => {
    const file = parse(`queue.send(urgent ? [{ type: 'a' }, { type: 'b' }] : []);`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['*', 'type'] })).toEqual(["'a'", "'b'"]);
  });

  it('reads an element by its place, where nothing spread in before it moves it', () => {
    const file = parse(`queue.send([{ type: 'a' }, { type: 'b' }]);`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['1', 'type'] })).toEqual(["'b'"]);
  });

  it('reads one of the elements at a place a spread or a push may move, and none past the end of a list written whole (P298)', () => {
    const file = parse(`queue.publish([...others, { type: 'b' }]);
const later = [];
later.push({ type: 'c' });
queue.send(later);
queue.emit([{ type: 'a' }]);`);
    expect(slots(callTo(file, 'publish'), { kind: 'argument-path', index: 0, path: ['1', 'type'] })).toEqual(['stopped at ...others', "'b'"]);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['0', 'type'] })).toEqual(["'c'"]);
    expect(slots(callTo(file, 'emit'), { kind: 'argument-path', index: 0, path: ['1', 'type'] })).toEqual([]);
  });

  it('reads a key of a record a function answers through a const destructuring, each answer on its own (P298)', () => {
    const file = parse(`function plan(jobs) {
  if (jobs.length === 0) return { now: [], later: [] };
  return { now: jobs, later: [{ type: 'held' }] };
}
const { later } = plan([{ type: 'a' }]);
queue.send(later);`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['0', 'type'] })).toEqual(["'held'"]);
  });

  it('reads the argument a property falls back to where the object written out has no such key, or none is handed (P298)', () => {
    const file = parse(`queue.send('nightly', { every: 1 }, { data: {} });
queue.emit('hourly', { every: 1 });
queue.publish('weekly', { every: 1 }, { name: 'digest' });
queue.write('monthly', { every: 1 }, template);
queue.store('yearly', { every: 1 }, { ...template });`);
    const NAME = { kind: 'argument-property', index: 2, key: 'name', otherwise: 0 } as const;
    expect(slots(callTo(file, 'send'), NAME)).toEqual(["'nightly'"]);
    expect(slots(callTo(file, 'emit'), NAME)).toEqual(["'hourly'"]);
    expect(slots(callTo(file, 'publish'), NAME)).toEqual(["'digest'"]);
    expect(slots(callTo(file, 'write'), NAME)).toEqual([]);
    expect(slots(callTo(file, 'store'), NAME)).toEqual([]);
  });

  it('reads a field an instance written out keeps from its constructor, and a value a Map is given (P298)', () => {
    const file = parse(`class Refused extends Error {
  constructor(public readonly jobs: { type: string }[], reason: string) { super(reason); }
}
const byId = new Map();
byId.set('a', { type: 'mapped' });
queue.send(new Refused([{ type: 'kept' }], 'no'));
queue.emit(byId.get(key));`);
    expect(slots(callTo(file, 'send'), { kind: 'argument-path', index: 0, path: ['jobs', '0', 'type'] })).toEqual(["'kept'"]);
    expect(slots(callTo(file, 'emit'), { kind: 'argument-path', index: 0, path: ['type'] })).toEqual(["'mapped'"]);
  });
});

/**
 * The record `Object.assign` answers, and a record a parameter spreads in
 * (P299): each key the last source that writes it, a parameter writing a
 * key only where a caller hands it one.
 */
describe('a record put together from others (P299)', () => {
  const TABLE: NameLocator = { kind: 'argument-path', index: 0, path: ['TableName'] };
  const puts = (file: SourceFile): CallExpression[] =>
    file.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => call.getExpression().getText().endsWith('.putItem'));

  it('reads a key of the literal where no caller hands the parameter after it the key', () => {
    const file = parse(`class Store {
  save(table: string, item: object, extra?: object) {
    const params = Object.assign({ TableName: table, Item: item }, extra);
    return this.client.putItem(params);
  }
}
class Log extends Store {
  append(item: object) { return super.save('log', item, { ConditionExpression: 'attribute_not_exists(id)' }); }
  other(item: object) { return super.save('log', item); }
  third(item: object) { return super.save('log', item, undefined); }
}`);
    expect(slots(callTo(file, 'putItem'), TABLE)).toEqual(['table']);
  });

  it('stops at the parameter where a caller hands it the key, or a value not written out, or nothing calls it', () => {
    const file = parse(`declare const options: object;
function save(table: string, extra?: object) {
  return client.putItem(Object.assign({ TableName: table }, extra));
}
save('a', { TableName: 'b' });
function put(table: string, extra?: object) {
  return client.putItem(Object.assign({ TableName: table }, extra));
}
put('a', options);
function uncalled(table: string, extra?: object) {
  return client.putItem(Object.assign({ TableName: table }, extra));
}`);
    expect(puts(file).map((call) => slots(call, TABLE))).toEqual([['stopped at extra'], ['stopped at extra'], ['stopped at extra']]);
  });

  it('reads a key the last source writes, a source of nothing nothing', () => {
    const file = parse(`client.putItem(Object.assign({}, { TableName: 'first' }, null, { TableName: 'last' }, { Item: {} }));`);
    expect(slots(callTo(file, 'putItem'), TABLE)).toEqual(["'last'"]);
  });

  it('reads past a parameter spread in that no caller hands the key', () => {
    const file = parse(`function save(table: string, extra: object = {}) {
  return client.putItem({ TableName: table, ...extra });
}
save('a', { ReturnValues: 'NONE' });
save('b');`);
    expect(slots(callTo(file, 'putItem'), TABLE)).toEqual(['table']);
  });
});
