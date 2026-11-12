/** Every JSON request of the storefront, the address handed in. */
export const getJson = (url: string) => fetch(url).then((res) => res.json());
