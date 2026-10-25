/**
 * A SARIF log checked against the OASIS SARIF 2.1.0 JSON schema, for tests
 * only (P115). The schema is kept unmodified under `test-data/` with its
 * notice; it is written for draft-04, which differs from what the validator
 * reads only in naming its own id `id`, so that one key is renamed on the
 * copy read into memory.
 *
 * The validator is the one the MCP SDK already depends on, resolved from the
 * SDK's own directory rather than added as a dependency of this package.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const SCHEMA = join(import.meta.dirname, '..', '..', 'test-data', 'sarif-schema-2.1.0.json');

interface Validator {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
}

let compiled: Validator | undefined;

const validator = (): Validator => {
  if (compiled !== undefined) return compiled;
  const fromSdk = createRequire(createRequire(import.meta.url).resolve('@modelcontextprotocol/sdk/server/mcp.js'));
  const Ajv = (fromSdk('ajv') as { default: new (options: object) => { compile(schema: object): Validator } }).default;
  const addFormats = (fromSdk('ajv-formats') as { default: (ajv: unknown) => void }).default;
  const { $schema: _draft, id, ...schema } = JSON.parse(readFileSync(SCHEMA, 'utf8')) as Record<string, unknown>;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  compiled = ajv.compile({ ...schema, $id: id });
  return compiled;
};

/** What is wrong with a log, one line per problem; empty when it validates. */
export const sarifProblems = (log: unknown): string[] => {
  const validate = validator();
  if (validate(log)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`);
};
