import { recordDelivery } from './store.js';

/**
 * The body of a route the application only re-exports.
 *
 * Deliberately declared far down the file, further down than the route file that
 * re-exports it is long. That is what makes the mismatch visible rather than
 * merely wrong: a route file of seven lines reported at line 20 names a position
 * that does not exist, so a reader who follows it lands nowhere at all and has
 * no way of telling that the line came from another file.
 *
 * It calls something in turn, so that the fixture also says whether the body was
 * read rather than only pointed at. A call target gets a node whether anybody
 * opened its body or not; the setting and the outbound request one file over are
 * only found by walking this body.
 *
 * The verb is exported under the name the framework looks for, so the route file
 * needs to do nothing but forward it.
 */
export const POST = async (request: Request): Promise<Response> => {
  const delivery = await request.json();
  return Response.json(await recordDelivery(delivery));
};
