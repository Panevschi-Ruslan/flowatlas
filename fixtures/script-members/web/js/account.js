/* global axios */
// A module of the page whose default export is an object of requests.
export default {
  profile() {
    return axios.get('http://localhost:4700/account').then((res) => res.data);
  },
  save(profile) {
    return axios.put('http://localhost:4700/account', { name: profile.name });
  },
};
