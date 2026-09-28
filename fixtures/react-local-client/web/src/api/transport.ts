/**
 * The transport two of the clients here share.
 *
 * An ordinary exported function, so the requests written through it are read the
 * way a module of plain functions has always been read: the address is a
 * parameter, nothing here settles it, and it is followed out to whoever passes
 * one. What no caller here passes is a readable address — both of the classes
 * pass their own parameter on — so this file's own request stays here, which is
 * exactly the row a wrapper nobody could follow is supposed to leave.
 */
export const send = async (path: string, method: string, body?: object): Promise<unknown> => {
  const answer = await fetch(path, { method, body: JSON.stringify(body) });
  return answer.json();
};
