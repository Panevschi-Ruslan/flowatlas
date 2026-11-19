// The whole script is a wrapper run at once: what its top writes, outside any
// function, is drawn from the wrapper, a function of its own.
(function () {
  superagent.get(SHOP + '/items').send({ page: 1 });

  function order(item) {
    return superagent.post(SHOP + '/orders').send({ item: item });
  }

  document.getElementById('order').addEventListener('click', function () {
    order(1);
  });
})();
