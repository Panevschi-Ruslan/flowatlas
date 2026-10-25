import { Node, Project, type CallExpression, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { causeOfUnresolvedType, whyNoClass, whyUntyped } from './follow-cause.js';

/**
 * One repository with one of each way a receiver ends up with no class. Only
 * `@lib/kit` is installed; `@shop/mailer` is not, `@app/*` is a path alias to
 * nowhere, and `./legacy` is a relative path with no file.
 */
const FILES: Record<string, string> = {
  'node_modules/@lib/kit/index.d.ts': 'export declare const loose: any;\nexport declare class Kit { run(): void }',
  'src/pricing/index.ts': "export { Pricing } from './pricing';",
  'src/pricing/pricing.ts': 'export class Pricing { quote(): number { return 1; } }',
  'src/logger.ts': "import { createLogger } from '@shop/logging';\nconst logger = createLogger('shop');\nexport default logger;",
  'src/rules.ts': 'export interface Rules { apply(n: number): number }',
  'src/use.ts': `
import { Mailer } from '@shop/mailer';
import { Audit } from '@app/audit';
import { Book } from './legacy';
import { Missing } from './pricing';
import { loose } from '@lib/kit';
import logger from './logger';
import type { Rules } from './rules';

export class Use {
  private readonly mail = new Mailer();
  private readonly audit = new Audit();
  private readonly book = new Book();
  private readonly missing = new Missing();
  private anything: any;
  private readonly table: Record<string, () => void> = {};

  run(rules: Rules, payload, items: string[] | number): void {
    this.mail.send();
    this.audit.record();
    this.book.render();
    this.missing.add();
    this.anything.flush();
    loose.go();
    logger.info();
    rules.apply(1);
    payload.ack();
    register((job) => job.done());
    JSON.parse('{}').walk();
    process.exit();
    (this.mail || null).close();
  }
}

declare function register(handler: Function): void;
`,
};

let file: SourceFile;

beforeAll(() => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/shared/*'] }, strict: false, types: [] },
  });
  for (const [path, text] of Object.entries(FILES)) project.createSourceFile(path, text);
  file = project.getSourceFileOrThrow('src/use.ts');
});

/** The receiver of the call whose text starts as given. */
const receiverOf = (start: string) => {
  const call = file
    .getDescendants()
    .find((node): node is CallExpression => Node.isCallExpression(node) && node.getText().startsWith(start));
  if (call === undefined) throw new Error(`no call ${start}`);
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) throw new Error(`not a member call: ${start}`);
  return callee.getExpression();
};

const owner = () => file.getClassOrThrow('Use');

describe('why a receiver names no class', () => {
  it.each([
    ['this.mail.send', { cause: 'module-not-installed', package: '@shop/mailer' }],
    ['this.audit.record', { cause: 'import-unresolved', package: '@app/audit' }],
    ['this.book.render', { cause: 'import-unresolved', package: './legacy' }],
    ['this.missing.add', { cause: 're-export-missing' }],
    ['this.anything.flush', { cause: 'any-typed' }],
    ['loose.go', { cause: 'any-typed', package: '@lib/kit' }],
    ['rules.apply', { cause: 'interface-type' }],
    ['payload.ack', { cause: 'untyped-parameter' }],
    ['job.done', { cause: 'callback-param' }],
    ["JSON.parse('{}').walk", { cause: 'language-any' }],
    ['process.exit', { cause: 'module-not-installed', package: '@types/node' }],
    ['(this.mail || null).close', { cause: 'module-not-installed', package: '@shop/mailer' }],
  ])('%s is %o', (start, expected) => {
    expect(whyNoClass(receiverOf(start), owner())).toEqual(expected);
  });

  it('follows a default export to the call that made it', () => {
    expect(whyNoClass(receiverOf('logger.info'), owner())).toEqual({
      cause: 'module-not-installed',
      package: '@shop/logging',
    });
  });

  it('says this means nothing in a function that belongs to no class', () => {
    const fn = file.getProject().createSourceFile('src/free.ts', 'export function f() { this.go(); }');
    const call = fn.getDescendants().find(Node.isCallExpression)!;
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) throw new Error('not a member call');
    expect(whyNoClass(callee.getExpression())).toEqual({ cause: 'this-outside-class' });
  });

  it('answers only for a value with no type', () => {
    expect(whyUntyped(receiverOf('rules.apply'))).toBeUndefined();
    expect(whyUntyped(receiverOf('payload.ack'))).toEqual({ cause: 'untyped-parameter' });
  });
});

describe('why a type did not resolve', () => {
  it('reads the import of the name the type text leads with', () => {
    const method = owner().getMethodOrThrow('run');
    expect(causeOfUnresolvedType(method, 'Mailer')).toEqual({ cause: 'module-not-installed', package: '@shop/mailer' });
    expect(causeOfUnresolvedType(method, 'Audit<string>')).toEqual({ cause: 'import-unresolved', package: '@app/audit' });
  });

  it('says nothing it cannot find', () => {
    expect(causeOfUnresolvedType(owner().getMethodOrThrow('run'), 'any')).toBeUndefined();
  });
});
