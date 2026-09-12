/**
 * Channel names declared in this repo: step 2 of the resolver, the half that
 * does not leave the repo (`meta.channelVia: "enum"` / `"const"`).
 */
export enum Topics {
  ORDER_CREATED = 'order.created',
  ORDER_PAID = 'order.paid',
}

const PREFIX = 'order';

/**
 * A computed initializer whose hole is another const with a literal value:
 * §10 row 4, the resolvable half — "resolve nested consts one level".
 * Expected: `channel:order.computed`, static.
 */
export const COMPUTED_TOPIC = `${PREFIX}.computed`;

const region = (): string => 'eu';

/**
 * The same form with a hole that is a call, so one level of const-following
 * still leaves no literal: §10 row 4, the degrading half.
 * Expected: unresolved `channel-const-unresolved`.
 */
export const REGION_TOPIC = `${region()}.order.created`;
