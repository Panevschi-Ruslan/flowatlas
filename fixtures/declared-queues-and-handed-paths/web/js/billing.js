// The billing API at the stage each workspace deploys it to.
function liveInvoices() {
  return fetch('https://b4c5d6e7f8.execute-api.eu-west-1.amazonaws.com/live/invoices').then((res) => res.json());
}

function sandboxInvoices() {
  return fetch('https://b4c5d6e7f8.execute-api.eu-west-1.amazonaws.com/sandbox/invoices').then((res) => res.json());
}
