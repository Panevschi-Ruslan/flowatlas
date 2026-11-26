// The page's requests, kept as the methods of one object. axios is the global
// the page's script tag loads.
const api = {
  items() {
    return axios.get(`${SHOP}/items`).then((res) => res.data);
  },
  item: function (id) {
    return axios.get(`${SHOP}/items/${id}`).then((res) => res.data);
  },
  reviews: {
    list: (id) => fetch(`${SHOP}/items/${id}/reviews`).then((res) => res.json()),
  },
};
