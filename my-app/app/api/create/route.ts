// api/create/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { S3Service } from "@/lib/s3-service";
import { Document } from "@langchain/core/documents";
import { updateChunks } from "@/lib/pgvector/ingest";
import { processFileContent } from "@/lib/documents/processor";

interface CreateRequestBody {
  chatId: string;
  filePath?: string;
  orgId?: string;
}

export async function POST(req: Request) {
  try {
    const { chatId, filePath, orgId }: CreateRequestBody = await req.json();
    if (!chatId) {
      return NextResponse.json(
        { error: "Chat ID is required" },
        { status: 400 }
      );
    }

    if (orgId && chatId.startsWith('jira_')) {
      const chatFolder = `jira_${orgId}`;

      const processedDocs: Document[] = [];

      if (filePath) {
        try {
          const fileContent = await S3Service.getFile(filePath);
          const fileName = filePath.split('/').pop() || filePath;

          const docs = await processFileContent(fileContent, fileName, chatId);
          processedDocs.push(...docs);
        } catch (error) {
          console.error(`Error processing Jira file $app\api\create\route.ts:`, error);
          return NextResponse.json(
            { error: `Failed to process Jira file: $app\api\create\route.ts` },
            { status: 500 }
          );
        }
      }

      if (processedDocs.length === 0) {
        return NextResponse.json(
          { error: "No valid Jira documents to process" },
          { status: 400 }
        );
      }

      await updateChunks(processedDocs);

      return NextResponse.json({
        data: "Successfully loaded Jira data into the knowledge base",
        processedFiles: processedDocs.map(doc => doc.metadata.source),
        orgId: orgId
      });
    }

      
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { folder: true },
    });

    if (!chat?.folder) {
      return NextResponse.json(
        { error: "Chat folder not found" },
        { status: 404 }
      );
    }

    const processedDocs: Document[] = [];

    if (filePath) {
      try {
        const fileContent = await S3Service.getFile(filePath);
        const fileName = filePath.split('/').pop() || filePath;

        const docs = await processFileContent(fileContent, fileName, chatId);
        processedDocs.push(...docs);
      } catch (error) {
        console.error(`Error processing file $app\api\create\route.ts:`, error);
        return NextResponse.json(
          { error: `Failed to process file: $app\api\create\route.ts` },
          { status: 500 }
        );
      }
    } else {
      console.warn("Processing all files in folder - this is inefficient and should be avoided");
      const files = await S3Service.listFiles(chat.folder);
      const textFiles = files.filter(file => file.endsWith('_processed.txt') || file.endsWith('.txt'));

      for (const fileKey of textFiles) {
        try {
          const fileContent = await S3Service.getFile(fileKey);
          const fileName = fileKey.split('/').pop() || fileKey;

          const docs = await processFileContent(fileContent, fileName, chatId);
          processedDocs.push(...docs);
        } catch (error) {
          console.error(`Error processing file ${fileKey}:`, error);
          continue;
        }
      }
    }

    if (processedDocs.length === 0) {
      return NextResponse.json(
        { error: "No valid documents to process" },
        { status: 400 }
      );
    }

    await updateChunks(processedDocs);

    return NextResponse.json({
      data: "Successfully loaded data into the knowledge base",
      processedFiles: processedDocs.map(doc => doc.metadata.source)
    });
  } catch (err) {
    console.error("Error:", err);
    return NextResponse.json(
      { error: "Failed to process documents" },
      { status: 500 }
    );
  }
}