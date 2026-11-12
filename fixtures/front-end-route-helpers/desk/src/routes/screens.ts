import { loadScreen } from '../lib/load-screen';

/** The screens of the signed-in desk, each loaded when first shown. */
export const Home = loadScreen(() => import('../screens/Home'));
export const Search = loadScreen(() => import('../screens/Search'));
export const Article = loadScreen(() => import('../screens/Article'));
