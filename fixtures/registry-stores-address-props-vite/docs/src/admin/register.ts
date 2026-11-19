import { addEntry } from '../lib/entries';
import { panels } from '../lib/panels';
import { registerSection } from '../lib/sections';
import { Guides, Billing, Users, Reports, Archive, Usage } from '../screens';
import { adminEntries, archiveEntries } from './lists';

registerSection({ area: 'docs', path: '/docs/guides', Screen: Guides });
registerSection({ area: 'account', path: '/account/billing', Screen: Billing });

addEntry(adminEntries, { group: 'people', path: '/admin/users', Screen: Users });
addEntry(adminEntries, { group: 'numbers', path: '/admin/reports', Screen: Reports });
addEntry(archiveEntries, { group: 'people', path: '/archive', Screen: Archive });

panels.add({ path: '/dashboard/usage', Screen: Usage });
