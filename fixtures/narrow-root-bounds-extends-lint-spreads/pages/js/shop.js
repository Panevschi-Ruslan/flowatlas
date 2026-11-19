const CATALOG = 'http://localhost:4800';

// Each client is a global its linter configuration declares: `ky` by
// `plugin:shop/browser`, `superagent` by `plugin:shop/forms`, `axios` by
// `plugin:shop/legacy`. Nothing declares `$`.
function items() {
  return ky.get(CATALOG + '/items');
}

function orders() {
  superagent.get(CATALOG + '/orders').end(function () {});
}

function stock() {
  return axios.get(CATALOG + '/stock');
}

function legacy() {
  return $.get(CATALOG + '/legacy');
}
