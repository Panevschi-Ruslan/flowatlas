function loadDeals() {
  return ky.get(SHOP + '/deals');
}
