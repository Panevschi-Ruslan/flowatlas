import { restHandler } from '@medusajs/framework';

/**
 * A verb that is the value a call of a package handed back.
 *
 * The way in is real and keeps its node — the call is where the framework
 * enters — and there is nothing of this repository behind it, so nothing that
 * happens after the request is in the graph. That is a hole in the coverage of
 * this one route and it gets a row of its own (R94), which is the same reading
 * the other file-system router does and now the same code.
 */
export const POST = restHandler({ provider: 'any' });
