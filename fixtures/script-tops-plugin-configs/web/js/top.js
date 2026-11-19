// No wrapper and no handler: the top of the script runs as the page loads it,
// and is a function of its own, top.js:top.
ky(SHOP + '/catalog');
record('home');

function record(page) {
  return fetch(SHOP + '/visits', { method: 'POST', body: JSON.stringify({ page: page }) });
}
