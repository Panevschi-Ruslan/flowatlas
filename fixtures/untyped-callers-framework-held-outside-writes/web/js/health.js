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

// A caller handed the instance it calls the method on, with no type.
function check(reader) {
  return reader.health();
}

function catalogUp() {
  return check(new Reader(catalogApi));
}

function stockUp() {
  const reader = new Reader(stockApi);
  return check(reader);
}

// The address handed through the same kind of call.
function levels(reader) {
  return reader.read('/levels');
}

function stockLevels() {
  return levels(new Reader(stockApi));
}

// The instance kept in a field of the caller's own.
class Board {
  constructor(reader) {
    this.reader = reader;
  }

  show() {
    return this.reader.health();
  }
}

function catalogBoard() {
  return new Board(new Reader(catalogApi)).show();
}

function stockBoard() {
  return new Board(new Reader(stockApi)).show();
}
