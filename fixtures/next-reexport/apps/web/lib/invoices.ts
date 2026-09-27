/**
 * A handler declared in the application, in a file that is not a route file.
 *
 * The control for the other two: the re-export crosses no package boundary, so
 * whatever the tool says about it cannot be blamed on the workspace. The line
 * still belongs to this file and the route file's line still belongs to the route
 * file.
 */

const invoices: unknown[] = [];

export const GET = async (): Promise<Response> => Response.json(invoices);
