/**
 * The whole database as one type, which is how kysely is parameterised.
 *
 * Nothing here is a table a query can be pointed at: `DB` is the schema, and the
 * table is whichever of its keys a query names in the call that starts it.
 */
export interface DB {
  asset: { id: string; ownerId: string; type: string };
  asset_exif: { assetId: string; make: string };
  asset_metadata: { assetId: string; key: string; value: string };
}
