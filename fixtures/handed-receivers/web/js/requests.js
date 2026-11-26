// A request opened on a receiver the function is handed, and sent by the caller.
function start(request, id) {
  request.open('POST', `${API_ROOT}/orders/${id}/notes`);
}

function addNote(id, text) {
  const request = new XMLHttpRequest();
  start(request, id);
  request.send(JSON.stringify({ text }));
}

// A receiver and an address both handed in, the request sent where it is opened.
function load(xhr, url) {
  xhr.open('GET', url);
  xhr.send();
}

function loadItems() {
  load(new XMLHttpRequest(), `${API_ROOT}/items`);
}

// Something else with an `open` method: no request.
const popup = { open() {} };

function show(target) {
  target.open('GET', `${API_ROOT}/popup`);
}

show(popup);
