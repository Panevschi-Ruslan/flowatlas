/** What a client sends to create an item: a currency is now required. */
export interface CreateItemBody {
  name: string;
  price: number;
  currency: string;
}

/** What a client sends to keep a draft: the title is now required. */
export interface DraftBody {
  title: string;
  notes?: string;
}

/** One item, as `GET /items/:id` answers it: the price is no longer sent. */
export interface ItemView {
  id: string;
  name: string;
}

/** One archived item, as `GET /items/:id/archive` answers it; no client asks for it. */
export interface ArchivedItemView {
  id: string;
  archivedAt: string;
}

/** What `item.changed` carries: the label and the legacy code are gone. */
export interface ItemChanged {
  itemId: string;
  name: string;
}
