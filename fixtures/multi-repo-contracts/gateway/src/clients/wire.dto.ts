import { Exclude, Expose, Transform } from '../validation';

/** The same set of values `orders` spells out as a literal union. */
export enum Channel {
  Web = 'web',
  Phone = 'phone',
}

/**
 * The caller's half of the wire pair.
 *
 * Every field is declared the way TypeScript sees it before serialisation, and
 * the receiver declares the same field the way JSON delivers it. Neither is
 * wrong, and the rules are what say so.
 */
export class WireDto {
  /** A date, read back as text. */
  placedAt: Date;
  /** JSON has no number that holds this, so it crosses as text. */
  reference: bigint;
  /** Binary, which arrives as text. */
  signature: Buffer;
  /** Admits nothing, which is optionality rather than absence. */
  note: string | undefined;
  /** Dropped on the way out; the receiver does not require it. */
  @Exclude()
  secret: string;
  /** Renamed on the way out, and the receiver declares the new name. */
  @Expose({ name: 'customer_id' })
  customerId: string;
  /** A function decides the value, so nothing here describes what arrives. */
  @Transform(({ value }: { value: unknown }) => Number(value))
  coupon: string;
  /** Nothing is claimed about it on either side. */
  extras: any;
  /** An enum here, the same values spelled out there. */
  channel: Channel;
  /** Neither of these survives JSON: one warning each, whatever both sides say. */
  tags: Set<string>;
  counts: Map<string, number>;
  /** The name the receiver renames its own field to. */
  shipping_city: string;
  /** The receiver drops this one, so what is sent lands nowhere. */
  internalNote: string;
  /** The receiver decides this one with a function. */
  score: string;
}

/** Two ways to deliver. The receiver has only heard of one of them. */
export enum Delivery {
  Post = 'post',
  Courier = 'courier',
}

/**
 * The caller's half of the pair that must still fail.
 *
 * A date is text on the wire and the receiver declares a number; a field that
 * can only ever hold nothing is never written at all while the receiver
 * requires it; and a value the receiver has never heard of is still a value the
 * receiver has never heard of.
 */
export interface WireBrokenDto {
  placedAt: Date;
  reference: undefined;
  delivery: Delivery;
}
