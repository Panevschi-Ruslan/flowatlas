// A host a method always answers with, and a port each caller hands after it.
class Probe {
  origin() {
    return 'http://localhost';
  }

  check(port) {
    return fetch(`${this.origin()}${port}/health`);
  }
}

function probeCatalog() {
  return new Probe().check(':4600');
}

function probeStock() {
  return new Probe().check(':4700');
}

// A port a class keeps as a constant, handed after a host a method answers.
class Ports {
  static stock = ':4700';
}

function probeKept() {
  return new Probe().check(Ports.stock);
}

// Checked as the page loads, outside any function: the request stays where it
// is written, its port unread and the path read.
new Probe().check(Ports.stock);
