/**
 * `Shape1` and `Shape2` are structurally identical and differ only in name and
 * in field declaration order, so their `structuralHash` MUST be equal
 * (P02 §12; names are dropped and fields are sorted in the pre-image, D4).
 */
export interface Shape1 {
  id: string;
  count: number;
  tags: string[];
}

export interface Shape2 {
  tags: string[];
  id: string;
  count: number;
}
