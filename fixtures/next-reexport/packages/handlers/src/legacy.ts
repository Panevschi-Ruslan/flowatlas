/**
 * The older router's half of the same shape.
 *
 * One file answers every verb from its default export, and here the application's
 * file holds nothing but the forwarding line: `export { default } from …`. The
 * handler itself is here, and it is the last declaration in a long file on
 * purpose.
 */

interface LegacyRequest {
  readonly method?: string;
}

interface LegacyResponse {
  json(body: unknown): void;
}

/**
 * What the older router calls, whichever verb arrived.
 *
 * Declared at the bottom so that its line is far past the end of the one-line
 * file that re-exports it. Before R99 that line was reported against the
 * one-line file, which is the worst form the defect takes: the file has no such
 * line at all, so nothing a reader does with the pair can recover from it.
 */
const legacyHandler = async (
  request: LegacyRequest,
  response: LegacyResponse,
): Promise<void> => {
  response.json({ method: request.method ?? 'GET' });
};

export default legacyHandler;
