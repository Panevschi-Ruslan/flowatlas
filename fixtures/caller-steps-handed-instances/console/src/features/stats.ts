import { panels } from '../lib/panels';
import { Stats } from './screens';

// Added to the imported instance's field outside any function.
panels.items.push({ path: '/stats', Screen: Stats });
