import axios from 'axios';

export const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });
export const stockApi = axios.create({ baseURL: 'http://localhost:4700' });

/** A reader whose client is handed to its constructor, typed as nothing. */
export class Reader {
  constructor(private api) {}

  read(path: string) {
    return this.api.get(path);
  }
}
