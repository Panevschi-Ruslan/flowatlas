/**
 * Self-recursive type: exactly one registry entry, `children` refs the entry's
 * own id, and the hash pre-image uses `#cycle` (§10 "Recursive type").
 */
export interface Category {
  id: string;
  name: string;
  children: Category[];
}
