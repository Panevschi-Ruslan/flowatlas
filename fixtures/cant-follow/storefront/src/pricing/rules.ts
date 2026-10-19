/** Rules are a shape, not a class: nothing says which implementation runs. */
export interface DiscountRules {
  apply(sku: string, amount: number): number;
}
