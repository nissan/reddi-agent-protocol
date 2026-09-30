import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Z_PICTURE_STATIC_IMAGE_URL, Z_PICTURE_STATIC_PROOF } from "@/lib/economic-demo/z-picture-static-proof";

async function latestRunDir() {
  const root = join(process.cwd(), "artifacts", "economic-demo-z-picture");
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("z-picture-")).map((entry) => entry.name).sort();
  if (!dirs.length) throw new Error("no_z_picture_runs");
  return join(root, dirs.at(-1)!);
}

function staticProofResponse(reason: string) {
  return Response.json({
    ok: true,
    source: "static-bounded-fallback",
    fallbackReason: reason,
    summary: Z_PICTURE_STATIC_PROOF,
    imageUrl: Z_PICTURE_STATIC_IMAGE_URL,
  });
}

export async function GET() {
  try {
    const dir = await latestRunDir();
    const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8"));
    const imageB64 = await readFile(join(dir, "z-image.png"), "base64");
    return Response.json({ ok: true, source: "local-artifact", summary, imageUrl: `data:image/png;base64,${imageB64}` });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return staticProofResponse(reason);
  }
}
