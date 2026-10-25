//previously used /api/upload/route.ts

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { S3Service } from "@/lib/s3-service";
import { ImageExtractor } from "@/lib/image-extractor";
import { OCRService } from "@/lib/ocr-service";

export async function POST(req: Request) {
  try {
    console.log('Starting POST request processing');
    const session = await getServerSession(authOptions);
    console.log('Session:', session);
    if (!session?.user?.id) {
      console.log('Unauthorized: No user session');
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    console.log('Form data received');
    const file = formData.get("file") as File;
    const chatId = formData.get("chatId") as string;
    console.log('File:', file?.name);
    console.log('ChatId:', chatId);

    if (!file || !chatId) {
      console.log('Missing required fields');
      return NextResponse.json(
        { error: "File and chatId are required" },
        { status: 400 }
      );
    }


    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
    });
    console.log('Chat found:', chat);

    if (!chat?.folder) {
      console.log('Chat folder not found');
      return NextResponse.json(
        { error: "Chat folder not found" },
        { status: 404 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    console.log('File buffer created, size:', buffer.length);

    const { textContent, images } = await ImageExtractor.processDocumentImages(
      buffer,
      file.name,
      chat.folder
    );
    console.log('Document processed, extracted images count:', images.length);

    const processedFileName = `${file.name.split('.')[0]}_processed.txt`;
    console.log('Processing file:', processedFileName);
    const processedFilePath = await S3Service.uploadFile(
      Buffer.from(textContent),
      processedFileName,
      chat.folder
    );
    console.log('Processed file uploaded to:', processedFilePath);

    const originalFilePath = await S3Service.uploadFile(buffer, file.name, chat.folder);
    console.log('Original file uploaded to:', originalFilePath);

    const processedFileRecord = await prisma.file.create({
      data: {
        name: processedFileName,
        path: processedFilePath,
        size: textContent.length,
        type: 'text/plain',
        chatId: chatId,
      },
    });
    console.log('Processed file record created:', processedFileRecord);

    const originalFileRecord = await prisma.file.create({
      data: {
        name: file.name,
        path: originalFilePath,
        size: buffer.length,
        type: file.type,
        chatId: chatId,
      },
    });
    console.log('Original file record created:', originalFileRecord);

    const imageRecords: any[] = [];
    for (const image of images) {
      console.log('Processing image:', image.name);
      const imageRecord = await prisma.file.create({
        data: {
          name: image.name,
          path: image.s3Key,
          size: image.buffer.length,
          type: 'image/png',
          chatId: chatId,
        },
      });
      console.log('Image record created:', imageRecord);
      imageRecords.push(imageRecord);
    }

    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "";
    const baseUrl = `${protocol}://${host}`;
    console.log('Base URL:', baseUrl);


    try {
      console.log('Triggering embeddings creation for specific file');
      await fetch(`${baseUrl}/api/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          filePath: processedFilePath
        }),
      });
      console.log('Embeddings creation triggered successfully');
    } catch (embedError) {
      console.error("Error triggering embeddings:", embedError);
    }

    console.log('Processing completed successfully');
    
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
      message: "File uploaded and processed successfully",
    });
  } catch (error: any) {
    console.error("Error uploading file:", error);
    
    // Clean up OCR worker even on error
    try {
      await OCRService.terminate();
    } catch (terminateError) {
      console.warn('Error terminating OCR worker after error:', terminateError);
    }
    
    return NextResponse.json(
      {
        error: "Error uploading file",
        details: error instanceof Error ? error.message : 'An unknown error occurred',
        success: false
      },
      { status: 500 }
    );
  }
}
