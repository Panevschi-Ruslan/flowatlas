import { procedure, router } from '../../trpc';

/**
 * A feature's tree nobody finished hooking up (P270): no tree holds it, no
 * file serves it and nothing imports it, so no request can reach either way
 * in under it.
 */
export const couponsRouter = router({
  redeem: procedure.mutation(() => ({ redeemed: true })),
  list: procedure.query(() => []),
});
