import { AttachmentData, ProcessedFile, ProcessTicketResult } from "@/types/type";
import { S3Service } from "../s3-service";
import { JiraDocumentProcessor } from "./jira-document-processor";
import { PDFService } from "../pdf-service";
import { deleteTicketFromNamespace, checkTicketExistsInNamespace } from "../pgvector/store";

export async function processTicketDocument(jiraData: any, orgId: string, orgName: string, req: Request, attachments?: AttachmentData[], uploadedFiles?: ProcessedFile[]): Promise<ProcessTicketResult> {
    let uploadedAttachments: string[] = [];
    let allUploadedFiles: string[] = [];
    let processedAttachments: AttachmentData[] = [];

    if (attachments && attachments.length > 0) {
        console.log(`Processing ${attachments.length} attachments for ticket ${jiraData.key}`);

        processedAttachments = await JiraDocumentProcessor.processAttachmentsForDocument(attachments);
        console.log(`Processed ${processedAttachments.length} attachments for ticket ${jiraData.key}`);

        processedAttachments.forEach(att => {
            if (att.extractedText) {
                console.log(`Extracted text from ${att.filename}: ${att.extractedText.substring(0, 200)}...`);
            }
        });

        uploadedAttachments = await JiraDocumentProcessor.processAttachments(attachments, jiraData.key, orgId);
        allUploadedFiles.push(...uploadedAttachments);
    }

    if (uploadedFiles && uploadedFiles.length > 0) {
        console.log(`Processing ${uploadedFiles.length} uploaded files for ticket ${jiraData.key}`);
        
        const uploadedAttachmentsData: AttachmentData[] = await Promise.all(
            uploadedFiles.map(async (file) => {
                if (!file.content) {
                    console.log(`No content for uploaded file ${file.filename}, attempting to fetch from S3`);
                    try {
                        const fileBuffer = await S3Service.getFile(file.s3Key);
                        return {
                            filename: file.filename,
                            content: fileBuffer.toString('base64'),
                            mimeType: file.mimeType,
                            size: file.size
                        };
                    } catch (error) {
                        console.error(`Error fetching file ${file.filename} from S3:`, error);
                        return {
                            filename: file.filename,
                            content: '',
                            mimeType: file.mimeType,
                            size: file.size
                        };
                    }
                }
                
                return {
                    filename: file.filename,
                    content: file.content,
                    mimeType: file.mimeType,
                    size: file.size
                };
            })
        );
            
        const processedUploadedAttachments = await Promise.all(
            uploadedAttachmentsData.map(async (attachment) => {
                try {
                    let extractedText: string | null = null;
                    
                    if (attachment.mimeType === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf')) {
                        console.log(`Processing PDF file from upload: ${attachment.filename}`);
                        const buffer = Buffer.from(attachment.content, 'base64');
                        
                        try {
                            const { textBuffer } = await PDFService.extractImagesAndRewritePDF(
                                buffer,
                                attachment.filename,
                                `jira_${orgId}`
                            );
                            
                            extractedText = textBuffer.toString('utf-8');
                            console.log(`Extracted ${extractedText.length} characters from PDF: ${attachment.filename}`);
                        } catch (pdfError) {
                            console.error(`Error extracting text from PDF ${attachment.filename}:`, pdfError);
                            extractedText = `[Failed to extract text from PDF: ${attachment.filename}]`;
                        }
                    } else {
                        extractedText = await JiraDocumentProcessor.extractTextFromAttachment(attachment);
                    }
                    
                    return {
                        ...attachment,
                        extractedText: extractedText || undefined
                    };
                } catch (error) {
                    console.error(`Error processing attachment ${attachment.filename}:`, error);
                    return {
                        ...attachment,
                        extractedText: `[Error processing attachment: ${attachment.filename}]`
                    };
                }
            })
        );
        
        processedAttachments = [...processedAttachments, ...processedUploadedAttachments];
        const uploadedFileKeys = uploadedFiles.map(file => file.s3Key);
        allUploadedFiles.push(...uploadedFileKeys);
    }

    console.log(`Creating document with ${processedAttachments.length} processed attachments`);
    
    const documentContent = JiraDocumentProcessor.convertToDocument(jiraData, allUploadedFiles, processedAttachments);
    console.log(`Document content created with ${documentContent.length} characters`);
    console.log(`Document contains attachment content: ${documentContent.includes('ATTACHMENT CONTENTS')}`);

    const fileName = JiraDocumentProcessor.generateFileName(jiraData, orgName);
    const chatFolder = `jira_${orgId}`;

    console.log('Processing Jira ticket:', fileName);

    const s3Key = await S3Service.uploadFile(
        Buffer.from(documentContent, 'utf-8'),
        fileName,
        chatFolder
    );

    console.log('Document uploaded to S3:', s3Key);

    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "";
    const baseUrl = `${protocol}://${host}`;

    try {
        const embedResponse = await fetch(`${baseUrl}/api/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chatId: `jira_${orgId}`,
                filePath: s3Key,
                orgId: orgId,
                attachments: allUploadedFiles
            }),
        });

        if (!embedResponse.ok) {
            const errorText = await embedResponse.text();
            console.error("Error response from embeddings API:", errorText);
            throw new Error(`Embeddings API returned ${embedResponse.status}: ${errorText}`);
        }

        console.log('Embeddings creation triggered successfully');

        return {
            fileName,
            s3Key,
            attachments: allUploadedFiles,
            uploadedFiles: uploadedFiles || [],
            processedAttachments: processedAttachments
        };
    } catch (embedError) {
        console.error("Error triggering embeddings:", embedError);
        throw embedError;
    }
}

export function extractResolutionFromTicket(jiraData: any): string | null {
    let resolutionText = '';

    if (jiraData.customfield_10070) {
        const customResolution = typeof jiraData.customfield_10070 === 'string'
            ? jiraData.customfield_10070
            : JiraDocumentProcessor.extractTextFromADF(jiraData.customfield_10070);

        if (customResolution && customResolution.trim()) {
            resolutionText += `${customResolution.trim()}\n`;
        }
    }

    if (jiraData.fields?.customfield_10070) {
        const customResolution = typeof jiraData.fields.customfield_10070 === 'string'
            ? jiraData.fields.customfield_10070
            : JiraDocumentProcessor.extractTextFromADF(jiraData.fields.customfield_10070);

        if (customResolution && customResolution.trim()) {
            resolutionText += `${customResolution.trim()}\n`;
        }
    }

    if (jiraData.fields?.resolution?.description) {
        resolutionText += `${jiraData.fields.resolution.description}\n`;
    }

    if (jiraData.fields?.comment?.comments) {
        const resolutionComments = jiraData.fields.comment.comments
            .filter((comment: any) => {
                const commentText = typeof comment.body === 'string'
                    ? comment.body
                    : JiraDocumentProcessor.extractTextFromADF(comment.body);

                return commentText && (
                    commentText.toLowerCase().includes('resolution') ||
                    commentText.toLowerCase().includes('solution') ||
                    commentText.toLowerCase().includes('fix') ||
                    commentText.toLowerCase().includes('resolved')
                );
            })
            .map((comment: any) => {
                const commentText = typeof comment.body === 'string'
                    ? comment.body
                    : JiraDocumentProcessor.extractTextFromADF(comment.body);

                return `Comment by ${comment.author.displayName} (${new Date(comment.created).toLocaleString()}): ${commentText}`;
            });

        if (resolutionComments.length > 0) {
            resolutionText += `Resolution Comments:\n${resolutionComments.join('\n\n')}\n`;
        }
    }

    return resolutionText.trim() || null;
}

export async function handleTicketStatusUpdate(
    jiraData: any,
    orgId: string,
    orgName: string,
    req: Request,
    attachments?: AttachmentData[],
    uploadedFiles?: ProcessedFile[]
): Promise<ProcessTicketResult> {
    
    const ticketKey = jiraData.key;
    const projectKey = jiraData.fields?.project?.key;
    const currentStatus = jiraData.fields?.status?.name;
    
    console.log(`Handling status update for ticket ${ticketKey}: status = ${currentStatus}`);
    
    if (!projectKey) {
        console.error(`No project key found for ticket ${ticketKey}`);
        throw new Error(`No project key found for ticket ${ticketKey}`);
    }
    
    const doneStatuses = ['Done', 'Resolved', 'Closed', 'Complete', 'Fixed', 'Finished'];
    const isDone = doneStatuses.some(status => 
        currentStatus.toLowerCase() === status.toLowerCase()
    );
    
    const currentNamespace = `${projectKey}_${isDone ? 'done' : 'todo'}`;
    const oppositeNamespace = `${projectKey}_${isDone ? 'todo' : 'done'}`;
    
    console.log(`Current namespace should be: ${currentNamespace}`);
    console.log(`Checking opposite namespace: ${oppositeNamespace}`);
    
    try {
        const existsInOpposite = await checkTicketExistsInNamespace(oppositeNamespace, ticketKey);

        if (existsInOpposite) {
            console.log(`Removing ticket ${ticketKey} from opposite namespace: ${oppositeNamespace}`);
            await deleteTicketFromNamespace(oppositeNamespace, ticketKey);
        }

        const existsInCurrent = await checkTicketExistsInNamespace(currentNamespace, ticketKey);

        if (existsInCurrent) {
            console.log(`Ticket ${ticketKey} already exists in ${currentNamespace}, will update it`);
            await deleteTicketFromNamespace(currentNamespace, ticketKey);
        }
        
        return await processTicketDocument(jiraData, orgId, orgName, req, attachments, uploadedFiles);
        
    } catch (error) {
        console.error(`Error handling status update for ticket ${ticketKey}:`, error);
        throw error;
    }
}