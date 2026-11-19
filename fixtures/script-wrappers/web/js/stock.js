// No script tag loads ky; the linter's configuration declares it.
var stock = (function () {
  function load() {
    return ky.get(SHOP + '/stock').json();
  }
  return { load: load };
})();
