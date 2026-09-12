/**
 * Base of `Order`. Its fields are flattened into `Order`'s `fields` (D3) and the
 * base itself is recorded in `Order`'s `meta.extends`.
 */
export interface BaseEntity {
  id: string;
  createdAt: Date;
}
