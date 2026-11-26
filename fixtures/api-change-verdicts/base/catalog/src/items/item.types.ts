/** What a client sends to create an item. */
export interface CreateItemBody {
  name: string;
  price: number;
}

/** What a client sends to keep a draft. */
export interface DraftBody {
  title?: string;
  notes?: string;
}

/** One item, as `GET /items/:id` answers it. */
export interface ItemView {
  id: string;
  name: string;
  price: number;
}

/** One archived item, as `GET /items/:id/archive` answers it; no client asks for it. */
export interface ArchivedItemView {
  id: string;
  archivedAt: string;
  reason: string;
}

/** What `item.changed` carries. */
export interface ItemChanged {
  itemId: string;
  name: string;
  label: string;
  legacyCode: string;
}

/** One row of `GET /items`; the dashboard shows the name, the badge and the stock. */
export interface ItemRow {
  id: string;
  name: string;
  thumbnail: string;
  badge: string;
  stock: number;
}
