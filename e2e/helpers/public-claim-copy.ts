import type { Page } from "@playwright/test";

import {
  EXTERNAL_CLAIM_SCOPE_SELECTOR,
  FORBIDDEN_PUBLIC_CLAIMS,
  claimIsQualified,
} from "../../lib/public-claims/public-claim-boundary-terms";

/**
 * The rendered copy this repository owns: the page's DOM with every
 * registry/user-supplied subtree removed. Specialist and candidate cards carry
 * strings a third-party devnet registrant wrote, so scanning them would let an
 * account nobody here controls decide whether the claim gate passes.
 */
export async function firstPartyCopy(page: Page): Promise<string> {
  return page.evaluate((externalSelector) => {
    document.querySelectorAll(externalSelector).forEach((node) => node.remove());
    return document.body.innerText;
  }, EXTERNAL_CLAIM_SCOPE_SELECTOR);
}

export function unqualifiedClaims(copy: string): string[] {
  const violations: string[] = [];
  for (const line of copy.split(/\r?\n/)) {
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      if (!claim.pattern.test(line)) continue;
      if (claimIsQualified(line, claim)) continue;
      violations.push(`[${claim.id}] ${claim.reason} :: ${line.trim()}`);
    }
  }
  return violations;
}
