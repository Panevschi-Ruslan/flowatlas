import { Link, NavLink, useNavigate } from 'react-router-dom';

import { api } from '../api';

/** The start screen: links to the orders, a button that opens one, and the ways out of the application. */
export function Home({ next }: { next: string }) {
  const navigate = useNavigate();

  const openLatest = async () => {
    const { data } = await api.get<{ id: string }>('/orders/latest');
    navigate(`/orders/${data.id}`);
  };

  const help = () => {
    navigate('https://help.example.com/storefront');
  };

  const lost = () => {
    navigate('/archive');
  };

  const somewhere = () => {
    navigate(next);
  };

  const back = () => {
    navigate(-1);
  };

  // Rooted at a value read at run time, which may be a host: no page is said.
  const mirrored = () => {
    navigate(`${window.location.origin}/orders`);
  };

  // A value glued to the last segment is the query: the orders page.
  const filtered = (search: string) => {
    navigate(`/orders${search}`);
  };

  return (
    <main>
      <Link to="/orders">Orders</Link>
      <NavLink to={{ pathname: '/login' }}>Sign in</NavLink>
      <button onClick={openLatest}>Latest</button>
      <button onClick={help}>Help</button>
      <button onClick={lost}>Archive</button>
      <button onClick={somewhere}>Next</button>
      <button onClick={back}>Back</button>
      <button onClick={mirrored}>Mirror</button>
      <button onClick={() => filtered('?open=1')}>Open orders</button>
    </main>
  );
}
