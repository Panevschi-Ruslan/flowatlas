/**
 * A route file at a real address that exports no verb this can read.
 *
 * The framework serves nothing from it either — it collects the exports named
 * after HTTP verbs and finds none — but the file is in the address space and
 * saying nothing about it is how a reader turns a hole into a clean bill of
 * health. So there is a row.
 */
const handlers = { get: () => undefined };

export default handlers;
