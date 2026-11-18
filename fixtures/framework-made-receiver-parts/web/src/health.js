import { catalogApi, stockApi } from './clients';

// A reader holding the client it is made with.
class Reader {
  constructor(api) {
    this.api = api;
  }

  read(path) {
    return this.api.get(path);
  }

  health() {
    return this.read('/health');
  }
}

// A member of an object handed in.
function viaOptions(options) {
  return options.reader.health();
}

export function catalogOptions() {
  return viaOptions({ reader: new Reader(catalogApi) });
}

// What a function handed in returns.
function viaFactory(make) {
  return make().health();
}

export function stockFactory() {
  return viaFactory(() => new Reader(stockApi));
}

// An element of a list, by index, in a loop, and walked.
function first(readers) {
  return readers[0].health();
}

export function catalogFirst() {
  return first([new Reader(catalogApi)]);
}

function each(readers) {
  for (const reader of readers) reader.health();
}

export function stockEach() {
  return each([new Reader(stockApi)]);
}

function walk(readers) {
  readers.forEach((reader) => reader.health());
}

export function catalogWalk() {
  return walk([new Reader(catalogApi)]);
}

// A member of an object a field of the instance holds.
class Deps {
  constructor(deps) {
    this.deps = deps;
  }

  run() {
    return this.deps.client.health();
  }
}

export function stockDeps() {
  return new Deps({ client: new Reader(stockApi) }).run();
}

// A value a function returns, kept under a name.
function readerOf(api) {
  return new Reader(api);
}

export function catalogMade() {
  const reader = readerOf(catalogApi);
  return reader.health();
}
