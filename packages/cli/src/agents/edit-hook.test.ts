import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CrossingName } from '@flowatlas/mcp';
import { describe, expect, it } from 'vitest';
import { editContextFor, editHookOutput, replacementsOf, runEditHook } from './edit-hook.js';
import { declarationAt, editIndexOf } from './edit-index.js';
import { countIn, EDITS_FORMAT_VERSION, fileKey, type EditIndex } from './edit-match.js';

/**
 * The edit hook (P387): after an edit that takes out a name another
 * repository uses, one line naming who uses it; silence otherwise.
 */

const CONTROLLER = [
  "import { Body, Controller, Get, Param, Patch } from '@nestjs/common';",
  '',
  "@Controller('items')",
  'export class ItemsController {',
  '  @Get()',
  '  list(): string[] {',
  '    return [];',
  '  }',
  '',
  "  @Patch(':id/archive')",
  "  archive(@Param('id') id: string, @Body() body: { reason: string }): void {",
  '    console.log(body.reason);',
  '  }',
  '}',
  '',
  "@Controller('tags')",
  'export class TagsController {',
  '  @Get()',
  '  list(): string[] {',
  '    return [];',
  '  }',
  '}',
  '',
].join('\n');

const SERVICE = [
  'export class ItemsService {',
  '  take(sku: string, remaining: number): void {',
  "    void this.bus.publish('stock_events', { type: 'STOCK_LOW', sku, remaining });",
  '  }',
  '}',
  '',
].join('\n');

const names: CrossingName[] = [
  { service: 'catalog', file: 'src/items.controller.ts', line: 10, kind: 'route', said: 'PATCH /items/:id/archive', role: 'called by', users: ['shop CatalogClient.archive (src/catalog.client.ts:25)'], id: 'entry:catalog:http:PATCH:/items/:param/archive' },
  { service: 'catalog', file: 'src/items.controller.ts', line: 5, kind: 'route', said: 'GET /items', role: 'called by', users: ['shop CatalogClient.items (src/catalog.client.ts:15)', 'web ItemsApi.all (src/items.api.ts:3)', 'web ItemsApi.page (src/items.api.ts:9)'], id: 'entry:catalog:http:GET:/items' },
  { service: 'catalog', file: 'src/items.service.ts', line: 3, kind: 'field', literal: 'sku', said: 'sku, sent on stock_events STOCK_LOW', role: 'read by', users: ['alerts StockAlerts.onStock (src/stock.alerts.ts:16)'], id: 'channel:stock_events#STOCK_LOW' },
  { service: 'catalog', file: 'src/items.service.ts', line: 3, kind: 'message type', literal: 'STOCK_LOW', said: 'STOCK_LOW (on stock_events)', role: 'consumed by', users: ['alerts StockAlerts.page (src/stock.alerts.ts:19)'], id: 'channel:stock_events#STOCK_LOW' },
  { service: 'catalog', file: 'src/items.service.ts', line: 3, kind: 'channel', literal: 'stock_events', said: 'stock_events', role: 'consumed by', users: ['alerts StockAlerts.onStock (src/stock.alerts.ts:13)'], id: 'channel:stock_events' },
  // Not spelled in its file: left out of the index, never said.
  { service: 'catalog', file: 'src/items.service.ts', line: 3, kind: 'channel', literal: 'tenant:*:events', said: 'tenant:*:events', role: 'consumed by', users: ['alerts X.y (a.ts:1)'], id: 'channel:tenant:*:events' },
];

const DIR = '/work/catalog';
const files: Record<string, string> = { [`${DIR}/src/items.controller.ts`]: CONTROLLER, [`${DIR}/src/items.service.ts`]: SERVICE };
// The index joins with the system's separator (`\` on Windows); the files here are kept under `/`.
const index: EditIndex = editIndexOf(names, { catalog: DIR, shop: '/work/shop' }, '2026-01-01T00:00:00.000Z', (path) => files[path.replace(/\\/g, '/')]);

const edit = (file: string, old: string, now: string): { call: object; now: string } => {
  const before = files[`${DIR}/${file}`] as string;
  return { call: { tool_name: 'Edit', tool_input: { file_path: `${DIR}/${file}`, old_string: old, new_string: now } }, now: before.replace(old, now) };
};

const said = (file: string, old: string, now: string): string | undefined => {
  const made = edit(file, old, now);
  return editContextFor(made.call, index, made.now, 'linux');
};

