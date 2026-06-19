import Link from "next/link";
import { MarketplaceApprovalQueue } from "@/components/manager/listings/MarketplaceApprovalQueue";
import { getMarketplaceApprovalQueue } from "@/lib/manager/marketplace-listings";

export default function ManagerListingsPage() {
  const queue = getMarketplaceApprovalQueue();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 space-y-3">
        <Link href="/manager" className="text-sm text-accent-green hover:text-white">
          Manager operations
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Marketplace approval queue</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
              Imported listing preview queue
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review fixture-backed imported agent-stack listing states before publication. This is a read-only operator UI; live publish, payment, readiness, attestation, and trust mutations remain deferred.
            </p>
          </div>
          <Link
            href="/manager/discovery"
            className="inline-flex min-h-10 items-center rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Open discovery review
          </Link>
        </div>
      </header>

      <MarketplaceApprovalQueue queue={queue} />
    </div>
  );
}
