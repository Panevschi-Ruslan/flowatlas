// A port every caller hands, after the host's colon: one request per caller.
function health(port) {
  return fetch(`http://localhost:${port}/health`);
}

function catalogHealth() {
  return health(4600);
}

function stockHealth() {
  return health(4700);
}

// The same written straight after the host, each caller handing `:port`.
function ping(port) {
  return fetch(`http://localhost${port}/health`);
}

function pingCatalog() {
  return ping(':4600');
}

function pingStock() {
  return ping(':4700');
}
