// The settings the bundler swaps out, as `vite/client` declares them.
interface ImportMetaEnv {
  readonly VITE_SHOP_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
