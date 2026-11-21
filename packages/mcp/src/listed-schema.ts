/**
 * The tool list as a model reads it, with what every tool shares said once
 * (P366).
 *
 * A client hands the model each tool's name, description and input schema.
 * Most tools take the same bounds - `detail`, `maxNodes`, `offset`, `service`
 * and whatever else the common input gains - and the schema the SDK writes
 * repeats each one's type, default and range on every tool, with a `$schema`
 * header on each: more than a third of what the list costs, re-read on every
 * turn once the tools are loaded. The server's instructions say what those
 * inputs mean and their defaults once, so here each keeps only its type, and
 * a tool whose bound differs (`get_flow`'s 60 rows) keeps what differs. The
 * inputs are checked against the full schema all the same: only the listing
 * is thinner.
 */
import { z } from 'zod';
import { commonInput, pageInput, serviceInput } from './tools/common.js';

type Json = Record<string, unknown>;

/** Each shared input as the SDK lists it, from the definitions every tool spreads. */
const SHARED: ReadonlyMap<string, Json> = (() => {
  const schema = z.toJSONSchema(z.object({ ...commonInput, ...pageInput, service: serviceInput }), { io: 'input' }) as { properties?: Record<string, Json> };
  return new Map(Object.entries(schema.properties ?? {}));
})();

/** One input's schema with every part the shared one says the same left out, its type kept. */
const thinned = (property: Json, shared: Json): Json => {
  const kept: Json = {};
  for (const [key, value] of Object.entries(property)) {
    if (key !== 'type' && key in shared && JSON.stringify(shared[key]) === JSON.stringify(value)) continue;
    kept[key] = value;
  }
  return kept;
};

/** A tool's input schema as listed: no `$schema` header, and the shared inputs reduced to what they say of their own. */
export const listedInputSchema = (schema: Json): Json => {
  const { $schema: _header, ...rest } = schema;
  const properties = rest['properties'];
  if (properties === null || typeof properties !== 'object') return rest;
  const out: Json = {};
  for (const [name, property] of Object.entries(properties as Record<string, Json>)) {
    const shared = SHARED.get(name);
    out[name] = shared === undefined || property === null || typeof property !== 'object' ? property : thinned(property, shared);
  }
  return { ...rest, properties: out };
};

/** A `tools/list` answer with every tool's input schema as listed; anything else as it is. */
export const listedTools = (result: unknown): unknown => {
  if (result instanceof Promise) return result.then(listedTools);
  const answer = result as { tools?: Array<{ inputSchema?: Json }> } | undefined;
  if (answer === undefined || answer === null || !Array.isArray(answer.tools)) return result;
  return {
    ...answer,
    tools: answer.tools.map((tool) =>
      tool.inputSchema === undefined || tool.inputSchema === null || typeof tool.inputSchema !== 'object' ? tool : { ...tool, inputSchema: listedInputSchema(tool.inputSchema) },
    ),
  };
};
