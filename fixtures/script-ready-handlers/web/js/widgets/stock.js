// No script tag loads ky; the linter's override for the widgets declares it.
window.addEventListener('load', () => {
  ky.get(SHOP + '/stock').json();
});
