/**
 * The whole schema, as a query builder's client is typed by it.
 *
 * One interface naming every table. It is emphatically not a table itself:
 * `widgets` and `gadgets` are, and they are named in the string argument of a
 * call rather than anywhere in the types.
 */
export interface DB {
  widgets: { id: string };
  gadgets: { id: string };
}
