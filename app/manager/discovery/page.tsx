import Link from "next/link";
import { OperatorDiscoveryWorkspace } from "@/components/manager/discovery/OperatorDiscoveryWorkspace";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

export default function ManagerDiscoveryPage() {
  const workspace = getStaticAgentStackReviewWorkspace();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 space-y-3">
        <Link href="/manager" className="text-sm text-accent-green hover:text-white">
          Manager operations
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Operator discovery review</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">
              Static imported catalog workspace
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Inspect imported repo, plugin, connector, command, and skill groups from package-owned fixture states before any marketplace supply path. All controls are read-only placeholders.
            </p>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            External imported content is untrusted, not RAP-attested, and static-only.
          </div>
        </div>
      </header>

      <OperatorDiscoveryWorkspace workspace={workspace} />
    </div>
  );
}
