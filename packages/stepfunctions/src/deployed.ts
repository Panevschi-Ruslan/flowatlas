import { makeUnnamedWorkflowKey, type DeployedDefinition, type DeployedWorkflow } from '@flowatlas/core';
import { readStateMachine } from './definition.js';
import { emitWorkflow, type WorkflowFragment } from './emit.js';
import { unreadableDefinition } from './pass.js';
import { DocumentSyntaxError, readDocument, shifted, type PositionedDocument } from './source.js';

/**
 * A workflow a deployment declares, drawn.
 *
 * The deployment has done the part only it can do - found the definition,
 * however it is written, named the workflow, and said what each placeholder
 * left in the definition stands for - and hands over a `DeployedWorkflow`,
 * which names no deployment format. What is left is what a definition read on
 * its own goes through too: read it as a positioned document, read the states
 * out of it, and draw them, with the placeholders answered by the deployment
 * and the name certain because the deployment states it.
 */

/** The definition a deployment hands over, as the document the reader of definitions reads. */
const documentOf = (definition: DeployedDefinition): PositionedDocument =>
  definition.kind === 'value'
    ? { value: definition.value, at: (path) => definition.at(path) }
    : shifted(readDocument(definition.text, definition.format), definition.firstLine - 1);

export const drawDeployedWorkflow = (workflow: DeployedWorkflow, service: string): WorkflowFragment => {
  const { definition } = workflow;
  // A definition the deployment could not read has its row already, from the
  // deployment, which is the one that knows why.
  if (definition === undefined) return { nodes: [], edges: [], rows: [] };
  let document: PositionedDocument;
  try {
    document = documentOf(definition);
  } catch (cause) {
    if (!(cause instanceof DocumentSyntaxError) || definition.kind !== 'text') throw cause;
    return unreadableDefinition(
      definition.file,
      cause.position.line + definition.firstLine - 1,
      `the definition of ${workflow.address}, as ${definition.file} holds it, is not ${definition.format.toUpperCase()}: ${cause.message}`,
      'Nothing of this workflow was drawn. Fix the definition; where it is a template, check that every value it is handed writes valid text in its place.',
    );
  }
  const named = workflow.name !== undefined;
  return emitWorkflow(readStateMachine(document), {
    service,
    file: definition.file,
    name: workflow.name ?? workflow.address,
    nameFrom: 'deployment',
    resolve: (placeholder) => workflow.fill(placeholder),
    ...(named ? {} : { key: makeUnnamedWorkflowKey(workflow.address) }),
    meta: {
      ...workflow.meta,
      declaredIn: `${workflow.file}:${workflow.line}`,
      ...(named ? {} : { nameRead: false }),
    },
  });
};
