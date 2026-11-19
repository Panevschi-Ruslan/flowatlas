import history from '../lib/history';
import { pageUrl } from '../lib/paths';

/** An article: opening its parent goes where the server says the parent is. */
export default function Article({ parent }: { parent: { path: string } }) {
  return <button onClick={() => history.push(pageUrl(parent))}>Parent</button>;
}
