/** The settings the build swaps in. */
const env = { PUBLIC_SHARE: import.meta.env.VITE_PUBLIC_SHARE as string | undefined };

export default env;
