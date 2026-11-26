import axios, { type AxiosInstance } from 'axios';

const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });
const stockApi = axios.create({ baseURL: 'http://localhost:4700' });

/** A client held in a field its type names, handed in by each `new`. */
export class Reader {
  constructor(private readonly api: AxiosInstance) {}

  read(path: string) {
    return this.api.get(path);
  }

  health() {
    return this.read('/health');
  }
}

export function latestProducts() {
  return new Reader(catalogApi).read('/latest');
}

export function stockLevels() {
  return new Reader(stockApi).read('/levels');
}

/** A caller handed the instance it calls the method on. */
export function check(reader: Reader) {
  return reader.health();
}

export function catalogUp() {
  return check(new Reader(catalogApi));
}

export function stockUp() {
  const reader = new Reader(stockApi);
  return check(reader);
}

/** The instance kept in a field of the caller's own. */
export class Board {
  constructor(private readonly reader: Reader) {}

  show() {
    return this.reader.health();
  }
}

export const catalogBoard = () => new Board(new Reader(catalogApi)).show();

export const stockBoard = () => new Board(new Reader(stockApi)).show();
