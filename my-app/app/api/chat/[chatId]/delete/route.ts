// app/api/chat/[chatId]/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../auth/[...nextauth]/route";
import { S3Service } from "@/lib/s3-service";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const chatId = resolvedParams.chatId;

    if (!chatId) {
      return NextResponse.json({ error: "Chat ID required" }, { status: 400 });
    }

    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: session.user.id,
      },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.file.deleteMany({
        where: { chatId: chatId },
      });

      await tx.message.deleteMany({
        where: { chatId: chatId },
      });

      await tx.chat.delete({
        where: { id: chatId },
      });
    });

    if (chat.folder) {
      try {
        await S3Service.deleteFile(`documents/${chat.folder}/`);
      } catch (s3Error) {
        console.error("Error deleting S3 folder:", s3Error);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error deleting chat:", error.message);
    }
    return NextResponse.json({ error: "Error deleting chat" }, { status: 500 });
  }
}