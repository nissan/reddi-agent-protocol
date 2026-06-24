import { getOnboardingSellerWrapperConfig } from "@/lib/onboarding/seller-wrapper-config";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({
      ok: true,
      result: getOnboardingSellerWrapperConfig(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Seller wrapper config generation failed",
      },
      { status: 400 }
    );
  }
}
