"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { LimitNotice } from "@/components/ui/limit-notice";

export default function DevnetModeBanner() {
  const { connected } = useWallet();

  if (!connected) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
      <LimitNotice title="You're on Solana devnet." className="text-xs sm:text-sm">
        Wallet actions here use test funds. Mainnet is coming soon.
      </LimitNotice>
    </div>
  );
}
