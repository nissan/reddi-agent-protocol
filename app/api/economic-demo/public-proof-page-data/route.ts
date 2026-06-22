import { NextResponse } from "next/server";
import { getPublicProofPageData } from "@/lib/economic-demo/public-proof-page-data";

export async function GET() {
  return NextResponse.json(getPublicProofPageData());
}
