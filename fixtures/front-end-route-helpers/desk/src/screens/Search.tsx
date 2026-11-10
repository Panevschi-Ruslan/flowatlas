import { useHistory } from 'react-router-dom';
import { startPath } from '../lib/paths';

/** The search screen: back to the start, wherever the build says that is. */
export default function Search() {
  const history = useHistory();
  return <button onClick={() => history.push(startPath())}>Home</button>;
}
