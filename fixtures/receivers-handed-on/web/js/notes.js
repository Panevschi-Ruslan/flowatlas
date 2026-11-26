// A request opened on a receiver handed on through a function that sends it.
function start(request) {
  request.open('POST', 'https://shop.example.test/notes');
}

function send(request, text) {
  start(request);
  request.send(JSON.stringify({ text }));
}

function addNote(text) {
  send(new XMLHttpRequest(), text);
}

// Handed on twice, and sent by the caller that made it.
function begin(request) {
  request.open('PUT', 'https://shop.example.test/drafts');
}

function prepare(request) {
  begin(request);
}

function saveDraft(draft) {
  const request = new XMLHttpRequest();
  prepare(request);
  request.send(JSON.stringify({ draft }));
}
