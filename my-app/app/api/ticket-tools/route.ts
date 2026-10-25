import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { embedText } from "@/lib/pgvector/embeddings";
import { authOptions } from "../auth/[...nextauth]/route";
import {
  buildTicketEnvelope,
  summarizeTicketPayload,
  TicketSummaryPayload,
} from "@/lib/ticket-summarizer";

type Mode = "showtech" | "summarize";

type ShowtechPayload = {
  mode: "showtech";
  ticketText: string;
  previousVector?: number[];
};

type SummarizePayload = {
  mode: "summarize";
  ticket: TicketSummaryPayload;
  previousVector?: number[];
};

const DUPLICATE_THRESHOLD = 0.85;

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) {
    throw new Error("Vectors must be the same length and non-empty");
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) {
    throw new Error("Cannot compute similarity on zero magnitude vectors");
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function embedSingle(text: string): Promise<number[]> {
  const [vector] = await embedText([text]);
  if (!vector) {
    throw new Error("Failed to generate embedding");
  }
  return vector;
}

async function handleShowtech(payload: ShowtechPayload) {
  const ticketText = payload.ticketText?.trim();
  if (!ticketText) {
    return NextResponse.json({ error: "Ticket text is required" }, { status: 400 });
  }

  const embedding = await embedSingle(ticketText);

  let similarity: number | null = null;
  let isDuplicate = false;

  if (payload.previousVector) {
    if (!Array.isArray(payload.previousVector)) {
      return NextResponse.json({ error: "previousVector must be an array" }, { status: 400 });
    }

    try {
      similarity = cosineSimilarity(payload.previousVector, embedding);
      isDuplicate = similarity >= DUPLICATE_THRESHOLD;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Similarity calculation failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json({ embedding, similarity, isDuplicate });
}

async function handleSummarize(payload: SummarizePayload) {
  const envelope = buildTicketEnvelope(payload.ticket);
  if (!envelope) {
    return NextResponse.json({ error: "All ticket fields are empty" }, { status: 400 });
  }

  const summary = await summarizeTicketPayload(payload.ticket);
  const embedding = await embedSingle(summary);

  let similarity: number | null = null;
  let isDuplicate = false;

  if (payload.previousVector) {
    if (!Array.isArray(payload.previousVector)) {
      return NextResponse.json({ error: "previousVector must be an array" }, { status: 400 });
    }

    try {
      similarity = cosineSimilarity(payload.previousVector, embedding);
      isDuplicate = similarity >= DUPLICATE_THRESHOLD;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Similarity calculation failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json({ summary, embedding, similarity, isDuplicate });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const mode: Mode | undefined = body?.mode;

    if (mode === "showtech") {
      return await handleShowtech(body as ShowtechPayload);
    }

    if (mode === "summarize") {
      return await handleSummarize(body as SummarizePayload);
    }

    return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
  } catch (error) {
    console.error("Ticket tools API error", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}
