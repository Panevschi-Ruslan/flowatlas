// The settings the bundler swaps out, as `vite/client` declares them.
interface ImportMetaEnv {
  readonly VITE_ORDERS_URL: string;
  readonly VITE_BILLING_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
