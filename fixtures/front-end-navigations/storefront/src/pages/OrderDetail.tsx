import { useNavigate } from 'react-router-dom';

/** One order; done, it goes back to the list in place of itself. */
export function OrderDetail() {
  const navigate = useNavigate();
  const done = () => navigate('/orders', { replace: true });
  return <button onClick={done}>Done</button>;
}
