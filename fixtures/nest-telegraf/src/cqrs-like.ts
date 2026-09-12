/**
 * A local decorator exported under a name the bot framework also uses.
 *
 * Nothing here registers a bot handler, so an entry point derived from it would
 * be invented. The adapter must reject it on its declaration, not on its name.
 */
export const Action = (event: string): MethodDecorator => () => undefined;
