import { data, type ActionFunctionArgs } from 'react-router';
import { createProject, listProjects } from '../../models/projects.js';

/** Under a prefix: `/api/projects`. */
export const loader = async () => listProjects();

export async function action({ request }: ActionFunctionArgs) {
  const body = (await request.json()) as { name: string };
  return data(await createProject(body.name), { status: 201 });
}
