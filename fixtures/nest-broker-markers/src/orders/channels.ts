/**
 * A catalogue of channel names, which is what makes the list form worth having.
 *
 * What matters is that the array is written down here: `as const` sharpens the
 * type but the resolver reads a plain `string[]` just as well. An array
 * *assembled* — spread from another, or mapped — is built at run time, cannot
 * be followed, and is reported rather than resolving to nothing (R38).
 */
export const SHIPPING_CHANNELS = ['order.packed', 'order.dispatched'] as const;
