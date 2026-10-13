import type { ActionFunctionArgs } from 'react-router';

/** Under a layout: `/login`. */
export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  return { user: String(form.get('user') ?? '') };
}

export default function Login() {
  return null;
}
