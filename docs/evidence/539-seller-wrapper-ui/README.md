# #539 Seller-Wrapper Config UI Evidence

Captured on 2026-06-25 for issue #539.

## Scope

This evidence covers the `/onboarding` seller-wrapper config preview panel. The panel reads `GET /api/onboarding/seller-wrapper-config` and displays:

- SOL, USDC, and AUDD rail states.
- MCP and HTTP/OpenAPI wrapper routes.
- Validation state and no-spend/no-network boundaries.
- AUDD payment-plan/proof metadata copy without custody or settlement-finality claims.

## Captures

- `mobile-375.png` — 375 px mobile viewport.
- `tablet-768.png` — 768 px tablet viewport.
- `desktop-1280.png` — 1280 px desktop viewport.
- `seller-wrapper-config-preview.webm` — desktop interaction video showing the preview and copy-config action.

## Validation

Commands run:

```bash
npm install --ignore-scripts
npm run build
npm run check:rap:naming
npm run test:bdd:index
git diff --check origin/main...HEAD
npx eslint app/onboarding/page.tsx components/onboarding/SellerWrapperConfigPreview.tsx e2e/seller-wrapper-config-preview.spec.ts
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3011 PLAYWRIGHT_BROWSER_CHANNEL=chrome npx playwright test e2e/seller-wrapper-config-preview.spec.ts --project=chromium
```

The first Playwright attempt used the managed Chromium cache and failed because the browser executable was missing. `npx playwright install chromium` downloaded the archive but hung during registration, so the final successful run used the installed Chrome channel via `PLAYWRIGHT_BROWSER_CHANNEL=chrome`.

## Boundaries

No wallet signing, RPC calls, provider calls, Pay.sh activation, live/devnet payment, hosted write, npm publish, custody expansion, mainnet action, or settlement-finality claim occurred during capture.
