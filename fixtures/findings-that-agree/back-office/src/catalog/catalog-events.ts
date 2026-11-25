/** A price change, as the back office expects it. */
export interface PriceChangedEvent {
  type: 'PRICE_CHANGED';
  sku: string;
  price: number;
}

/** Any message of the catalog channel: its type a plain string, so it says no type of its own. */
export interface CatalogMessage {
  type: string;
  sku: string;
  reason?: string;
}
