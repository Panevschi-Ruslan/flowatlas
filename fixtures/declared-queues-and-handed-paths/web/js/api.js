// The shop's address written beside a path each caller hands in.
function getJson(path) {
  return fetch('https://shop.example.test' + path).then((res) => res.json());
}

function postJson(path, body) {
  return fetch(`https://shop.example.test${path}`, { method: 'POST', body: JSON.stringify(body) });
}

function loadProducts() {
  return getJson('/products');
}

function loadProduct(id) {
  return getJson(`/products/${id}`);
}

function placeOrder(order) {
  return postJson('/orders', order);
}

// A path nothing here calls with: left unread, not the shop's root.
function postRaw(path, body) {
  return fetch('https://shop.example.test' + path, { method: 'POST', body });
}
