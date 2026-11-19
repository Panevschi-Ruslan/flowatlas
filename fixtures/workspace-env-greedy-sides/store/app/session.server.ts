/** Only the server runs a `.server` module, whoever imports it. */
export const whoAmI = () => fetch(`${process.env.FILES_URL}/files/session/current`);
