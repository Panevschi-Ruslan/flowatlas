/** One item, as `GET /items/:id` answers it: it may now be sold. */
export interface ItemView {
  id: string;
  name: string;
  status: 'draft' | 'live' | 'sold';
}

/** One row of `GET /items`. */
export interface ItemRow {
  id: string;
  name: string;
}

/** The query `GET /items` reads: the page is required now. */
export interface ItemsQuery {
  page: string;
}

/** The query `GET /items/search` reads. */
export interface SearchQuery {
  q?: string;
}

/** The headers `GET /items/search` reads: the tenant is required now. */
export interface SearchHeaders {
  'x-tenant': string;
}

/** What `item.changed` carries: an item may now be archived. */
export interface ItemChanged {
  itemId: string;
  kind: 'created' | 'updated' | 'archived';
}
