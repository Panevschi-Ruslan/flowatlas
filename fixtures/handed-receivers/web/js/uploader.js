// A field declared empty and filled in by one method, sent by another.
class Uploader {
  request = null;

  begin() {
    this.request = new XMLHttpRequest();
    this.request.open('PUT', `${API_ROOT}/files`);
  }

  finish(file) {
    this.request.send(file);
  }
}

// A field the constructor is handed.
class StatusPoller {
  constructor(request) {
    this.request = request;
  }

  poll() {
    this.request.open('GET', `${API_ROOT}/status`);
    this.request.send();
  }
}

const poller = new StatusPoller(new XMLHttpRequest());
