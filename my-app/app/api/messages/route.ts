//app/api/messages/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { content, chatId, role } = body;

    if (!content || !chatId || !role) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const message = await prisma.message.create({
      data: {
        content,
        chatId,
        role,
        createdAt: new Date(),
      },
      include: {
        chat: true,
      },
    });

    if (role === 'user') {
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 2 } }
      });
      
      if (chat && chat.messages.length <= 1) {
        const chatName = content.length > 50 ? `${content.substring(0, 47)}...` : content;
        
        await prisma.chat.update({
          where: { id: chatId },
          data: { name: chatName }
        });
      }
    }

    return NextResponse.json({ message, success: true });
  } catch (error) {
    console.error("Error saving message:", error);

    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message, success: false },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Error saving message", success: false },
      { status: 500 }
    );
  }
}