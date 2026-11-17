// The flat configuration ignores this directory, so axios is declared for
// nothing here: the call is said, not read.
function loadLegacy() {
  return axios.get(SHOP + '/legacy');
}
