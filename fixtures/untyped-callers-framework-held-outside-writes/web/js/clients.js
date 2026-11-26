// One client per service, each at its own port.
const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });
const stockApi = axios.create({ baseURL: 'http://localhost:4700' });
