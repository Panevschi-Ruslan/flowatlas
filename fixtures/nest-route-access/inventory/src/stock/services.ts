import { SessionGuard } from './session.guard';
import { StockService } from './stock.service';

/** Named rather than written out in `@Module`: followed to the array. */
export const STOCK_SERVICES = [StockService, SessionGuard];
