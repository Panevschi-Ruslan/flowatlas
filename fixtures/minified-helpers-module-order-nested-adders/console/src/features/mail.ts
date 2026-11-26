import './outbox';
import { panels } from '../lib/registries';
import { Archive, Inbox } from './screens';

panels.push({ Screen: Inbox }, { Screen: Archive });
