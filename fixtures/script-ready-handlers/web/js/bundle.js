// A CommonJS script a bundler joins for the page: the client it requires is
// the client it imports, and what it exports names its functions.
const axios = require('axios');

function listCatalog() {
  return axios.get(SHOP + '/catalog');
}

function findItem(id) {
  return axios.get(SHOP + '/items/' + id);
}

module.exports = { listCatalog, findItem: findItem };
