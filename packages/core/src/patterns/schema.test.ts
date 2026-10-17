import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig, patternFilesFor } from '../config.js';
import { GraphBuilder } from '../builder.js';
import { readPatterns, reportPatterns } from './apply.js';
import { PATTERN_CAUSES, patternsFor, readPatternText } from './schema.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-patterns-'));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

const RULE = `- id: bus-emit
  kind: publish
  on: { receiverType: Bus }
  pattern: "$B.emit({ topic: $T })"
  channel: $T
`;

describe('pattern files', () => {
  it('reads a list of rules, each with the line it starts on', () => {
    const reading = readPatternText('/p.yml', `${RULE}\n- id: bus-on\n  kind: subscribe\n  on: { receiverType: Bus }\n  pattern: $B.on($C, _)\n  channel: $C\n`);
    expect(reading.problem).toBeUndefined();
    expect(reading.rules.map((rule) => [rule.id, rule.line, rule.rule?.kind])).toEqual([
      ['bus-emit', 1, 'publish'],
      ['bus-on', 7, 'subscribe'],
    ]);
  });

  it('says why a file is not read: missing, not YAML, not a list', () => {
    expect(readPatternText('/p.yml', undefined).problem).toBe('it is not there');
    expect(readPatternText('/p.yml', '- id: x\n  pattern: a: b: c').problem).toMatch(/not YAML/);
    expect(readPatternText('/p.yml', 'id: x').problem).toBe('it is not a list of rules');
  });

  it('refuses one rule without the rest of the file, naming the field', () => {
    const reading = readPatternText('/p.yml', `- id: broken\n  kind: shout\n  pattern: x()\n${RULE}`);
    expect(reading.rules[0]).toMatchObject({ id: 'broken', refused: { part: 'kind' } });
    expect(reading.rules[1]?.rule?.id).toBe('bus-emit');
  });

  it('refuses a second rule with an id the file already used', () => {
    const reading = readPatternText('/p.yml', `${RULE}${RULE}`);
    expect(reading.rules[1]?.refused?.part).toBe('id');
  });

  it('expands the project list and a service list, project first, a glob once', () => {
    const dir = project({ 'patterns/a.yml': RULE, 'patterns/b.yml': RULE, 'own/c.yml': RULE });
    const config = parseConfig({
      patterns: ['./patterns/*.yml'],
      services: [{ name: 'shop', repo: '.', patterns: ['./own/c.yml', './patterns/a.yml'] }],
    });
    const service = config.services[0];
    expect(patternFilesFor(config, service, dir).map((path) => path.slice(dir.length + 1))).toEqual([
      'patterns/a.yml',
      'patterns/b.yml',
      'own/c.yml',
    ]);
    expect(patternsFor(config, service, undefined)).toEqual([]);
  });

  it('keeps a plain path that is missing, so the build names it', () => {
    const dir = project({});
    const config = parseConfig({ patterns: ['./missing.yml'] });
    const [reading] = patternsFor(config, undefined, dir);
    expect(reading?.problem).toBe('it is not there');
  });

  it('names the causes a pattern fixes in one list', () => {
    expect(PATTERN_CAUSES).toEqual(['call-dynamic-receiver', 'channel-dynamic', 'db-receiver-name-only', 'api-client-unread', 'global-wrapper-dynamic']);
  });
});

describe('a service reading its patterns', () => {
  it('appends compiled rules to the descriptions and reports what it refused', () => {
    const dir = project({
      'patterns/house.yml': `${RULE}- id: later\n  kind: publish\n  on: { receiverType: Bus }\n  pattern: "$B.later(() => $T)"\n  channel: $T\n`,
    });
    const config = parseConfig({
      patterns: ['./patterns/*.yml', './gone.yml'],
      services: [{ name: 'shop', repo: '.' }],
      adapters: { broker: { custom: [{ name: 'written', producers: [{ receiverType: 'Bus', method: 'send' }] }] } },
    });
    const reading = readPatterns({ config, service: config.services[0], configDir: dir });
    expect(reading.config.adapters.broker.custom.map((broker) => broker.name)).toEqual(['written', 'pattern:bus-emit']);
    expect(config.adapters.broker.custom).toHaveLength(1);
    const builder = new GraphBuilder({ repo: 'shop' });
    const rows = reportPatterns({ builder, repoDir: dir }, reading);
    expect(rows.map((row) => [row.reason, row.file, row.line])).toEqual([
      ['pattern-file-unread', 'gone.yml', 1],
      ['pattern-not-expressible', 'patterns/house.yml', 6],
    ]);
    expect(rows[1]?.message).toContain('argument 0 of later()');
  });

  it('hands the configuration back as it was without a directory', () => {
    const config = parseConfig({ patterns: ['./x.yml'] });
    expect(readPatterns({ config, service: undefined, configDir: undefined }).config).toBe(config);
  });
});
