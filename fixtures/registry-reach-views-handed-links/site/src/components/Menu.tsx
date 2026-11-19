import { NavLink } from './NavLink';

/** The menu's entries, each an address and a label. */
const LINKS = [
  { path: '/pricing', label: 'Pricing' },
  { path: '/about', label: 'About' },
];

const CAREERS = '/careers';

/** The site's menu: no use writes `to` as text. */
export default function Menu() {
  return (
    <nav>
      {LINKS.map((item) => (
        <NavLink key={item.path} to={item.path}>
          {item.label}
        </NavLink>
      ))}
      <NavLink to={CAREERS}>Careers</NavLink>
    </nav>
  );
}
