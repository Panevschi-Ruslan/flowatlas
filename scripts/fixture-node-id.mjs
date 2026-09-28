#!/usr/bin/env node
/**
 * The node resolver, for callers that only speak command line.
 *
 *   node scripts/fixture-node-id.mjs <graph.json> <type> <relation> <subject>
 *
 * The recorded demos type real commands at a real prompt, so a scene that
 * shows a node id has to have the real one to type. This prints it, and the
 * scene interpolates it — what the viewer sees is still the id the tool would
 * have answered with, and no scene has one written into it.
 */

import { readGraphFile, resolveNodeId } from './fixture-nodes.mjs';

const [graphPath, type, relation, subject] = process.argv.slice(2);

if (graphPath === undefined || type === undefined || relation === undefined || subject === undefined) {
  process.stderr.write(
    'usage: node scripts/fixture-node-id.mjs <graph.json> <type> <relation> <subject>\n',
  );
  process.exit(2);
}

try {
  process.stdout.write(`${resolveNodeId(readGraphFile(graphPath), { type, [relation]: subject })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
