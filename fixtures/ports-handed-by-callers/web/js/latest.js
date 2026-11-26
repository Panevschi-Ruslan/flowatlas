// Instances made with different bases, handed with the path to one receiver.
function readWith(client, path) {
  return client.get(path);
}

function latestProducts() {
  return readWith(axios.create({ baseURL: 'http://localhost:4600' }), '/latest');
}

function stockLevels() {
  return readWith(axios.create({ baseURL: 'http://localhost:4700' }), '/levels');
}

// The path written one caller out, the instance handed one further.
function readHealth(client) {
  return readWith(client, '/health');
}

function stockHealthCheck() {
  return readHealth(axios.create({ baseURL: 'http://localhost:4700' }));
}
