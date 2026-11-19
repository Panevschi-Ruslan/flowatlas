// Everything the page does waits for the document: the handler is a function
// of its own, and what it keeps inside is kept as the top of a script is.
document.addEventListener('DOMContentLoaded', function () {
  const catalog = require('./bundle');
  fetch(SHOP + '/items?page=1');

  function showItem(id) {
    return catalog.findItem(id);
  }

  const panel = {
    open: function () {
      return catalog.listCatalog();
    },
  };

  showItem(1);
  panel.open();
});
