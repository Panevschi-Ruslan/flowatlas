/** The settings the build swaps in. */
const env = { KIOSK_MODE: import.meta.env.VITE_KIOSK_MODE as string | undefined };

export default env;
