import type { LoaderFunctionArgs } from 'react-router';
import { oneProject } from '../models/projects.js';

/** `/projects/:projectId`: the param is named by the config. */
export async function loader({ params }: LoaderFunctionArgs) {
  return oneProject(params.projectId ?? '');
}

export default function ProjectPage() {
  return null;
}
