// A class whose constructor makes a request, and a constructor function
// that does: what a `new` runs.
class Pulse {
  constructor(every) {
    this.every = every;
    ky.get(CATALOG + '/pulse');
  }
}

function Ticker(label) {
  this.label = label;
  superagent.get(CATALOG + '/tick').end(function () {});
}
