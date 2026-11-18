// One client class of the repository's own, whose instances are each given
// their own base outside it: the class sets the field to nothing until then.
export class ApiClient {
  constructor() {
    this.base = '';
  }

  get(path) {
    return fetch(this.base + path);
  }
}

export const catalogClient = new ApiClient();
catalogClient.base = 'http://localhost:4600/v1';

/** Writes the base over a value it is handed, typed as nothing. */
function configure(client) {
  client.base = 'http://localhost:4700/v2';
}

export const stockClient = new ApiClient();
configure(stockClient);

export const ordersClient = new ApiClient();
Object.assign(ordersClient, { base: 'http://localhost:4600/orders' });
