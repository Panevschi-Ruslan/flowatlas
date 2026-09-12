/**
 * Mutual recursion A ↔ B (§10): two entries, each referring to the other by id;
 * the traversal must terminate.
 */
export interface A {
  name: string;
  b: B;
}

export interface B {
  code: number;
  a: A;
}
