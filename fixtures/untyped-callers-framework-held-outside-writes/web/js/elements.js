// An element the page connects: the browser calls connectedCallback on the one appended.
class RecentFeed extends HTMLElement {
  constructor(client) {
    super();
    this.client = client;
  }

  connectedCallback() {
    return this.client.get('/recent');
  }
}

function stockFeed() {
  const feed = new RecentFeed(stockApi);
  document.body.appendChild(feed);
  return feed;
}

function previewFeed() {
  return new RecentFeed(catalogApi);
}

// An element made twice and appended by neither maker: which one the browser connects is not read.
class Ticker extends HTMLElement {
  constructor(client) {
    super();
    this.client = client;
  }

  connectedCallback() {
    return this.client.get('/ticks');
  }
}

function catalogTicker() {
  return new Ticker(catalogApi);
}

function stockTicker() {
  return new Ticker(stockApi);
}
