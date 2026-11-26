/** Who is signed in, which every page's root layout loads on the server. */
export const readSession = async (): Promise<unknown> => (await fetch('/api/session')).json();

/** Signing out, from the button in the root layout. */
export const signOut = (): Promise<Response> => fetch('/api/session', { method: 'DELETE' });

/** The menu the application's shell loads for every page under it. */
export const listMenu = async (): Promise<unknown> => (await fetch('/api/menu')).json();

/** One order, which its page loads. */
export const loadOrder = async (id: string): Promise<unknown> => (await fetch(`/api/orders/${id}`)).json();
