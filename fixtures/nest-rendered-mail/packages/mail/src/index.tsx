import { renderToStaticMarkup } from 'react-dom/server';
import { Receipt } from './Receipt.js';

/** What the API calls: the receipt, as HTML. */
export const receiptHtml = (orderId: string): string => renderToStaticMarkup(<Receipt orderId={orderId} />);
