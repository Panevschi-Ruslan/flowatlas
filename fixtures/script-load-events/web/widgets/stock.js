function loadLevels() {
  return axios.get(SHOP + '/stock/levels');
}
