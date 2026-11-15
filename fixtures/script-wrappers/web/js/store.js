// The page's store, kept out of the page's globals by a wrapper run at once,
// and handed to the page by name.
(function () {
  var api = {
    items: function () {
      return fetch(SHOP + '/items').then(function (res) {
        return res.json();
      });
    },
  };

  function Cart(owner) {
    this.owner = owner;
  }

  Cart.prototype.add = function (item, quantity) {
    return fetch(SHOP + '/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: item, quantity: quantity }),
    });
  };

  Object.assign(Cart.prototype, {
    get total() {
      return fetch(SHOP + '/cart/total').then(function (res) {
        return res.json();
      });
    },
    set coupon(code) {
      fetch(SHOP + '/cart/coupon', { method: 'PUT', body: JSON.stringify({ code: code }) });
    },
  });

  window.api = api;
  window.Cart = Cart;
})();
