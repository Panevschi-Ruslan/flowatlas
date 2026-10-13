import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attributeOf, blocksOf, type Expression } from './ast.js';
import { HclSyntaxError, parseHcl, parseHclExpression, parseHclTemplate, templateText } from './parse.js';

const expr = (text: string): Expression => parseHclExpression(text);

describe('parseHcl: bodies', () => {
  it('keeps the line of every block and attribute', () => {
    const file = parseHcl(
      ['# leading comment', 'resource "aws_lambda_function" "loans" {', '  function_name = "loans"', '', '  environment {', '    variables = {}', '  }', '}'].join('\n'),
      'infra/main.tf',
    );
    const [block] = file.body.blocks;
    expect(block).toMatchObject({ type: 'resource', labels: ['aws_lambda_function', 'loans'], pos: { file: 'infra/main.tf', line: 2 } });
    expect(attributeOf(block!.body, 'function_name')?.pos.line).toBe(3);
    expect(blocksOf(block!.body, 'environment')[0]?.pos.line).toBe(5);
  });

  it('reads a block on one line, and labels written as names', () => {
    const file = parseHcl('locals { a = 1 }\nbackend s3 { bucket = "b" }\n', 'x.tf');
    expect(file.body.blocks.map((block) => [block.type, block.labels])).toEqual([
      ['locals', []],
      ['backend', ['s3']],
    ]);
  });

  it('keeps the expression of an attribute as written', () => {
    const file = parseHcl('a = var.x   # comment\n', 'x.tf');
    expect(file.body.attributes[0]?.source).toBe('var.x');
  });

  it('reads every kind of comment', () => {
    const file = parseHcl('// one\n# two\n/* three\n spans */ a = 1 /* inline */\n', 'x.tf');
    expect(file.body.attributes.map((attribute) => attribute.name)).toEqual(['a']);
  });

  it('refuses two items on one line, naming the place', () => {
    try {
      parseHcl('a = 1 b = 2\n', 'bad.tf');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HclSyntaxError);
      expect(error).toMatchObject({ file: 'bad.tf', line: 1 });
    }
  });

  it('refuses an unclosed block', () => {
    expect(() => parseHcl('resource "a" "b" {\n  x = 1\n', 'bad.tf')).toThrow(HclSyntaxError);
  });
});

describe('parseHclExpression', () => {
  it('reads traversals with names, indexes and the legacy dotted index', () => {
    const parsed = expr('aws_lambda_function.this[0].arn');
    expect(parsed).toMatchObject({
      type: 'traversal',
      source: { type: 'variable', name: 'aws_lambda_function' },
      steps: [{ kind: 'attr', name: 'this' }, { kind: 'index' }, { kind: 'attr', name: 'arn' }],
    });
    expect(expr('list.0.name')).toMatchObject({ steps: [{ kind: 'index' }, { kind: 'attr', name: 'name' }] });
  });

  it('reads both splats', () => {
    expect(expr('aws_instance.web[*].id')).toMatchObject({ type: 'splat', steps: [{ kind: 'attr', name: 'id' }] });
    expect(expr('var.list.*.name')).toMatchObject({ type: 'splat', steps: [{ kind: 'attr', name: 'name' }] });
  });

  it('binds operators by strength and reads a conditional', () => {
    expect(expr('a || b && c')).toMatchObject({ type: 'binary', operator: '||', right: { operator: '&&' } });
    expect(expr('1 + 2 * 3')).toMatchObject({ operator: '+', right: { operator: '*' } });
    expect(expr('a >= 1 ? "x" : "y"')).toMatchObject({ type: 'conditional', condition: { operator: '>=' } });
    expect(expr('!a')).toMatchObject({ type: 'unary', operator: '!' });
  });

  it('reads calls, a namespaced call and an expanded argument', () => {
    expect(expr('merge(local.a, {b = 1})')).toMatchObject({ type: 'call', name: 'merge', args: [{}, { type: 'object' }] });
    expect(expr('provider::aws::arn_parse(x)')).toMatchObject({ type: 'call', name: 'provider::aws::arn_parse' });
    expect(expr('concat(a...)')).toMatchObject({ type: 'call', expandFinal: true });
  });

  it('reads for expressions of both shapes, with a condition and grouping', () => {
    expect(expr('[for k, v in var.m : upper(v) if v != ""]')).toMatchObject({
      type: 'for',
      result: 'tuple',
      keyName: 'k',
      valueName: 'v',
      condition: { type: 'binary' },
    });
    expect(expr('{ for s in var.list : s.key => s.value... }')).toMatchObject({ type: 'for', result: 'object', group: true });
  });

  it('reads objects whose items are separated by commas or new lines, with bare and quoted keys', () => {
    const parsed = expr('{\n  a = 1\n  "b" = 2, c: 3\n  (var.k) = 4\n}');
    expect(parsed.type).toBe('object');
    expect((parsed as { items: unknown[] }).items).toHaveLength(4);
  });

  it('reads multi-line tuples and calls', () => {
    expect(expr('[\n  1,\n  2,\n]')).toMatchObject({ type: 'tuple', items: [{}, {}] });
    expect(expr('f(\n  a,\n  b\n)')).toMatchObject({ type: 'call', args: [{}, {}] });
  });
});

