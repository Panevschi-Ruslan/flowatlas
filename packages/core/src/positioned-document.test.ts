import { describe, expect, it } from 'vitest';
import { DocumentSyntaxError, fromValue, readDocument, readJson, readYaml } from './positioned-document.js';

describe('readJson', () => {
  const text = ['{', '  "StartAt": "CheckHolds",', '  "States": {', '    "CheckHolds": { "Type": "Pass", "End": true }', '  },', '  "Tags": ["a", "b"]', '}'].join('\n');

  it('reads the values JSON.parse reads', () => {
    expect(readJson(text).value).toEqual(JSON.parse(text));
  });

  it('keeps where every key and list item is written', () => {
    const document = readJson(text);
    expect(document.at([])).toEqual({ line: 1, column: 1 });
    expect(document.at(['StartAt'])).toEqual({ line: 2, column: 3 });
    expect(document.at(['States', 'CheckHolds'])).toEqual({ line: 4, column: 5 });
    expect(document.at(['States', 'CheckHolds', 'End'])).toEqual({ line: 4, column: 37 });
    expect(document.at(['Tags', 1])).toEqual({ line: 6, column: 17 });
    expect(document.at(['Nowhere'])).toBeUndefined();
  });

  it('reads a file indented with tabs and opened by a byte-order mark, which YAML would refuse', () => {
    const document = readJson('\uFEFF{\n\t"StartAt": "A",\n\t"States": {}\n}');
    expect(document.value).toEqual({ StartAt: 'A', States: {} });
    expect(document.at(['States'])).toEqual({ line: 3, column: 2 });
  });

  it('decodes escapes, numbers and literals exactly as the language does', () => {
    expect(readJson('{"a": "line\\nbreak \\u00e9", "b": -1.5e2, "c": [true, false, null]}').value).toEqual({
      a: 'line\nbreak \u00e9',
      b: -150,
      c: [true, false, null],
    });
  });

  it('refuses text that is not JSON, saying where', () => {
    expect(() => readJson('{\n  "StartAt": "A",\n  "States": {,}\n}')).toThrow(DocumentSyntaxError);
    try {
      readJson('{\n  "StartAt": "A"\n  "States": {}\n}');
    } catch (cause) {
      expect((cause as DocumentSyntaxError).position.line).toBe(3);
    }
    expect(() => readJson('{"a": 1} trailing')).toThrow(DocumentSyntaxError);
    expect(() => readJson('{"a": "unclosed')).toThrow(DocumentSyntaxError);
  });
});

describe('readYaml', () => {
  const text = [
    'StartAt: SendEmail',
    'States:',
    '  SendEmail:',
    '    Type: Task',
    '    Retry:',
    '      - ErrorEquals: [States.ALL]',
    '    End: true',
  ].join('\n');

  it('reads the values and where each key is written', () => {
    const document = readYaml(text);
    expect(document.value).toEqual({
      StartAt: 'SendEmail',
      States: { SendEmail: { Type: 'Task', Retry: [{ ErrorEquals: ['States.ALL'] }], End: true } },
    });
    expect(document.at(['States', 'SendEmail'])).toEqual({ line: 3, column: 3 });
    expect(document.at(['States', 'SendEmail', 'Retry', 0])).toEqual({ line: 6, column: 9 });
  });

  it('refuses text that is not YAML, saying where', () => {
    expect(() => readYaml('StartAt: A\nStates:\n  A: [unclosed\n')).toThrow(DocumentSyntaxError);
  });
});

describe('readDocument and fromValue', () => {
  it('reads each format by its own reader', () => {
    expect(readDocument('{"StartAt": "A"}', 'json').value).toEqual({ StartAt: 'A' });
    expect(readDocument('StartAt: A', 'yaml').value).toEqual({ StartAt: 'A' });
  });

  it('places everything of a value built in place where it was built', () => {
    const document = fromValue({ StartAt: 'A', States: {} }, { line: 12, column: 3 });
    expect(document.at(['States', 'A'])).toEqual({ line: 12, column: 3 });
  });
});
