function loadCart() {
  return superagent.get(SHOP + '/cart');
}
