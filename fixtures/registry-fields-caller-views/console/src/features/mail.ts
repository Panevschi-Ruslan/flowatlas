import { book, SectionCatalog } from './section-catalog';
import { Inbox, Outbox } from './screens';

SectionCatalog.register({ path: '/inbox', Screen: Inbox });
book.add({ path: '/outbox', Screen: Outbox });
