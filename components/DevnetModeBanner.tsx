"use client";

import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { LimitNotice } from "@/components/ui/limit-notice";
import { appNetwork, isDevnetOnlyRoute } from "@/lib/config/launch-stage";

/**
 * Says which network a wallet action on this page uses (#1151).
 *
 * Devnet build: once a wallet connects, every page says it is devnet.
 * Mainnet build: pages whose payments always run on devnet (Try it, the Agent pass, the Planner,
 * the sandbox) say so to every visitor, connected or not; any other page tells a connected
 * wallet that its actions use real funds.
 */
export default function DevnetModeBanner() {
  const { connected } = useWallet();
  const pathname = usePathname();
  const network = appNetwork();

  if (network === "mainnet") {
    if (isDevnetOnlyRoute(pathname)) {
      return (
        <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8" data-testid="network-banner" data-network="devnet">
          <LimitNotice title="This page runs on Solana devnet." className="text-xs sm:text-sm">
            Payments here use test funds, not real money. Set your wallet to devnet. Budgets run on mainnet.
          </LimitNotice>
        </div>
      );
    }
    if (!connected) return null;
    return (
      <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8" data-testid="network-banner" data-network="mainnet">
        <LimitNotice tone="warning" title="You're on Solana mainnet." className="text-xs sm:text-sm">
          Wallet actions here use real funds.
        </LimitNotice>
      </div>
    );
  }

  if (!connected) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8" data-testid="network-banner" data-network="devnet">
      <LimitNotice title="You're on Solana devnet." className="text-xs sm:text-sm">
        Wallet actions here use test funds. Mainnet is coming soon.
      </LimitNotice>
    </div>
  );
}
