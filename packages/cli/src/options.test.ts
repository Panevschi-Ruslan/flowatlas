import { describe, expect, it } from 'vitest';
import { CliError, EXIT } from './exit.js';
import { FORMATS, querySettings } from './options.js';

const piped = { stdout: { isTTY: false }, env: {} };
const terminal = { stdout: { isTTY: true }, env: {} };

describe('resolving the shared query flags', () => {
  it('draws a tree for a person and writes JSON into a pipe', () => {
    expect(querySettings({}, terminal).format).toBe('tree');
    expect(querySettings({}, piped).format).toBe('json');
  });

  it('lets --format override what the terminal implies', () => {
    expect(querySettings({ format: 'mermaid' }, terminal).format).toBe('mermaid');
    expect(querySettings({ format: 'tree' }, piped).format).toBe('tree');
  });

  it('accepts every detail level with every format', () => {
    for (const format of FORMATS) {
      for (const detail of ['0', '1', '2', '3']) {
        const settings = querySettings({ format, detail }, terminal);
        expect(settings.format).toBe(format);
        expect(settings.detail).toBe(Number(detail));
      }
    }
  });

  it('defaults to level one, depth eight and a hundred and fifty nodes', () => {
    expect(querySettings({}, terminal)).toMatchObject({ detail: 1, depth: 8, maxNodes: 150 });
  });

  it('colours only for a person watching a drawn format', () => {
    expect(querySettings({}, terminal).color).toBe(true);
    expect(querySettings({ format: 'json' }, terminal).color).toBe(false);
    expect(querySettings({}, piped).color).toBe(false);
    expect(querySettings({ color: false }, terminal).color).toBe(false);
    expect(querySettings({}, { ...terminal, env: { NO_COLOR: '1' } }).color).toBe(false);
  });

  it('refuses a level, a format or a count it cannot use, and says it cannot run', () => {
    for (const options of [
      { detail: '4' },
      { detail: 'high' },
      { format: 'ascii' },
      { depth: '0' },
      { maxNodes: '-1' },
    ]) {
      expect(() => querySettings(options, terminal)).toThrowError(CliError);
      try {
        querySettings(options, terminal);
      } catch (error) {
        expect((error as CliError).code).toBe(EXIT.cannotRun);
      }
    }
  });

  it('narrows the formats a command offers, and refuses the rest', () => {
    const narrowed = { ...terminal, formats: ['json', 'tree'] as const };
    expect(querySettings({}, narrowed).format).toBe('tree');
    expect(() => querySettings({ format: 'mermaid' }, narrowed)).toThrowError(
      /--format must be one of json, tree/,
    );
  });
});