describe('templates', () => {
  it('reads interpolations, escapes and the doubled escapes', () => {
    const parsed = expr('"a-${var.x}-\\"q\\"-$${not}-%%{nor}"');
    expect(parsed).toMatchObject({ type: 'template' });
    const parts = (parsed as { parts: Array<{ kind: string; text?: string }> }).parts;
    expect(parts.map((part) => part.kind)).toEqual(['text', 'interpolation', 'text']);
    expect(parts[2]?.text).toBe('-"q"-${not}-%{nor}');
  });

  it('reads directives and strip markers', () => {
    const parsed = parseHclTemplate('%{ for x in xs ~}\n${x}\n%{~ endfor }%{if a}y%{else}n%{endif}', 't.tftpl');
    const parts = (parsed as { parts: Array<{ kind: string }> }).parts;
    expect(parts.map((part) => part.kind)).toEqual(['for', 'if']);
  });

  it('reads heredocs, and strips the shared indentation of the indented form', () => {
    const file = parseHcl('a = <<EOT\nhello ${name}\nEOT\nb = <<-EOT\n    one\n      two\n    EOT\n', 'x.tf');
    expect(attributeOf(file.body, 'a')?.expression).toMatchObject({ type: 'template' });
    expect(templateText(attributeOf(file.body, 'b')?.expression as Expression)).toBe('one\n  two\n');
  });

  it('refuses a quoted string that spans lines', () => {
    expect(() => parseHcl('a = "one\ntwo"\n', 'x.tf')).toThrow(HclSyntaxError);
  });
});

/** Every `.tf` under a directory. */
const tfFiles = function* (dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.terraform') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* tfFiles(path);
    else if (entry.name.endsWith('.tf') || entry.name.endsWith('.tfvars')) yield path;
  }
};

describe('every file it is pointed at', () => {
  it('parses every .tf file of the fixtures', () => {
    const root = resolve(import.meta.dirname, '../../../../fixtures');
    const files = [...tfFiles(root)];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(() => parseHcl(readFileSync(file, 'utf8'), file), file).not.toThrow();
  });

  // A corpus of public configuration - clones of the terraform-aws-modules
  // repositories, say - is not part of this repository. Point HCL_CORPUS at one
  // to hold the parser to it.
  it.skipIf(process.env['HCL_CORPUS'] === undefined)('parses every file of the corpus in HCL_CORPUS', () => {
    const failures: string[] = [];
    for (const file of tfFiles(process.env['HCL_CORPUS'] as string)) {
      try {
        parseHcl(readFileSync(file, 'utf8'), file);
      } catch (error) {
        failures.push(String(error));
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('referencesIn', () => {
  it('finds every reference, inside templates, calls and conditionals, and nothing else', async () => {
    const { referencesIn } = await import('./walk.js');
    const parsed = expr('"arn:${var.region}:${aws_lambda_function.x.arn}/x" == lookup(local.m, "k") ? [for v in var.l : v.id] : null');
    const found = [...referencesIn(parsed)].map((reference) =>
      reference.type === 'traversal' && reference.source.type === 'variable' ? reference.source.name : reference.type,
    );
    expect(found).toEqual(['var', 'aws_lambda_function', 'local', 'var', 'v']);
  });
});
