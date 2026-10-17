/**
 * A written document checked against the official OpenAPI 3.1 and AsyncAPI
 * 3.0 JSON schemas, for tests only (P118). Both are kept unmodified under
 * `test-data/` with their notices; the validator is the one the MCP SDK
 * already depends on, resolved from the SDK's own directory, as the SARIF
 * check resolves it.
 *
 * Two adjustments are made to the copies read into memory, neither changing
 * what is valid. The OpenAPI schema refers to its own Schema Object through
 * `$dynamicRef: "#meta"`, which this validator resolves to the root rather
 * than to the anchor beside it; the reference is pointed at `#/$defs/schema`,
 * which is where the anchor is. The AsyncAPI bundle carries its own copy of
 * the draft-07 meta-schema under the id the validator registers its own with,
 * so the validator is made without one. Every schema in a document is also
 * checked against the 2020-12 meta-schema, which is the dialect an OpenAPI
 * 3.1 document's schemas are written in.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const DATA = join(import.meta.dirname, '..', '..', 'test-data');

interface Validator {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
}

interface AjvLike {
  compile(schema: object): Validator;
  validateSchema(schema: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
}

let compiled: { openapi: Validator; asyncapi: Validator; dialect: AjvLike } | undefined;

const validators = (): NonNullable<typeof compiled> => {
  if (compiled !== undefined) return compiled;
  const fromSdk = createRequire(createRequire(import.meta.url).resolve('@modelcontextprotocol/sdk/server/mcp.js'));
  const Ajv2020 = (fromSdk('ajv/dist/2020') as { default: new (options: object) => AjvLike }).default;
  const Ajv = (fromSdk('ajv') as { default: new (options: object) => AjvLike }).default;
  const addFormats = (fromSdk('ajv-formats') as { default: (ajv: unknown) => void }).default;
  const openapiText = readFileSync(join(DATA, 'openapi-3.1-schema-2022-10-07.json'), 'utf8').replaceAll('"$dynamicRef": "#meta"', '"$ref": "#/$defs/schema"');
  const asyncapiText = readFileSync(join(DATA, 'asyncapi-3.0.0-schema.json'), 'utf8');
  const modern = new Ajv2020({ allErrors: true, strict: false, logger: false });
  addFormats(modern);
  const draft7 = new Ajv({ allErrors: true, strict: false, meta: false, validateSchema: false, logger: false });
  addFormats(draft7);
  compiled = {
    openapi: modern.compile(JSON.parse(openapiText) as object),
    asyncapi: draft7.compile(JSON.parse(asyncapiText) as object),
    dialect: modern,
  };
  return compiled;
};

const said = (errors: Array<{ instancePath: string; message?: string }> | null | undefined): string[] =>
  (errors ?? []).map((error) => `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`);

/** Every schema under `components.schemas`, by name. */
const schemasOf = (document: Record<string, unknown>): Array<[string, unknown]> =>
  Object.entries(((document['components'] as { schemas?: Record<string, unknown> } | undefined)?.schemas ?? {}));

/** What is wrong with a document, one line per problem; empty when it validates. */
export const specProblems = (document: Record<string, unknown>): string[] => {
  const { openapi, asyncapi, dialect } = validators();
  const validate = typeof document['openapi'] === 'string' ? openapi : asyncapi;
  const problems = validate(document) ? [] : said(validate.errors);
  for (const [name, schema] of schemasOf(document)) {
    if (!dialect.validateSchema(schema)) problems.push(...said(dialect.errors).map((line) => `components.schemas.${name}${line}`));
  }
  return problems;
};
