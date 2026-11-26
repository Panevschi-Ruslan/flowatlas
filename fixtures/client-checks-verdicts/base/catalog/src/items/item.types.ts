/** One item, as `GET /items/:id` answers it. */
export interface ItemView {
  id: string;
  name: string;
  status: 'draft' | 'live';
}

/** One row of `GET /items`. */
export interface ItemRow {
  id: string;
  name: string;
}

/** The query `GET /items` reads: the page is optional on the base side. */
export interface ItemsQuery {
  page?: string;
}

/** The query `GET /items/search` reads. */
export interface SearchQuery {
  q?: string;
}

/** The headers `GET /items/search` reads: the tenant is optional on the base side. */
export interface SearchHeaders {
  'x-tenant'?: string;
}

/** What `item.changed` carries. */
export interface ItemChanged {
  itemId: string;
  kind: 'created' | 'updated';
}
