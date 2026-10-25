import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const formData = await req.formData();
        const chunk = formData.get("chunk") as Blob;
        const fileId = formData.get("fileId") as string;
        const chunkIndex = parseInt(formData.get("chunkIndex") as string);
        const totalChunks = parseInt(formData.get("totalChunks") as string);
        const chatId = formData.get("chatId") as string;

        if (!fileId || !chunk) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            );
        }

        const tempDir = path.join(os.tmpdir(), 'uploads', fileId);
        await fs.mkdir(tempDir, { recursive: true });

        const metaFilePath = path.join(tempDir, 'meta.json');

        let uploadInfo;
        try {
            const metaContent = await fs.readFile(metaFilePath, 'utf-8');
            uploadInfo = JSON.parse(metaContent);
        } catch (err) {
            uploadInfo = {
                receivedChunks: 0,
                totalChunks: totalChunks,
                chatId: chatId
            };
        }

        const arrayBuffer = await chunk.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        const chunkPath = path.join(tempDir, `chunk_${chunkIndex}`);
        await fs.writeFile(chunkPath, buffer);

        uploadInfo.receivedChunks = (uploadInfo.receivedChunks || 0) + 1;

        await fs.writeFile(metaFilePath, JSON.stringify(uploadInfo));

        return NextResponse.json({
            success: true,
            receivedChunks: uploadInfo.receivedChunks,
            totalChunks: uploadInfo.totalChunks,
        });
    } catch (error) {
        console.error("Error uploading chunk:", error);
        return NextResponse.json(
            { error: "Error uploading chunk" },
            { status: 500 }
        );
    }
}