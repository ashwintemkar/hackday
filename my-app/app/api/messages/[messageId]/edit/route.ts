
// app/api/messages/[messageId]/edit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../auth/[...nextauth]/route";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { content } = await req.json();
    const resolvedParams = await params;
    const messageId = resolvedParams.messageId;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: true },
    });

    if (!message || message.chat.userId !== session.user.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const subsequentMessages = await prisma.message.findMany({
      where: {
        chatId: message.chatId,
        createdAt: {
          gt: message.createdAt,
        },
      },
      orderBy: { createdAt: 'asc' }
    });

    await prisma.$transaction(async (tx) => {
      if (subsequentMessages.length > 0) {
        await tx.message.deleteMany({
          where: {
            id: {
              in: subsequentMessages.map(msg => msg.id),
            },
          },
        });
      }

      await tx.message.update({
        where: { id: messageId },
        data: {
          content,
          createdAt: new Date()
        },
      });

      await tx.chat.update({
        where: { id: message.chatId },
        data: { updatedAt: new Date() }
      });
    });

    return NextResponse.json({
      success: true,
      deletedCount: subsequentMessages.length
    });
  } catch (error) {
    console.error("Error updating message:", error);
    return NextResponse.json(
      { error: "Error updating message" },
      { status: 500 }
    );
  }
}