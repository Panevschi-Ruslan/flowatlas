/** The moves the live board redraws for: a set written out in its own file. */
export const OTHER_EVENTS: ReadonlySet<string> = new Set(['ORDER_MOVED', 'TABLE_MOVED']);

/** The seating events, by an enum member. */
export enum SeatEvent {
  Merged = 'TABLE_MERGED',
}

/** The same, as a list written `as const`. */
export const SEAT_EVENTS = [SeatEvent.Merged] as const;
