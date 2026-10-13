import type { ActionFunctionArgs } from 'react-router';

/** A child route: `/projects/:projectId/settings`, its form a POST. */
export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  return { saved: String(form.get('name') ?? '') };
}

export default function ProjectSettings() {
  return null;
}
