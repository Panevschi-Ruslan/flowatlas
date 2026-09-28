/**
 * The client a front end writes itself, which is what most front ends do.
 *
 * Nothing here is installed and nothing here has a type the compiler was told
 * anything about: a class, three verbs, one private transport, and one exported
 * instance every screen imports. The verbs are written as properties holding
 * arrows rather than as methods, because an instance passed around whole is how
 * this shape is always used and an arrow is what keeps `this` when it is.
 *
 * `post` reaches the browser's own client two members away — through `send`,
 * which is private — and that chain is the thing that has to be followed for the
 * class to be recognised without anybody declaring it.
 */
export interface Order {
  id: string;
  name: string;
}

class ApiClient {
  private send = async (path: string, method: string, body?: object): Promise<unknown> => {
    const answer = await fetch(path, { method, body: JSON.stringify(body) });
    return answer.json();
  };

  get = (path: string): Promise<unknown> => this.send(path, 'GET');

  post = (path: string, body?: object): Promise<unknown> => this.send(path, 'POST', body);

  /** A member named for a verb the class does not send, to prove it is not read as one. */
  patch = (path: string): string => path;
}

export const api = new ApiClient();
