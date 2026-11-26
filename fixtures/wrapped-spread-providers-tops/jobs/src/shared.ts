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

/** Providers kept in a list another module spreads into its own. */
export const SHARED_PROVIDERS = [
  { provide: 'LEVELS_READER', useValue: new Reader(stockApi) },
  { provide: 'MIRROR_READER', useExisting: 'LEVELS_READER' },
];
