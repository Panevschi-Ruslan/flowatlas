import { pages as allPages } from '../lib/pages';
import { Team } from './screens';

/** Added to the store itself, under another name, outside any function. */
allPages.set('/team', { path: '/team', Screen: Team });
