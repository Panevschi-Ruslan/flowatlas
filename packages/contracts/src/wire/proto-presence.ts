import { withRule, type WireRule } from './rule.js';

/**
 * A field of a gRPC message, as the protocol and its libraries carry it (P287).
 *
 * Protocol buffers have no field a sender must write but a proto2 `required`
 * one: a field left out arrives as its default, or as absent where it has
 * presence. So on the receiving side a field the contract declares (marked
 * `meta.protoPresence` by the reader of the `.proto` file) is optional, and
 * a sender that always writes it is not at odds with anything - the
 * comparator asks no question of its optionality. What the field holds is
 * still compared.
 *
 * And a field whose form the reading library chooses (`meta.protoForm:
 * 'library'`: a 64-bit integer, `bytes`, an enum) is, when the message is
 * what is sent, whatever the reader's library makes of it - a `number` or
 * text, a buffer or base64, a name or a number - so it is not compared on
 * that side. A writer of one is still held to the forms a library accepts.
 */
export const protoPresence: WireRule = {
  id: 'proto-presence',
  describe: 'a field of a gRPC message may be left out by the sender, and its library decides how a 64-bit integer, bytes or an enum is read',
  normalise: (view, side) => {
    if (side === 'sender') return view.meta['protoForm'] === 'library' ? withRule({ ...view, opaque: true }, 'proto-presence') : view;
    const presence = view.meta['protoPresence'];
    if (presence !== 'implicit' && presence !== 'explicit') return view;
    return withRule({ ...view, optional: true, optionalBy: view.optionalBy ?? 'proto-presence' }, 'proto-presence');
  },
};
