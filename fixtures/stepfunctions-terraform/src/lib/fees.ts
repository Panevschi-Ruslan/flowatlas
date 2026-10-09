/** Twenty-five pence a day, capped at the replacement cost of the item. */
export const lateFee = (daysOverdue: number, replacementCost: number): number =>
  Math.min(daysOverdue * 25, replacementCost);
