/** Reads a JSON answer from an address of the wiki's API. */
export const getJson = (url: string) => fetch(url).then((res) => res.json());
