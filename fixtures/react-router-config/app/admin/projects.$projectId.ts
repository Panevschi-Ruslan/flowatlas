import type { LoaderFunctionArgs } from 'react-router';
import { oneProject } from '../models/projects.js';

/** Found by the flat convention under the prefix: `/admin/projects/:projectId`. */
export async function loader({ params }: LoaderFunctionArgs) {
  return oneProject(params.projectId ?? '');
}
