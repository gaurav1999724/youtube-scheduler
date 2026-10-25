import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { processLibrary } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await processLibrary();
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
