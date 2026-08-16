/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID: string;
  readonly VITE_CONTRACT_ADDRESS: `0x${string}`;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
