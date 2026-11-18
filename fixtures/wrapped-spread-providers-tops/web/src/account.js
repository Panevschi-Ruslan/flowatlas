// Clients of the repository's own whose base is written on the instance,
// outside the class: the class sets the field to nothing until then.
export class AccountClient {
  constructor() {
    this.base = '';
  }

  get(path) {
    return fetch(this.base + path);
  }
}

export const account = new AccountClient();
account.base = 'http://localhost:4600/account';

export class LevelsClient {
  constructor() {
    this.base = null;
  }

  get(path) {
    return fetch(this.base + path);
  }
}

/** Writes the base over a value it is handed, typed as nothing. */
function configure(client) {
  client.base = 'http://localhost:4700/v2';
}

export const levels = new LevelsClient();
configure(levels);
