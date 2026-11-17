function loadPromos() {
  return axios.get(SHOP + '/promos');
}

// ky is declared only by the export the flat configuration does not import.
function loadDeals() {
  return ky(SHOP + '/deals');
}
