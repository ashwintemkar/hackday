import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { S3Service } from "@/lib/s3-service";
import { prisma } from "@/lib/prisma";
import { ImageExtractor } from "@/lib/image-extractor";
import { OCRService } from "@/lib/ocr-service";
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { fileId, chatId, filename } = await req.json();

        const tempDir = path.join(os.tmpdir(), 'uploads', fileId);
        const metaFilePath = path.join(tempDir, 'meta.json');

        let uploadInfo;
        try {
            const metaContent = await fs.readFile(metaFilePath, 'utf-8');
            uploadInfo = JSON.parse(metaContent);
        } catch (err) {
            return NextResponse.json(
                { error: "Upload not found" },
                { status: 404 }
            );
        }

        if (uploadInfo.receivedChunks !== uploadInfo.totalChunks) {
            return NextResponse.json(
                { error: `Missing chunks: received ${uploadInfo.receivedChunks} of ${uploadInfo.totalChunks}` },
                { status: 400 }
            );
        }

        let totalLength = 0;
        const chunks: Uint8Array[] = [];

        for (let i = 0; i < uploadInfo.totalChunks; i++) {
            const chunkPath = path.join(tempDir, `chunk_${i}`);
            const chunkData = await fs.readFile(chunkPath);
            totalLength += chunkData.length;
            chunks.push(new Uint8Array(chunkData));
        }

        const completeFileBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            completeFileBuffer.set(chunk, offset);
            offset += chunk.length;
        }

        const fileBuffer = Buffer.from(completeFileBuffer.buffer);
        const fileExtension = filename.split('.').pop()?.toLowerCase();

        if (fileExtension === 'pdf') {
            // Process PDF with image extraction
            const { textContent, images } = await ImageExtractor.processDocumentImages(
                fileBuffer,
                filename,
                uploadInfo.chatFolder
            );

            const processedFileName = `${filename.split('.')[0]}_processed.txt`;
            const processedFilePath = await S3Service.uploadFile(
                Buffer.from(textContent),
                processedFileName,
                uploadInfo.chatFolder
            );

            const originalFilePath = await S3Service.uploadFile(
                fileBuffer,
                filename,
                uploadInfo.chatFolder
            );

            const processedFileRecord = await prisma.file.create({
                data: {
                    name: processedFileName,
                    path: processedFilePath,
                    size: textContent.length,
                    type: 'text/plain',
                    chatId: chatId,
                },
            });

            const originalFileRecord = await prisma.file.create({
                data: {
                    name: filename,
                    path: originalFilePath,
                    size: fileBuffer.length,
                    type: getContentType(filename),
                    chatId: chatId,
                },
            });

            const imageRecords: {
                type: string;
                id: string;
                name: string;
                createdAt: Date;
                chatId: string;
                path: string;
                size: number;
            }[] = [];

            for (const image of images) {
                const imageRecord = await prisma.file.create({
                    data: {
                        name: image.name,
                        path: image.s3Key,
                        size: image.buffer.length,
                        type: 'image/png',
                        chatId: chatId,
                    },
                });
                imageRecords.push(imageRecord);
            }


            const protocol = req.headers.get("x-forwarded-proto") || "http";
            const host = req.headers.get("host") || "";
            const baseUrl = `${protocol}://${host}`;

            try {
                await fetch(`${baseUrl}/api/create`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatId }),
                });
            } catch (embedError) {
                console.error("Error triggering embeddings:", embedError);
            }

            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error("Error cleaning up temp files:", cleanupError);
            }

            // Terminate OCR worker after processing
            try {
                await OCRService.terminate();
            } catch (terminateError) {
                console.warn('Error terminating OCR worker:', terminateError);
            }

            return NextResponse.json({
                success: true,
                file: processedFileRecord,
                originalFile: originalFileRecord,
                extractedImages: imageRecords,
                message: "PDF uploaded, images extracted, and processed successfully",
            });
        } else {
            const filePath = await S3Service.uploadFile(
                fileBuffer,
                filename,
                uploadInfo.chatFolder
            );

            const fileRecord = await prisma.file.create({
                data: {
                    name: filename,
                    path: filePath,
                    size: fileBuffer.length,
                    type: getContentType(filename),
                    chatId: chatId,
                },
            });

            const protocol = req.headers.get("x-forwarded-proto") || "http";
            const host = req.headers.get("host") || "";
            const baseUrl = `${protocol}://${host}`;

            try {
                await fetch(`${baseUrl}/api/create`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chatId }),
                });
            } catch (embedError) {
                console.error("Error triggering embeddings:", embedError);
            }

            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error("Error cleaning up temp files:", cleanupError);
            }

            // Terminate OCR worker after processing
            try {
                await OCRService.terminate();
            } catch (terminateError) {
                console.warn('Error terminating OCR worker:', terminateError);
            }

            return NextResponse.json({
                success: true,
                file: fileRecord,
                message: "File uploaded and processed successfully",
            });
        }
    } catch (error) {
        console.error("Error completing upload:", error);

        // Clean up OCR worker even on error
        try {
            await OCRService.terminate();
        } catch (terminateError) {
            console.warn('Error terminating OCR worker after error:', terminateError);
        }

        return NextResponse.json(
            { error: "Error completing upload", success: false },
            { status: 500 }
        );
    }
}

function getContentType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'pdf': return 'application/pdf';
        case 'txt': return 'text/plain';
        case 'md': return 'text/markdown';
        case 'png': return 'image/png';
        case 'jpg': case 'jpeg': return 'image/jpeg';
        case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'doc': return 'application/msword';
        default: return 'application/octet-stream';
    }
}
