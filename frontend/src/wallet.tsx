import React from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { getWriteClient } from "./lib/genlayer";
import { PRIVY_APP_ID } from "./config";
import { LogIn, LogOut, Wallet } from "lucide-react";
import { shortAddr } from "./lib/format";

export function WalletAuthProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["wallet", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#9333ea", // vibrant purple
          showWalletLoginFirst: true,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

export function useWalletAuth() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  const { wallets } = useWallets();

  const connectedWallet = wallets[0];
  const address = connectedWallet?.address as `0x${string}` | undefined;

  const getClient = async () => {
    if (!address || !connectedWallet) {
      throw new Error("Wallet not connected.");
    }
    const provider = await connectedWallet.getEthereumProvider();
    return getWriteClient(address, provider);
  };

  return {
    login,
    logout,
    authenticated,
    ready,
    address,
    user,
    getClient,
  };
}

export function WalletStatusButton() {
  const { authenticated, ready, address, login, logout } = useWalletAuth();

  if (!ready) {
    return (
      <button className="wallet-btn loading" disabled>
        <span className="btn-spinner" />
      </button>
    );
  }

  if (authenticated && address) {
    return (
      <div className="wallet-connected-group">
        <span className="wallet-address-tag">
          <Wallet size={14} className="ico" />
          {shortAddr(address, 4)}
        </span>
        <button className="wallet-btn disconnect-btn" onClick={logout} title="Disconnect Wallet">
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  return (
    <button className="wallet-btn connect-btn" onClick={login}>
      <LogIn size={14} />
      <span>Connect</span>
    </button>
  );
}
