import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { definePass, type ExtractContext, type ExtractorPass, type GraphBuilder } from '@flowatlas/core';
import { readStateMachine } from './definition.js';
import { emitWorkflow, type WorkflowFragment } from './emit.js';
import { definitionFiles, formatOfDefinition, nameOfDefinition } from './files.js';
import { DocumentSyntaxError, readDocument } from './source.js';

/**
 * Reads every definition file a repository keeps on its own and draws each as a
 * workflow of the service that holds it.
 *
 * A definition standing on its own does not say what it is deployed as, so it
 * is named after its file and says so (`workflow-named-by-file`). A definition
 * a deployment file loads - by path, or built in place - is read by the reader
 * of that deployment, which knows its name; both end in `emitWorkflow`.
 */

/** Adds a fragment to the graph being built. */
const addFragment = (builder: GraphBuilder, fragment: WorkflowFragment): void => {
  for (const node of fragment.nodes) builder.addNode(node);
  for (const edge of fragment.edges) builder.addEdge(edge);
  for (const row of fragment.rows) builder.addUnresolved(row);
};

/**
 * One definition file, read and drawn.
 *
 * A file that cannot be read as its format is one row at the place it stopped
 * making sense, and nothing else: half a workflow is a flow with steps missing,
 * which reads as a flow with fewer steps.
 */
export const readDefinitionFile = (repoDir: string, repo: string, file: string): WorkflowFragment => {
  const name = nameOfDefinition(file);
  let text: string;
  try {
    text = readFileSync(join(repoDir, file), 'utf8');
  } catch (cause) {
    return unreadableDefinition(file, 1, `${file} could not be opened: ${(cause as Error).message}`);
  }
  try {
    const document = readDocument(text, formatOfDefinition(file));
    return emitWorkflow(readStateMachine(document), { service: repo, file, name, nameFrom: 'file-name' });
  } catch (cause) {
    if (!(cause instanceof DocumentSyntaxError)) throw cause;
    return unreadableDefinition(file, cause.position.line, `${file} is not ${formatOfDefinition(file).toUpperCase()}: ${cause.message}`);
  }
};

/** A definition that is not text of its format: one row where it stopped making sense. */
export const unreadableDefinition = (
  file: string,
  line: number,
  message: string,
  hint = 'Nothing in this file was drawn. Fix the syntax, or rename the file if it is not a state machine definition.',
): WorkflowFragment => ({
  nodes: [],
  edges: [],
  rows: [{ file, line, reason: 'workflow-definition-unreadable', message, hint }],
});

/**
 * Two definitions in one service under one name are two workflows the graph
 * cannot tell apart, so the second is not drawn and a row says which.
 */
const duplicate = (file: string, name: string, first: string): WorkflowFragment => ({
  nodes: [],
  edges: [],
  rows: [
    {
      file,
      line: 1,
      reason: 'workflow-name-duplicate',
      message: `${file} would be the workflow ${name}, which ${first} already is`,
      hint: 'Two definitions in one service are named after the same file name. Rename one of the files, or read both from the files that deploy them.',
    },
  ],
});

/**
 * The workflows a deployment of this service already drew, by the name each
 * is deployed under and the file its definition is in.
 *
 * Asked of the graph being built because the reader of the deployment runs
 * before this does and is the better reader of anything it loads: a definition
 * file a deployment loads is read once, by the deployment, under the name it is
 * deployed with, and not a second time under its file's name.
 */
const deployedWorkflows = (ctx: ExtractContext): { files: Set<string>; names: Map<string, string> } => {
  const files = new Set<string>();
  const names = new Map<string, string>();
  for (const node of ctx.builder.nodes) {
    if (node.type !== 'entry' || node.kind !== 'workflow' || node.meta?.['nameFrom'] !== 'deployment') continue;
    if (node.file !== undefined) files.add(node.file);
    const name = node.meta?.['name'];
    if (typeof name === 'string' && node.meta?.['nameRead'] !== false) {
      names.set(name, String(node.meta?.['declaredAs'] ?? node.file ?? name));
    }
  }
  return { files, names };
};

export const extractWorkflows = (ctx: ExtractContext): void => {
  const deployed = deployedWorkflows(ctx);
  const named = new Map<string, string>(deployed.names);
  for (const file of definitionFiles(ctx.repoDir)) {
    if (deployed.files.has(file)) {
      ctx.logger.debug(`workflow from ${file} is read by the deployment that loads it`);
      continue;
    }
    const name = nameOfDefinition(file);
    const first = named.get(name);
    if (first !== undefined) {
      addFragment(ctx.builder, duplicate(file, name, first));
      continue;
    }
    named.set(name, file);
    ctx.logger.debug(`workflow ${name} from ${file}`);
    addFragment(ctx.builder, readDefinitionFile(ctx.repoDir, ctx.repo, file));
  }
};

/** The step a server reader runs after its own, for every repository it reads. */
export const workflowsPass: ExtractorPass<ExtractContext> = definePass('workflows', extractWorkflows);
