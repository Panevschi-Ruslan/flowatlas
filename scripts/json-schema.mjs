#!/usr/bin/env node
/**
 * Writes, or with --check compares, the JSON Schemas of the files flowatlas
 * writes (P237), from the zod schemas it reads them with.
 *
 *   node scripts/json-schema.mjs            write schema/*.schema.json
 *   node scripts/json-schema.mjs --check    exit 1 when one differs or is missing,
 *                                           and when a fixture's graph does not validate
 *
 * In `pnpm fixtures:check`, so a change to a reader's schema that leaves the
 * published one behind fails the gates, as a fixture snapshot would.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { PUBLISHED_SCHEMAS } = await import(join(root, 'packages', 'linker', 'dist', 'index.js'));
const check = process.argv.includes('--check');
const dir = join(root, 'schema');
const problems = [];

const schemas = PUBLISHED_SCHEMAS();
mkdirSync(dir, { recursive: true });
for (const { file, schema } of schemas) {
  const text = `${JSON.stringify(schema, null, 2)}\n`;
  const path = join(dir, file);
  if (!check) writeFileSync(path, text, 'utf8');
  else if (!existsSync(path)) problems.push(`${file}: missing; run node scripts/json-schema.mjs`);
  else if (readFileSync(path, 'utf8') !== text) problems.push(`${file}: differs from what the readers' schema says; run node scripts/json-schema.mjs`);
}
const known = new Set(schemas.map(({ file }) => file));
for (const name of readdirSync(dir)) if (name.endsWith('.schema.json') && !known.has(name)) problems.push(`${name}: no reader writes this any more`);

if (check) {
  // Every fixture's graph against the schema it claims, with the validator the graph server's SDK uses.
  // Ajv comes with the MCP SDK the graph server uses; the schemas are draft 2020-12.
  const sdk = createRequire(join(root, 'packages', 'mcp', 'package.json')).resolve('@modelcontextprotocol/sdk/package.json');
  const Ajv = createRequire(sdk)('ajv/dist/2020').default;
  const ajv = new Ajv({ strict: false });
  const project = schemas.find(({ file }) => file.startsWith('project-graph.'));
  const validate = ajv.compile(project.schema);
  let validated = 0;
  for (const fixture of readdirSync(join(root, 'fixtures'))) {
    const path = join(root, 'fixtures', fixture, '.flowatlas', 'project-graph.json');
    if (!existsSync(path)) continue;
    validated += 1;
    if (!validate(JSON.parse(readFileSync(path, 'utf8')))) problems.push(`fixtures/${fixture}: project-graph.json does not validate: ${ajv.errorsText(validate.errors)}`);
  }
  if (problems.length === 0) console.log(`json schemas ok: ${schemas.length} current, ${validated} fixture graph(s) validate`);
} else {
  console.log(`wrote ${schemas.length} JSON Schema(s) to schema/`);
}
for (const problem of problems) console.error(`    ${problem}`);
if (problems.length > 0) process.exit(1);
