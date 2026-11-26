// A value written straight after the host, read by what each caller hands it.
function versioned(version) {
  return fetch(`https://shop.example.test${version}/products`).then((res) => res.json());
}

function productsV1() {
  return versioned('/v1');
}

function productsV2() {
  return versioned('/v2');
}

// A port, where every caller hands one: part of the host.
function local(port) {
  return fetch(`http://localhost${port}/health`);
}

function checkLocal() {
  return local(':4600');
}

// Nobody hands it anything: the host kept, the path unread.
function lost(segment) {
  return fetch('https://shop.example.test' + segment + '/lost');
}
