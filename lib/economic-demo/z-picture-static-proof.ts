/* Static bounded replay fixture for /economic-demo/z-picture-proof. */

export const Z_PICTURE_STATIC_IMAGE_URL = "/proofs/z-picture-2026-05-09T002401254Z-ce217dd3.png";

export const Z_PICTURE_STATIC_PROOF = {
  "ok": true,
  "runId": "z-picture-2026-05-09T002401254Z-ce217dd3",
  "prompt": "Generate a clean high-contrast square image showing one large capital letter Z, centered, bold, unmistakable, on a simple futuristic dark background.",
  "image": {
    "provider": "openai",
    "model": "gpt-image-1",
    "receipt": "openai:image:1778286279237"
  },
  "walletAuthorization": {
    "wallet": "HkKCys9nF8Y9vqU4KjkZ7C68djpGqRK7u2K6map2uDLj",
    "signature": "tkA7sI8N4L1YqZKsYATTDUwBwV3jHz+XqDxi+Ca1VZXsXf3r0KYKEBVKqLwBE5fzo0wN87UtMCsQq+e3hnP8CA==",
    "message": "Authorize Reddi Agent Protocol economic demo Z image call on Solana devnet for wallet HkKCys9nF8Y9vqU4KjkZ7C68djpGqRK7u2K6map2uDLj at 2026-05-09T00:23:51.397Z",
    "boundary": "Client Phantom signature authorizes this browser demo run; x402 transfer signer is reported separately in paidRun.orchestratorWallet and does not imply mainnet or production readiness."
  },
  "paidRun": {
    "runId": "economic-demo-paid-devnet-b9734abe-5c30-447c-844c-cf78b9d0efb8",
    "generatedAt": "2026-05-09T00:24:24.327Z",
    "status": "complete",
    "scenarioId": "picture",
    "network": "solana-devnet",
    "orchestratorWallet": "3Vmcwra5tfxGwaX3jnpmYybCd7gH4fstJzi1Yci38f94",
    "maxCalls": 4,
    "maxUsdc": 0.2,
    "spentUsdc": "0.130000"
  },
  "paymentTxs": [
    {
      "profileId": "planning-agent",
      "signature": "2TwZD3kGTCLu3hbKa4ebkfPDVEtJbCqTcuCyw1JRENxfg9G7S4VNwDU5TKvXdnn1gHRemveoQHPdKt5B4rno8aGX",
      "solscan": "https://solscan.io/tx/2TwZD3kGTCLu3hbKa4ebkfPDVEtJbCqTcuCyw1JRENxfg9G7S4VNwDU5TKvXdnn1gHRemveoQHPdKt5B4rno8aGX?cluster=devnet"
    },
    {
      "profileId": "content-creation-agent",
      "signature": "5eDbe4JAJwnpjncjDYKsja9hK5bUvK1gafxR5cp1JURLPP21x3Bim1NDfuHEJ6BugiEh2sUTRCXWWji8kF8j9no4",
      "solscan": "https://solscan.io/tx/5eDbe4JAJwnpjncjDYKsja9hK5bUvK1gafxR5cp1JURLPP21x3Bim1NDfuHEJ6BugiEh2sUTRCXWWji8kF8j9no4?cluster=devnet"
    },
    {
      "profileId": "code-generation-agent",
      "signature": "kHcf2e9RFWKFFudBenGboffkty7eup58gp1v5FD3VKgVytV965PQpYtwwAeNarBNMEzuADcb6vTzYWKCNjGJknq",
      "solscan": "https://solscan.io/tx/kHcf2e9RFWKFFudBenGboffkty7eup58gp1v5FD3VKgVytV965PQpYtwwAeNarBNMEzuADcb6vTzYWKCNjGJknq?cluster=devnet"
    },
    {
      "profileId": "verification-validation-agent",
      "signature": "3xgcj4A6Tq1vePakcDXsGZWh4symCFtdkm6Xd5A93xETDmXzfQMZGcirqPyGx3wMrGxE7h6jLMmxKqZDcWA38hDH",
      "solscan": "https://solscan.io/tx/3xgcj4A6Tq1vePakcDXsGZWh4symCFtdkm6Xd5A93xETDmXzfQMZGcirqPyGx3wMrGxE7h6jLMmxKqZDcWA38hDH?cluster=devnet"
    }
  ],
  "perProof": {
    "artifact": "artifacts/quasar-per-magicblock-cpi-smoke/20260507T220250Z-post-pr267-upgrade/summary.json",
    "programId": "7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb",
    "teeRpcUrl": "https://devnet-tee.magicblock.app",
    "payer": "3Vmcwra5tfxGwaX3jnpmYybCd7gH4fstJzi1Yci38f94",
    "payee": "FDgGLUoZG4aCRg7ZspWNaZg92CQYYSnBGniBNN43cDYZ",
    "lockTx": "5ytS8ZckXSwDCgBi3hsvJa21tMA8DMLp4B18rnPpFYPQiGtbakVsZE8cC4MZdwzzpJ6EK5VhXrRRuFEBqhNYtcPQ",
    "delegateTx": "3JCzpBo7Wz7hi6hP89ggRhfcvBDz9mGAgfjKDQxzaNtkkK7nbWEkiaQH7nE3HyjmbAxpywpGSV3CujsBwdoGxb5P",
    "releaseTx": "2Hj5pFtuAeDuYEDe5PP6hEi3ybVbfNXW5BVSAEimNGgvs1VVR8d7xqofkeVqkTZ9dQhDZr25nhCWATU2GGk1M7TC",
    "commitTx": "Wamr7MNcub7pbVNnmMgF7bEXGVSztRarqnT6UBshcthbDk816KdGjhQuQxH3GJuWT9sMBZRGbYU2LVUG6CZeZAK",
    "claim": "MagicBlock PER reference proof: bounded Quasar-owned agent-vault experiment with redacted TEE auth and delegated account ownership; not a production privacy, custody, mainnet, or arbitrary-wallet/private-payee settlement claim.",
    "solscan": {
      "lock": "https://solscan.io/tx/5ytS8ZckXSwDCgBi3hsvJa21tMA8DMLp4B18rnPpFYPQiGtbakVsZE8cC4MZdwzzpJ6EK5VhXrRRuFEBqhNYtcPQ?cluster=devnet",
      "delegate": "https://solscan.io/tx/3JCzpBo7Wz7hi6hP89ggRhfcvBDz9mGAgfjKDQxzaNtkkK7nbWEkiaQH7nE3HyjmbAxpywpGSV3CujsBwdoGxb5P?cluster=devnet",
      "release": "https://solscan.io/tx/2Hj5pFtuAeDuYEDe5PP6hEi3ybVbfNXW5BVSAEimNGgvs1VVR8d7xqofkeVqkTZ9dQhDZr25nhCWATU2GGk1M7TC?cluster=devnet",
      "commit": "https://solscan.io/tx/Wamr7MNcub7pbVNnmMgF7bEXGVSztRarqnT6UBshcthbDk816KdGjhQuQxH3GJuWT9sMBZRGbYU2LVUG6CZeZAK?cluster=devnet"
    }
  },
  "torque": {
    "score": {
      "consumer": {
        "wallet": "HkKCys9nF8Y9vqU4KjkZ7C68djpGqRK7u2K6map2uDLj",
        "before": 42,
        "after": 47,
        "event": "consumer_query_run"
      },
      "agent": {
        "wallet": "2wYpzbExNi2vHSdK48jBusfEx3WNVjzPFEVNcbCA5cAs",
        "before": 88,
        "after": 93,
        "event": "specialist_job_completed"
      },
      "note": "Dashboard score is the demo-local Torque reputation projection immediately after emitting Torque-compatible events; external campaign leaderboard may lag or remain empty in sandbox mode."
    }
  },
  "claimBoundary": "Static bounded replay fixture for the completed devnet proof. Records devnet x402 payment-proof references plus bounded MagicBlock PER reference evidence only; no mainnet, custody, production readiness, or production private settlement claim."
} as const;
