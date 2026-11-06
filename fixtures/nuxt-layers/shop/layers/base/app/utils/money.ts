/** Imported in place of the one `../ui-layer` gives: `layers/` ranks above `extends`. */
export const formatMoney = (cents: number): string => (cents / 100).toFixed(2);
