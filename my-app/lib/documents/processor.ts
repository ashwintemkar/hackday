import { Document } from "@langchain/core/documents";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";

export async function processFileContent(content: Buffer, fileName: string, chatId?: string): Promise<Document[]> {
    const fileExtension = fileName.split('.').pop()?.toLowerCase();
    let documents: Document[] = [];

    try {


        if (fileExtension === 'pdf') {
            // Convert Buffer to Uint8Array for proper Blob compatibility
            const uint8Array = new Uint8Array(content);
            const blob = new Blob([uint8Array], { type: 'application/pdf' });
            const loader = new PDFLoader(blob);
            documents = await loader.load();

            documents = documents.map(doc => ({
                ...doc,
                metadata: {
                    ...doc.metadata,
                    source: fileName,
                    type: 'pdf',
                    chatId: chatId
                }
            }));
        } else {
            const textContent = content.toString('utf-8');
            documents = [
                new Document({
                    pageContent: textContent,
                    metadata: {
                        source: fileName,
                        type: 'text',
                        chatId: chatId
                    }
                })
            ];
        }

        documents = documents.filter(doc =>
            doc.pageContent && doc.pageContent.trim().length > 0
        );

        if (documents.length === 0) {
            throw new Error(`No valid content found in ${fileName}`);
        }

        return documents;
    } catch (error) {
        console.error(`Error processing file ${fileName}:`, error);
        throw error;
    }
}