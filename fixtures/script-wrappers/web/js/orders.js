// superagent, the global the page's script tag loads, with the body handed
// to `.send` along the chain.
window.orders = {
  place: function (cart) {
    return superagent.post(SHOP + '/orders').set('Accept', 'application/json').send({ cart: cart });
  },
};
