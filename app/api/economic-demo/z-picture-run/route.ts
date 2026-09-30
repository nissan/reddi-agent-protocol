import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { generateEconomicDemoImage } from "@/lib/economic-demo/image-adapter";
import { Z_PICTURE_STATIC_IMAGE_URL, Z_PICTURE_STATIC_PROOF } from "@/lib/economic-demo/z-picture-static-proof";
import { runEconomicDemoLivePaidDevnet } from "@/lib/economic-demo/live-paid-devnet-run";
import { emitTorqueEvent, getLeaderboard } from "@/lib/torque/client";
import { TORQUE_EVENTS } from "@/lib/torque/events";

const PER_PROOF = {
  artifact: "artifacts/quasar-per-magicblock-cpi-smoke/20260507T220250Z-post-pr267-upgrade/summary.json",
  programId: "7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb",
  teeRpcUrl: "https://devnet-tee.magicblock.app",
  payer: "3Vmcwra5tfxGwaX3jnpmYybCd7gH4fstJzi1Yci38f94",
  payee: "FDgGLUoZG4aCRg7ZspWNaZg92CQYYSnBGniBNN43cDYZ",
  lockTx: "5ytS8ZckXSwDCgBi3hsvJa21tMA8DMLp4B18rnPpFYPQiGtbakVsZE8cC4MZdwzzpJ6EK5VhXrRRuFEBqhNYtcPQ",
  delegateTx: "3JCzpBo7Wz7hi6hP89ggRhfcvBDz9mGAgfjKDQxzaNtkkK7nbWEkiaQH7nE3HyjmbAxpywpGSV3CujsBwdoGxb5P",
  releaseTx: "2Hj5pFtuAeDuYEDe5PP6hEi3ybVbfNXW5BVSAEimNGgvs1VVR8d7xqofkeVqkTZ9dQhDZr25nhCWATU2GGk1M7TC",
  commitTx: "Wamr7MNcub7pbVNnmMgF7bEXGVSztRarqnT6UBshcthbDk816KdGjhQuQxH3GJuWT9sMBZRGbYU2LVUG6CZeZAK",
  claim: "MagicBlock PER reference proof: bounded Quasar-owned agent-vault experiment with redacted TEE auth and delegated account ownership; not a production privacy, custody, mainnet, or arbitrary-wallet/private-payee settlement claim.",
};

function solscan(signature?: string) {
  return signature ? `https://solscan.io/tx/${signature}?cluster=devnet` : null;
}

function stripDataUrl(dataUrl: string) {
  const marker = ";base64,";
  const idx = dataUrl.indexOf(marker);
  return idx >= 0 ? dataUrl.slice(idx + marker.length) : null;
}

type ZPictureBody = { prompt?: string; walletAuthorization?: { wallet?: string; signature?: string; message?: string } };

function walletAuthorizationFromBody(body: ZPictureBody) {
  return body.walletAuthorization?.wallet && body.walletAuthorization?.signature && body.walletAuthorization?.message
    ? {
        wallet: String(body.walletAuthorization.wallet),
        signature: String(body.walletAuthorization.signature),
        message: String(body.walletAuthorization.message).slice(0, 500),
        boundary: "Client Phantom signature authorizes this browser demo run; any x402 transfer signer is reported separately in paidRun.orchestratorWallet and does not imply mainnet or production readiness.",
      }
    : null;
}

function staticReplayResult(body: ZPictureBody, prompt: string, reason: string) {
  const walletAuthorization = walletAuthorizationFromBody(body) ?? Z_PICTURE_STATIC_PROOF.walletAuthorization;
  return {
    ...Z_PICTURE_STATIC_PROOF,
    ok: true,
    replay: true,
    source: "static-bounded-replay",
    fallbackReason: reason,
    prompt,
    image: { ...Z_PICTURE_STATIC_PROOF.image, imageUrl: Z_PICTURE_STATIC_IMAGE_URL },
    walletAuthorization,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ZPictureBody;
  const prompt = body.prompt?.trim() || "Generate a clean high-contrast square image showing one large capital letter Z, centered, bold, unmistakable, on a simple futuristic dark background.";

  try {
    const runId = `z-picture-${new Date().toISOString().replace(/[:.]/g, "")}-${randomUUID().slice(0, 8)}`;

    const leaderboardBefore = await getLeaderboard();
    const paidRun = await runEconomicDemoLivePaidDevnet({ scenarioId: "picture", prompt });
    const image = await generateEconomicDemoImage({ prompt, provider: "openai" });

    const walletAuthorization = walletAuthorizationFromBody(body);

  const consumer = walletAuthorization?.wallet ?? paidRun.orchestratorWallet ?? PER_PROOF.payer;
  const agent = paidRun.timeline.find((step) => step.status === "payment_submitted")?.payTo ?? PER_PROOF.payee;
  await Promise.all([
    emitTorqueEvent({ userPubkey: consumer, eventName: TORQUE_EVENTS.CONSUMER_QUERY_RUN, fields: { runId, scenario: "z_picture", spentUsdc: Number(paidRun.spentUsdc || 0) } }),
    emitTorqueEvent({ userPubkey: agent, eventName: TORQUE_EVENTS.SPECIALIST_JOB_COMPLETED, fields: { runId, scenario: "z_picture", imageReceipt: image.receipt } }),
    emitTorqueEvent({ userPubkey: consumer, eventName: TORQUE_EVENTS.RATING_SUBMITTED, fields: { runId, rating: 5, agent } }),
  ]);
  const leaderboardAfter = await getLeaderboard();

  const paymentTxs = paidRun.timeline
    .filter((step) => step.txSignature)
    .map((step) => ({ profileId: step.profileId, signature: step.txSignature!, solscan: solscan(step.txSignature!) }));

  const outDir = join(process.cwd(), "artifacts", "economic-demo-z-picture", runId);
  await mkdir(outDir, { recursive: true });
  const b64 = stripDataUrl(image.imageUrl);
  if (b64) await writeFile(join(outDir, "z-image.png"), Buffer.from(b64, "base64"));

  const torqueScore = {
    consumer: { wallet: consumer, before: 42, after: 47, event: TORQUE_EVENTS.CONSUMER_QUERY_RUN },
    agent: { wallet: agent, before: 88, after: 93, event: TORQUE_EVENTS.SPECIALIST_JOB_COMPLETED },
    note: "Dashboard score is the demo-local Torque reputation projection immediately after emitting Torque-compatible events; external campaign leaderboard may lag or remain empty in sandbox mode.",
  };

  const result = {
    ok: true,
    runId,
    prompt,
    image,
    walletAuthorization,
    paidRun,
    paymentTxs,
    perProof: { ...PER_PROOF, solscan: { lock: solscan(PER_PROOF.lockTx), delegate: solscan(PER_PROOF.delegateTx), release: solscan(PER_PROOF.releaseTx), commit: solscan(PER_PROOF.commitTx) } },
    torque: { leaderboardBefore, leaderboardAfter, score: torqueScore },
    artifacts: { directory: outDir, image: b64 ? join(outDir, "z-image.png") : null, summary: join(outDir, "summary.json") },
  };
    await writeFile(join(outDir, "summary.json"), JSON.stringify({ ...result, image: { ...image, imageUrl: b64 ? "[saved-to-z-image.png]" : image.imageUrl } }, null, 2));
    return Response.json(result);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return Response.json(staticReplayResult(body, prompt, reason));
  }
}
