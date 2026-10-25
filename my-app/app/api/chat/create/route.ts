// api/chat/create/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { S3Service } from "@/lib/s3-service";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const timestamp = Date.now();
    const folderName = `chat_${timestamp}`;

    try {
      await S3Service.createFolder(folderName);
    } catch (s3Error) {
      console.error("Error creating S3 folder:", s3Error);
      return NextResponse.json(
        { error: "Failed to create chat directory in S3" },
        { status: 500 }
      );
    }

    const chat = await prisma.chat.create({
      data: {
        userId: session.user.id,
        name: "Untitled",
        folder: folderName,
      },
    });

    if (!chat) {
      await S3Service.deleteFile(`documents/${folderName}/`);
      return NextResponse.json(
        { error: "Failed to create chat" },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: chat.id, folder: folderName });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Error creating chat:", errorMessage);

    return NextResponse.json({ error: "Error creating chat" }, { status: 500 });
  }
}