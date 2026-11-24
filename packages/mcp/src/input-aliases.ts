/**
 * Inputs written under the name an agent reaches for, read as the name the
 * tool takes (P382).
 *
 * An agent that asks `check_contract({route: "PATCH /orders/:id/cancel"})`
 * means the route, and was answered "give either edge, or both from and to":
 * a failed call, a grep and a read of the handlers, six turns for one call.
 * The names here are the ones agents were seen to write, each read as the
 * tool's own input when that is not given too; they are not listed, so the
 * upfront listing pays nothing for them, and the tool's own name stays the
 * one every `next` writes.
 */
export const INPUT_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  check_contract: { route: 'edge', entry: 'edge' },
  get_flow: { route: 'entry', symbol: 'entry', id: 'entry' },
  get_source: { id: 'symbol', entry: 'symbol', route: 'symbol' },
  describe_for_prompt: { symbol: 'id', entry: 'id', route: 'id' },
  who_calls: { route: 'symbol', id: 'symbol', entry: 'symbol' },
  impact: { route: 'symbol', id: 'symbol', entry: 'symbol' },
  // `dead({symbol})` for `dead({id})`: the key every other symbol tool takes.
  dead: { symbol: 'id', entry: 'id', route: 'id', symbols: 'ids' },
  get_type: { id: 'type', name: 'type', ids: 'types' },
});

/** The arguments with each alias read as its tool's own input, where the own one is not given; the same object when none applies. */
export const withInputAliases = (tool: string, args: Record<string, unknown>): Record<string, unknown> => {
  const aliases = INPUT_ALIASES[tool];
  if (aliases === undefined) return args;
  let out: Record<string, unknown> | undefined;
  for (const [alias, own] of Object.entries(aliases)) {
    if (!(alias in args) || own in (out ?? args)) continue;
    out ??= { ...args };
    out[own] = out[alias];
    delete out[alias];
  }
  return out ?? args;
};
