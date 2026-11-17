import { drafts, panels } from '../lib/panels';
import { installPanel } from './install';
import { Hidden, Usage } from './screens';

installPanel(panels, { path: '/usage', Screen: Usage });
// Into the other instance: not one of the console's panels.
installPanel(drafts, { path: '/hidden', Screen: Hidden });
