/** Code of the API's package the back office calls: still read there, as a function. */
export const orderNumber = (id: string): string => `#${id.padStart(6, '0')}`;
