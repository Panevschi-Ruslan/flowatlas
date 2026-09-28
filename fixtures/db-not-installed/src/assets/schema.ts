/**
 * The whole database as one type, which is how a typed query builder is
 * parameterised. Nothing here is a table a query can be pointed at: the table
 * is whichever of these keys a query names in the call that starts it.
 */
export interface DB {
  asset: { id: string; ownerId: string };
  asset_face: { assetId: string; personId: string };
}
