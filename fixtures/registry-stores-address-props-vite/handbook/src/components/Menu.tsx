import { NavLink } from './NavLink';
import { OrderLink } from './OrderLink';
import { TagLink } from './TagLink';

/** The handbook's menu. */
export default function Menu() {
  return (
    <nav>
      <NavLink to="/pricing">Pricing</NavLink>
      <NavLink to="/about">About</NavLink>
      <OrderLink id="7" />
      <TagLink name="news" />
    </nav>
  );
}