describe('how a name is counted in a text', () => {
  it('reads a field as code sends or reads it, so a value kept under a new key counts as the field gone', () => {
    const field = { match: 'field' as const, text: 'sku' };
    expect(countIn("{ type: 'X', sku, remaining }", field)).toBe(1);
    expect(countIn("{ type: 'X', itemCode: sku, remaining }", field)).toBe(0);
    expect(countIn('evt.sku + evt?.sku + evt["sku"] + { sku: 1 } + skuCount', field)).toBe(4);
  });

  it('reads a literal only where no longer name holds it, and a line whatever its indentation', () => {
    expect(countIn("publish('stock_events'); publish('stock_events_v2')", { match: 'word', text: 'stock_events' })).toBe(1);
    expect(countIn("    @Patch(':id/archive')\n", { match: 'line', text: "@Patch(':id/archive')" })).toBe(1);
  });

  it('takes the lines after a route’s line until its declaration is the file’s only one like it', () => {
    expect(declarationAt(CONTROLLER, 10)).toBe("@Patch(':id/archive')");
    // Two controllers' `list` read alike for three lines: the most taken, held twice.
    expect(declarationAt(CONTROLLER, 5)).toBe('@Get()\nlist(): string[] {\nreturn [];');
    expect(declarationAt(CONTROLLER, 99)).toBeUndefined();
  });
});

describe('the edit index', () => {
  it('holds each name its file spells, with how often, the uses named and the rest counted', () => {
    expect(index.editsFormatVersion).toBe(EDITS_FORMAT_VERSION);
    const controller = index.files[fileKey('catalog', 'src/items.controller.ts')]!;
    expect(controller.map((name) => [name.said, name.count])).toEqual([
      ['PATCH /items/:id/archive', 1],
      ['GET /items', 2],
    ]);
    expect(controller[1]).toMatchObject({ users: ['shop CatalogClient.items (src/catalog.client.ts:15)', 'web ItemsApi.all (src/items.api.ts:3)'], more: 1 });
    expect(index.files[fileKey('catalog', 'src/items.service.ts')]!.map((name) => name.text)).toEqual(['sku', 'STOCK_LOW', 'stock_events']);
  });
});

