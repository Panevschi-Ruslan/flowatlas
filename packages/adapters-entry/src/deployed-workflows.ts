import type { DeployedWorkflow, ExtractContext } from '@flowatlas/core';
import { drawDeployedWorkflow } from '@flowatlas/stepfunctions';

/**
 * The workflows a deployment declares, drawn into the service that deploys them.
 *
 * A workflow is a way in of its own kind, reached by the name it is deployed
 * under, and the same reading of the deployment that names a function names
 * it; so it is drawn here, beside the functions and routes that reading found.
 * What it is drawn as is the reader of definitions' business, and this only
 * hands the deployment's account of it over.
 */
export const drawDeployedWorkflows = (
  ctx: ExtractContext,
  workflows: readonly DeployedWorkflow[],
  deployedBy: string,
  adapter: string,
): void => {
  for (const workflow of workflows) {
    const fragment = drawDeployedWorkflow({ ...workflow, meta: { deployedBy, ...workflow.meta } }, ctx.repo);
    for (const node of fragment.nodes) ctx.builder.addNode(node);
    for (const edge of fragment.edges) ctx.builder.addEdge(edge);
    for (const row of fragment.rows) ctx.builder.addUnresolved({ ...row, adapter });
  }
};
