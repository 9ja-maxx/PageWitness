import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import type { GenLayerClient } from "genlayer-js/types";

let readClient: GenLayerClient<typeof testnetBradbury> | null = null;

export function getReadClient(): GenLayerClient<typeof testnetBradbury> {
  if (!readClient) {
    readClient = createClient({ chain: testnetBradbury });
  }
  return readClient;
}

async function ensureBradburyNetwork(provider: Eip1193Provider): Promise<void> {
  const chainIdHex = `0x${testnetBradbury.id.toString(16)}`;
  let currentChainId = "0x0";
  try {
    currentChainId = (await provider.request({ method: "eth_chainId" })) as string;
  } catch {
    // Embedded wallets might not expose eth_chainId reliably; proceed as best effort
  }
  
  if (currentChainId.toLowerCase() === chainIdHex.toLowerCase()) return;
  
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    const code = (error as { code?: number })?.code ?? 0;
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    
    // 4902 code indicates network is not present in wallet config
    if (code === 4902 || message.includes("unrecognized chain") || message.includes("add chain")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: testnetBradbury.name,
            nativeCurrency: testnetBradbury.nativeCurrency,
            rpcUrls: testnetBradbury.rpcUrls.default.http,
            blockExplorerUrls: testnetBradbury.blockExplorers
              ? [testnetBradbury.blockExplorers.default.url]
              : [],
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export async function getWriteClient(
  address: `0x${string}`,
  provider: unknown,
): Promise<GenLayerClient<typeof testnetBradbury>> {
  const eipProvider = provider as Eip1193Provider;
  await ensureBradburyNetwork(eipProvider);
  return createClient({
    chain: testnetBradbury,
    account: address,
    provider: provider as never,
  });
}
