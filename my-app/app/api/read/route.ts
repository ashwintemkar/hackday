//api/read/route.ts
import { NextRequest, NextResponse } from "next/server";
import { queryChatAndAnswer } from "@/lib/pgvector/query";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const text = await queryChatAndAnswer(body);

    return NextResponse.json({ data: text });
  } catch (error) {
    console.error("Error processing query:", error);
    return NextResponse.json(
      {
        error: "Failed to process query",
      },
      { status: 500 }
    );
  }
}
