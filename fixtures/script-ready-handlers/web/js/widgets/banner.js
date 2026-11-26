// The override leaves this widget out, so `ky` here is nothing the linter
// declares and no client is read.
window.addEventListener('load', () => {
  ky.get(SHOP + '/banner').json();
});
