import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorMessage } from "@/lib/types";

export function toErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message || "Invalid input." },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
}
