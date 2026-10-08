import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { oneTask, removeTask } from '../../models/projects.js';

/** `/api/projects/:projectId/tasks/:taskId?`: an optional param. */
export async function loader({ params }: LoaderFunctionArgs) {
  return oneTask(params.projectId ?? '', params.taskId ?? '');
}

/** Answers only a DELETE, which it says by comparing the method (P43). */
export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') throw new Response(null, { status: 405 });
  await removeTask(params.taskId ?? '');
  return null;
}
