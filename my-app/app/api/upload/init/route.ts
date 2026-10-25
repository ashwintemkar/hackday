import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { filename, fileSize, totalChunks, chatId, fileId } = await req.json();

    if (!filename || !fileSize || !totalChunks || !chatId || !fileId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat?.folder) {
      return NextResponse.json(
        { error: "Chat folder not found" },
        { status: 404 }
      );
    }

    const tempDir = path.join(os.tmpdir(), 'uploads', fileId);
    await fs.mkdir(tempDir, { recursive: true });

    const metaFilePath = path.join(tempDir, 'meta.json');
    const uploadInfo = {
      filename,
      fileSize,
      totalChunks,
      chatId,
      receivedChunks: 0,
      chatFolder: chat.folder
    };

    await fs.writeFile(metaFilePath, JSON.stringify(uploadInfo));

    return NextResponse.json({
      success: true,
      fileId,
      message: "Upload initialized"
    });
  } catch (error) {
    console.error("Error initializing upload:", error);
    return NextResponse.json(
      { error: "Error initializing upload" },
      { status: 500 }
    );
  }
}