describe('the edit hook', () => {
  it('names who calls a route whose declaration the edit renamed, and the call that lists every use', () => {
    expect(said('src/items.controller.ts', "@Patch(':id/archive')", "@Patch(':id/retire')")).toBe(
      'flowatlas: this edit took out `PATCH /items/:id/archive` (declared at line 10), called by shop CatalogClient.archive (src/catalog.client.ts:25). ' +
        'Change them too; impact({symbol: "entry:catalog:http:PATCH:/items/:param/archive"}) lists every use.',
    );
    // A verb changed is the declaration changed too.
    expect(said('src/items.controller.ts', "@Patch(':id/archive')", "@Post(':id/archive')")).toMatch(/took out `PATCH \/items\/:id\/archive`/);
    // In a terminal (P392), the command that prints the same answer.
    const made = edit('src/items.controller.ts', "@Patch(':id/archive')", "@Patch(':id/retire')");
    expect(editContextFor(made.call, index, made.now, 'linux', true)).toContain('Change them too; `flowatlas impact "entry:catalog:http:PATCH:/items/:param/archive" --format json` lists every use.');
  });

  it('names who reads a field sent under another key, and the type and channel where they go', () => {
    expect(said('src/items.service.ts', 'sku, remaining }', 'itemCode: sku, remaining }')).toBe(
      'flowatlas: this edit took out `sku, sent on stock_events STOCK_LOW`, read by alerts StockAlerts.onStock (src/stock.alerts.ts:16). ' +
        'Change them too; check_contract({channel: "channel:stock_events#STOCK_LOW", field: "sku"}) lists every use.',
    );
    const renamed = said('src/items.service.ts', "'stock_events', { type: 'STOCK_LOW'", "'stock_alerts', { type: 'STOCK_OUT'");
    expect(renamed?.split('\n').map((line) => line.slice(0, 50))).toEqual([
      'flowatlas: this edit took out `STOCK_LOW (on stock',
      'flowatlas: this edit took out `stock_events`, cons',
    ]);
  });

  it('says nothing for an edit that takes out no such name, or puts back what it took out', () => {
    expect(said('src/items.controller.ts', 'console.log(body.reason);', 'void body.reason;')).toBeUndefined();
    expect(said('src/items.service.ts', 'sku, remaining }', 'sku, remaining, at: Date.now() }')).toBeUndefined();
    // Taken out in one place and written again in another of the same edit.
    expect(said('src/items.controller.ts', "  @Patch(':id/archive')\n  archive(", "  // archive\n  @Patch(':id/archive')\n  archive(")).toBeUndefined();
  });

  it('reads a line the file holds twice as the edited one only where the edit was', () => {
    // The tags controller's `@Get()`, which nothing in another repository calls, then the items controller's.
    const tags = "@Controller('tags')\nexport class TagsController {\n  @Get()";
    expect(said('src/items.controller.ts', tags, "@Controller('tags')\nexport class TagsController {\n  @Get('all')")).toBeUndefined();
    const items = "@Controller('items')\nexport class ItemsController {\n  @Get()";
    expect(said('src/items.controller.ts', items, "@Controller('items')\nexport class ItemsController {\n  @Get('all')")).toMatch(/took out `GET \/items` .*web ItemsApi\.all \(src\/items\.api\.ts:3\) and 1 more\./);
  });

  it('reads a whole file written against the file before when Claude Code says it, and against the build when not', () => {
    const now = CONTROLLER.replace("@Patch(':id/archive')", "@Patch(':id/retire')");
    const write = (response: object) =>
      editContextFor({ tool_name: 'Write', tool_input: { file_path: `${DIR}/src/items.controller.ts`, content: now }, tool_response: response }, index, now, 'linux');
    expect(write({ type: 'update', originalFile: CONTROLLER })).toMatch(/took out `PATCH \/items\/:id\/archive`/);
    expect(write({ type: 'update' })).toMatch(/took out `PATCH \/items\/:id\/archive`/);
  });

  it('reads each replacement of a MultiEdit, and says the names past the third as a count', () => {
    const call = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: `${DIR}/src/items.service.ts`,
        edits: [
          { old_string: "'stock_events'", new_string: "'stock_alerts'" },
          { old_string: "type: 'STOCK_LOW', sku, remaining", new_string: "type: 'STOCK_OUT', code: sku, left: remaining" },
        ],
      },
    };
    expect(replacementsOf(call)).toHaveLength(2);
    const now = SERVICE.replace("'stock_events'", "'stock_alerts'").replace("type: 'STOCK_LOW', sku, remaining", "type: 'STOCK_OUT', code: sku, left: remaining");
    const lines = editContextFor(call, index, now, 'linux')?.split('\n') ?? [];
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.startsWith('flowatlas: '))).toBe(true);
  });

  it('says nothing for a file in no service, a tool that does not edit, or an index of another version', () => {
    const made = edit('src/items.controller.ts', "@Patch(':id/archive')", "@Patch(':id/retire')");
    expect(editContextFor({ ...made.call, tool_input: { file_path: '/elsewhere/src/items.controller.ts', old_string: 'a', new_string: 'b' } }, index, made.now, 'linux')).toBeUndefined();
    expect(editContextFor({ tool_name: 'Read', tool_input: { file_path: `${DIR}/src/items.controller.ts` } }, index, made.now, 'linux')).toBeUndefined();
    expect(editContextFor(made.call, { ...index, editsFormatVersion: 0 }, made.now, 'linux')).toBeUndefined();
  });

  it('runs from stdin and writes the context Claude Code reads after a tool call, and nothing when the index is missing', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-p387-')));
    const repo = join(root, 'catalog');
    mkdirSync(join(repo, 'src'), { recursive: true });
    const file = join(repo, 'src', 'items.controller.ts');
    writeFileSync(file, CONTROLLER.replace("@Patch(':id/archive')", "@Patch(':id/retire')"));
    const indexPath = join(root, 'edits.json');
    writeFileSync(indexPath, JSON.stringify(editIndexOf(names, { catalog: repo }, 'x', (path) => (resolve(path) === resolve(file) ? CONTROLLER : undefined))));
    const stdin = async () => JSON.stringify({ tool_name: 'Edit', cwd: repo, tool_input: { file_path: 'src/items.controller.ts', old_string: "@Patch(':id/archive')", new_string: "@Patch(':id/retire')" } });
    const written: string[] = [];
    await runEditHook(['--edits', indexPath], { stdin, write: (text) => void written.push(text), env: {} });
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!).hookSpecificOutput).toMatchObject({ hookEventName: 'PostToolUse', additionalContext: expect.stringMatching(/^flowatlas: this edit took out `PATCH/) });
    await runEditHook(['--edits', join(root, 'none.json')], { stdin, write: (text) => void written.push(text), env: {} });
    await runEditHook(['--edits', indexPath], { stdin: async () => 'not json', write: (text) => void written.push(text), env: {} });
    expect(written).toHaveLength(1);
    expect(JSON.parse(editHookOutput('x'))).toEqual({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'x' } });
  });
});
