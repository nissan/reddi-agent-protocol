"use client";

import React, { FC, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PlaywrightWalletAdapter } from "@/lib/wallet/playwright-wallet-adapter";
import "@solana/wallet-adapter-react-ui/styles.css";
import { getNetworkProfile } from "@/lib/config/network";

interface Props {
  children: ReactNode;
}

const WalletProvider: FC<Props> = ({ children }) => {
  const network = getNetworkProfile();
  const endpoint = network.solana.rpcHttp;
  const enablePlaywrightWallet = process.env.NEXT_PUBLIC_ENABLE_PLAYWRIGHT_WALLET === "true";

  const wallets = useMemo(() => {
    const adapters: WalletAdapter[] = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ];
    if (enablePlaywrightWallet) {
      adapters.unshift(new PlaywrightWalletAdapter({
        networkProfileName: network.name,
        rpcHttp: endpoint,
        rpcWs: network.solana.rpcWs,
      }));
    }
    return adapters;
  }, [enablePlaywrightWallet, endpoint, network.name, network.solana.rpcWs]);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect={enablePlaywrightWallet}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
};

export default WalletProvider;
