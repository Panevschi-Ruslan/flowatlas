/** The item list, which the page asks for again on a click. */
export const listItems = (): Promise<Response> => fetch('/api/items');
