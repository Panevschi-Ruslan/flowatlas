import { book, draftBook, shelf } from './panel-book';
import { Alerts, Hidden, Limits } from './screens';

book.add({ path: '/alerts', Screen: Alerts });
shelf.put({ path: '/limits', Screen: Limits });
draftBook.add({ path: '/drafted', Screen: Hidden });
