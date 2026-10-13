import { describe, expect, it } from 'vitest';
import { attributeOf, blocksOf } from './ast.js';
import { parseHclJson } from './json.js';
import { HclSyntaxError, parseHcl } from './parse.js';

const text = (lines: string[]): string => lines.join('\n');

describe('parseHclJson', () => {
  it('reads blocks to the depth of their labels, each with the line of its last label', () => {
    const file = parseHclJson(
      text([
        '{',
        '  "resource": {',
        '    "aws_lambda_function": {',
        '      "get_item": {',
        '        "function_name": "get-item"',
        '      }',
        '    }',
        '  },',
        '  "module": { "add_item": { "source": "./modules/function" } },',
        '  "locals": { "prefix": "library" }',
        '}',
      ]),
      'infra/main.tf.json',
    );
    expect(file.body.blocks.map((block) => [block.type, block.labels, block.pos.line])).toEqual([
      ['resource', ['aws_lambda_function', 'get_item'], 4],
      ['module', ['add_item'], 9],
      ['locals', [], 10],
    ]);
    expect(attributeOf(file.body.blocks[0]!.body, 'function_name')?.pos).toEqual({ file: 'infra/main.tf.json', line: 5, column: 9 });
  });

  it('reads a string as a template, as the native syntax reads a quoted string', () => {
    const json = parseHclJson('{ "locals": { "arn": "${aws_lambda_function.x.arn}", "name": "loans-${var.stage}" } }', 'x.tf.json');
    const native = parseHcl('locals {\n  arn = "${aws_lambda_function.x.arn}"\n  name = "loans-${var.stage}"\n}\n', 'x.tf');
    const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, inner) => (key === 'pos' ? undefined : inner)));
    for (const name of ['arn', 'name']) {
      expect(strip(attributeOf(json.body.blocks[0]!.body, name)?.expression)).toEqual(
        strip(attributeOf(native.body.blocks[0]!.body, name)?.expression),
      );
    }
  });

  it("takes a variable's default as JSON, skips comments, and repeats a block an array holds", () => {
    const file = parseHclJson(
      text([
        '{',
        '  "//": "generated",',
        '  "variable": { "stage": { "default": "${not-a-template}" } },',
        '  "resource": { "aws_sqs_queue": { "q": [{ "name": "a" }, { "name": "b" }] } }',
        '}',
      ]),
      'x.tf.json',
    );
    const [variable, first, second] = file.body.blocks;
    expect(attributeOf(variable!.body, 'default')?.expression).toMatchObject({ type: 'literal', value: '${not-a-template}' });
    expect([first, second].map((block) => attributeOf(block!.body, 'name')?.source)).toEqual(['"a"', '"b"']);
  });

  it('makes a block of what the language nests, and an argument of anything else', () => {
    const file = parseHclJson(
      text([
        '{ "resource": { "aws_lambda_function": { "f": {',
        '  "environment": { "variables": { "QUEUE": "q" } },',
        '  "lifecycle": { "ignore_changes": ["tags"] },',
        '  "dynamic": { "tag": { "for_each": "${var.tags}", "content": { "key": "${tag.key}" } } }',
        '} } },',
        '  "terraform": { "backend": { "s3": { "bucket": "state" } } } }',
      ]),
      'x.tf.json',
    );
    const [fn, terraform] = file.body.blocks;
    expect(attributeOf(fn!.body, 'environment')?.expression.type).toBe('object');
    expect(blocksOf(fn!.body, 'lifecycle')).toHaveLength(1);
    const [dynamic] = blocksOf(fn!.body, 'dynamic');
    expect(dynamic?.labels).toEqual(['tag']);
    expect(blocksOf(dynamic!.body, 'content')).toHaveLength(1);
    expect(blocksOf(terraform!.body, 'backend')[0]?.labels).toEqual(['s3']);
  });

  it('refuses text that is not JSON, at its line', () => {
    expect(() => parseHclJson('{\n  "resource": {\n    "x" 1\n  }\n}', 'x.tf.json')).toThrow(HclSyntaxError);
    try {
      parseHclJson('{\n  "resource": {\n    "x" 1\n  }\n}', 'x.tf.json');
    } catch (error) {
      expect((error as HclSyntaxError).line).toBe(3);
    }
  });
});
