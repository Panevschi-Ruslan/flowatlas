// `@fx/wire` — the one declaration both repositories import.
//
// A type that lives here cannot drift: both ends resolve to a single registry
// id, so `flowatlas contracts` answers `shared` and never walks its fields. It is
// here to be the control case beside the copies that do drift.

/** Money, declared once for the whole project. */
export interface MoneyDto {
  amount: number;
  currency: string;
}
