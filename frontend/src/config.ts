// PageWitness Frontend Runtime Configuration

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;
export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined;

export const NETWORK_NAME = "testnetBradbury" as const;
export const EXPLORER_BASE = "https://explorer-bradbury.genlayer.com";
export const FAUCET_URL = "https://testnet-faucet.genlayer.foundation";

export const isConfigured = Boolean(PRIVY_APP_ID && CONTRACT_ADDRESS);
