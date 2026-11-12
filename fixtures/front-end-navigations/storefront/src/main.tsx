import { createBrowserRouter, redirect } from 'react-router-dom';

import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { OrderDetail } from './pages/OrderDetail';
import { Orders } from './pages/Orders';

/** The route table every screen of the storefront is placed by. */
export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/orders', element: <Orders /> },
  { path: '/orders/:id', element: <OrderDetail /> },
  { path: '/login', element: <Login /> },
  // A loader that sends a visitor with no session to the login screen.
  { path: '/account', loader: accountLoader },
  // A path read at run time: the route reader does not place it.
  { path: import.meta.env.VITE_SETTINGS_PATH, element: <Login /> },
]);

export async function accountLoader() {
  if (document.cookie === '') return redirect('/login');
  return null;
}

/** Leaves the storefront once the session ends: the router itself navigates. */
export function signOut(): void {
  void router.navigate('/login', { replace: true });
}
