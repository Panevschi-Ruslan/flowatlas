import { Link } from 'react-router-dom';

/** The list of orders, each linking to its own screen. */
export function Orders({ ids }: { ids: string[] }) {
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          <Link to={`/orders/${id}`}>{id}</Link>
        </li>
      ))}
      <Link to="/" replace>
        Home
      </Link>
    </ul>
  );
}
