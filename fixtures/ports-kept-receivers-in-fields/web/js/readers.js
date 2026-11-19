// A receiver kept in a field the constructor fills, the path handed in.
class Reader {
  constructor(api) {
    this.api = api;
  }

  read(path) {
    return this.api.get(path);
  }
}

const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });
const stockApi = axios.create({ baseURL: 'http://localhost:4700' });

function latestProducts() {
  return new Reader(catalogApi).read('/latest');
}

function stockLevelsRead() {
  const reader = new Reader(stockApi);
  return reader.read('/levels');
}

// A receiver that is a property of an object handed in.
function readOn(options, path) {
  return options.client.get(path);
}

function latestOn() {
  return readOn({ client: catalogApi }, '/latest');
}

function levelsOn() {
  const client = stockApi;
  return readOn({ client }, '/levels');
}
