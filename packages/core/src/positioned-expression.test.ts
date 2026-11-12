import { Node, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { readExpressionDocument, UnreadMember } from './positioned-expression.js';
import { exportKey, generatedName, importedName, isGeneratedName, isImportedName, makeUnnamedInvokeKey, makeUnnamedWorkflowKey, stackOutputKey, wasRead } from './ids.js';
import { parseConfig } from './config.js';

/** The object a file exports with `module.exports =`, read as a document. */
const documentOf = (files: Record<string, string>) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
  const source = project.getSourceFileOrThrow('/service.ts');
  const statement = source.getStatements().find((node) => Node.isExpressionStatement(node));
  const expression = statement !== undefined && Node.isExpressionStatement(statement) ? statement.getExpression() : undefined;
  if (expression === undefined || !Node.isBinaryExpression(expression)) throw new Error('no export');
  return readExpressionDocument(expression.getRight());
};

describe('a TypeScript literal read as a document (P57)', () => {
  it('reads literals, templates, constants, imports and spreads, with a line for each member', () => {
    const document = documentOf({
      '/functions.ts': "const HANDLERS = 'src';\nconst join = { handler: `${HANDLERS}/join.handler` };\nexport const functions = { join, ...{ renew: { handler: 'src/renew.handler' } } };\n",
      '/service.ts': [
        "import { functions } from './functions';",
        "const SERVICE = 'accounts';",
        'module.exports = {',
        '  service: SERVICE,',
        "  provider: { name: 'cloud', stage: \"${opt:stage, 'dev'}\" },",
        '  functions,',
        '  timeout: -3,',
        '};',
      ].join('\n'),
    });
    expect(document.value).toEqual({
      service: 'accounts',
      provider: { name: 'cloud', stage: "${opt:stage, 'dev'}" },
      functions: { join: { handler: 'src/join.handler' }, renew: { handler: 'src/renew.handler' } },
      timeout: -3,
    });
    expect(document.at(['provider', 'name'])?.line).toBe(5);
    expect(document.at(['functions'])?.line).toBe(6);
    // A member written in another file is placed where it is brought in.
    expect(document.at(['functions', 'join'])).toBeUndefined();
  });

  it('keeps a member that is not written out in its place, and its siblings with it', () => {
    const document = documentOf({ '/service.ts': "module.exports = { name: 'cloud', region: process.env.REGION, list: [1, compute()] };" });
    const value = document.value as Record<string, unknown>;
    expect(value['name']).toBe('cloud');
    expect(value['region']).toBeInstanceOf(UnreadMember);
    expect((value['list'] as unknown[])[0]).toBe(1);
    expect((value['list'] as unknown[])[1]).toBeInstanceOf(UnreadMember);
  });
});

describe('a name the platform generates (P57)', () => {
  it('is stood in for by its declaration, as an unnamed function is keyed', () => {
    expect(generatedName('resources.Resources.NoticesQueue')).toBe(makeUnnamedInvokeKey('resources.Resources.NoticesQueue'));
    expect(isGeneratedName(generatedName('ClubStack/Inbox'))).toBe(true);
    expect(isGeneratedName('club-inbox')).toBe(false);
  });

  it('spells a path and a site with dots, which a channel name and an ARN can carry', () => {
    expect(generatedName('ClubStack/Inbox')).toBe('${…}@ClubStack.Inbox');
    expect(makeUnnamedWorkflowKey('ClubStack/lib/club-stack.ts:54')).toBe('${…}@ClubStack.lib.club-stack.ts.54');
    // An address with neither keeps its spelling, so no key read before changes.
    expect(makeUnnamedInvokeKey('aws_lambda_function.route["connect"]')).toBe('${…}@aws_lambda_function.route["connect"]');
  });
});

describe('a value another deployment publishes (P249)', () => {
  it('is keyed by its export name, or by its stack and its own name', () => {
    expect(exportKey('orders-placed-arn')).toBe('export:orders-placed-arn');
    expect(stackOutputKey('orders-prod', 'QueueUrl')).toBe('stack:orders-prod#QueueUrl');
  });

  it('is stood in for by its key, spelled to fit a channel name, and never taken for a deployed name', () => {
    expect(importedName(exportKey('orders:placed/arn'))).toBe('${…}@import.export.orders.placed.arn');
    expect(importedName(stackOutputKey('orders-prod', 'QueueUrl'))).toBe('${…}@import.stack.orders-prod.QueueUrl');
    expect(isImportedName(importedName(exportKey('x')))).toBe(true);
    expect(isImportedName(generatedName('ClubStack/Inbox'))).toBe(false);
    expect(wasRead(importedName(exportKey('x')))).toBe(false);
  });
});

describe('services[].infra.options (P57)', () => {
  it('holds the values a deployment is run with, and stays absent when not given', () => {
    const config = parseConfig({ services: [{ name: 'orders', repo: '.', type: 'functions', infra: { options: { stage: 'prod' } } }] });
    expect(config.services[0]?.infra).toEqual({ vars: [], options: { stage: 'prod' } });
    expect(parseConfig({ services: [{ name: 'orders', repo: '.', type: 'functions', infra: {} }] }).services[0]?.infra).toEqual({ vars: [] });
  });
});
