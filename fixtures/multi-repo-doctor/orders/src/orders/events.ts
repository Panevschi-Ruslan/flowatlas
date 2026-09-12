/**
 * A channel name assembled rather than written.
 *
 * Nothing static can read what this returns, which is what makes an annotation
 * on the method that publishes through it the honest way to say the name — and
 * what makes an annotation given this expression instead of a literal unreadable
 * in exactly the same way.
 */
export const channelFor = (suffix: string): string => `order.${suffix}`;
