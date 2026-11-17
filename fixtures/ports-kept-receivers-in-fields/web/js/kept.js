// Ports a class or a module keeps as numbers, handed into a port's place.
class Ports {
  static stock = 4700;

  static get catalog() {
    return 4600;
  }
}

const CATALOG_PORT = 4600;

function health(port) {
  return fetch(`http://localhost:${port}/health`);
}

function stockHealth() {
  return health(Ports.stock);
}

function catalogHealth() {
  return health(Ports.catalog);
}

function catalogHealthAgain() {
  return health(CATALOG_PORT);
}

// Written in place, in a port's place.
function stockLevels() {
  return fetch(`http://localhost:${Ports.stock}/levels`);
}

// A number a class keeps in a path's place is a value of the path's.
class Paging {
  static size = 20;
}

function latestPage() {
  return fetch(`http://localhost:4600/latest/${Paging.size}`);
}
