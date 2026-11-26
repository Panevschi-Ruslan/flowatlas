// A number written straight after a host with no colon before it: no port.
function probe(port) {
  return fetch(`http://localhost${port}/health`);
}

function probeCatalog() {
  return probe(4600);
}

// The same with the colon handed in: the port.
function probeStock() {
  return probe(':4700');
}
