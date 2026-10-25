import { AttachmentData, JiraTicket, ValidationResult } from "@/types/type";
import { S3Service } from "../s3-service";
import { PDFService } from "../pdf-service";

export class JiraDocumentProcessor {
    static validateJiraData(data: any): ValidationResult {
        const errors: string[] = [];

        if (!data.fields?.project?.name) {
            errors.push("Missing fields.project.name");
        }
        if (!data.key) {
            errors.push("Missing issue.key");
        }
        if (!data.fields?.summary) {
            errors.push("Missing fields.summary");
        }
        if (!data.fields?.status?.name) {
            errors.push("Missing fields.status.name");
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static extractTextFromADF(adfContent: any): string {
        if (typeof adfContent === 'string') {
            return adfContent;
        }

        if (!adfContent || !adfContent.content) {
            return '';
        }

        let text = '';

        function traverse(node: any): void {
            if (node.text) {
                text += node.text;
            }

            if (node.content && Array.isArray(node.content)) {
                node.content.forEach(traverse);
            }

            if (node.type === 'paragraph' || node.type === 'heading') {
                text += '\n';
            }
        }

        adfContent.content.forEach(traverse);
        return text.trim();
    }

    static async extractTextFromAttachment(attachment: AttachmentData): Promise<string | null> {
        try {
            const nonTextTypes = [
                'image/', 'video/', 'audio/',
                'application/zip', 'application/x-rar',
                'application/x-7z', 'application/octet-stream',
                'application/x-binary'
            ];
            
            if (nonTextTypes.some(type => attachment.mimeType.startsWith(type))) {
                console.log(`Skipping text extraction for non-text file: ${attachment.filename} (${attachment.mimeType})`);
                return `[${attachment.filename} is a non-text file: ${attachment.mimeType}]`;
            }

            if (attachment.mimeType === 'application/pdf' || attachment.filename.toLowerCase().endsWith('.pdf')) {
                console.log(`Processing PDF attachment: ${attachment.filename} (${attachment.size} bytes)`);
                
                if (!attachment.content) {
                    console.error(`PDF content missing for ${attachment.filename}`);
                    return `[PDF content missing for ${attachment.filename}]`;
                }
                
                const buffer = Buffer.from(attachment.content, 'base64');
                console.log(`Successfully created buffer from PDF content: ${buffer.length} bytes`);
                
                try {
                    console.log(`Attempting to extract text from PDF: ${attachment.filename}`);
                    
                    const { textBuffer } = await PDFService.extractImagesAndRewritePDF(
                        buffer,
                        attachment.filename,
                        'temp'
                    );
                    
                    const textContent = textBuffer.toString('utf-8');
                    
                    if (!textContent || textContent.trim().length === 0) {
                        console.log(`No text content extracted from PDF: ${attachment.filename}`);
                        return `[No text content could be extracted from PDF: ${attachment.filename}]`;
                    }
                    
                    console.log(`Successfully extracted ${textContent.length} bytes of text from PDF: ${attachment.filename}`);
                    console.log(`Text preview: ${textContent.substring(0, 100)}...`);
                    return textContent;
                } catch (pdfError) {
                    console.error(`Error extracting text from PDF ${attachment.filename}:`, pdfError);
                    return `[Failed to extract text from PDF: ${attachment.filename}. Error: ${(pdfError as Error).message || 'Unknown error'}]`;
                }
            }

            if (attachment.mimeType.startsWith('text/') || 
                attachment.mimeType.includes('json') ||
                attachment.mimeType.includes('xml') ||
                attachment.filename.toLowerCase().endsWith('.txt') ||
                attachment.filename.toLowerCase().endsWith('.md') ||
                attachment.filename.toLowerCase().endsWith('.csv')) {
                console.log(`Extracting text from ${attachment.mimeType} file: ${attachment.filename}`);
                const buffer = Buffer.from(attachment.content, 'base64');
                const textContent = buffer.toString('utf-8');
                console.log(`Extracted ${textContent.length} bytes of text from: ${attachment.filename}`);
                return textContent;
            }

            if (attachment.mimeType.includes('officedocument') ||
                attachment.mimeType.includes('msword') ||
                attachment.mimeType.includes('ms-excel') ||
                attachment.mimeType.includes('ms-powerpoint')) {
                return `[Document format not directly supported: ${attachment.filename} (${attachment.mimeType}). Consider converting to PDF for best results.]`;
            }

            console.log(`Unsupported file type for text extraction: ${attachment.filename} (${attachment.mimeType})`);
            return `[Text extraction not implemented for ${attachment.mimeType}: ${attachment.filename}]`;
        } catch (error) {
            console.error(`Failed to extract text from attachment ${attachment.filename}:`, error);
            return `[Error processing attachment: ${attachment.filename}. ${error instanceof Error ? error.message : 'Unknown error'}]`;
        }
    }

    static async processAttachments(attachments: AttachmentData[], ticketKey: string, orgId: string): Promise<string[]> {
        const uploadedFiles: string[] = [];

        for (const attachment of attachments) {
            try {
                const extractedText = await this.extractTextFromAttachment(attachment);
                attachment.extractedText = extractedText || undefined;
                
                const attachmentBuffer = Buffer.from(attachment.content, 'base64');
                const sanitizedFilename = attachment.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
                const attachmentFileName = `${ticketKey}_${sanitizedFilename}`;
                const chatFolder = `jira_${orgId}/attachments`;

                const s3Key = await S3Service.uploadFile(
                    attachmentBuffer,
                    attachmentFileName,
                    chatFolder
                );

                uploadedFiles.push(s3Key);
                console.log(`Uploaded attachment: ${attachmentFileName} -> ${s3Key}`);
            } catch (error) {
                console.error(`Failed to upload attachment ${attachment.filename}:`, error);
            }
        }

        return uploadedFiles;
    }

    static convertToDocument(jiraData: JiraTicket, attachmentFiles?: string[], attachmentsWithContent?: AttachmentData[]): string {
        const {
            key,
            id,
            fields: {
                summary,
                description,
                status,
                assignee,
                priority,
                project,
                created,
                updated,
                resolutiondate,
                duedate,
                attachment = [],
                labels = [],
                components = [],
                comment,
                worklog,
                issuetype,
                creator,
                reporter,
                resolution,
                timetracking,
                customfield_10070
            }
        } = jiraData;

        const descriptionText = description
            ? this.extractTextFromADF(description)
            : 'No description provided';

        let resolutionText = '';
        
        if ((jiraData as any).extractedResolution) {
            resolutionText = (jiraData as any).extractedResolution;
        } else if (customfield_10070) {
            const customResolution = typeof customfield_10070 === 'string'
                ? customfield_10070
                : this.extractTextFromADF(customfield_10070);
            
            if (customResolution && customResolution.trim()) {
                resolutionText = customResolution.trim();
            }
        }

        let document = `
JIRA TICKET: ${key}
TICKET ID: ${id}
PROJECT: ${project.name} (${project.key})
TITLE: ${summary}

STATUS: ${status.name}
ISSUE TYPE: ${issuetype.name}
${assignee ? `ASSIGNEE: ${assignee.displayName}` : 'ASSIGNEE: Unassigned'}
${priority ? `PRIORITY: ${priority.name}` : ''}
${resolution ? `RESOLUTION: ${resolution.name}` : ''}
${labels.length > 0 ? `LABELS: ${labels.join(', ')}` : ''}
${components.length > 0 ? `COMPONENTS: ${components.map(c => c.name).join(', ')}` : ''}

PEOPLE:
Creator: ${creator.displayName}
Reporter: ${reporter.displayName}

DATES:
Created: ${new Date(created).toLocaleString()}
Updated: ${new Date(updated).toLocaleString()}
${resolutiondate ? `Resolved: ${new Date(resolutiondate).toLocaleString()}` : ''}
${duedate ? `Due Date: ${new Date(duedate).toLocaleString()}` : ''}

${timetracking ? `TIME TRACKING:
${timetracking.timeSpent ? `Time Spent: ${timetracking.timeSpent}` : ''}
${timetracking.remainingEstimate ? `Remaining: ${timetracking.remainingEstimate}` : ''}
${timetracking.originalEstimate ? `Original Estimate: ${timetracking.originalEstimate}` : ''}` : ''}

DESCRIPTION: ${descriptionText}

${resolutionText ? `RESOLUTION: ${resolutionText}` : ''}`;

        if (attachment && attachment.length > 0) {
            document += `\n\nATTACHMENTS:`;
            
            for (const att of attachment) {
                document += `\n- ${att.filename} (${att.size} bytes, ${att.mimeType})`;
            }
        }
        
        if (attachmentsWithContent && attachmentsWithContent.length > 0) {
            const attachmentsWithText = attachmentsWithContent.filter(att => 
                att.extractedText && 
                att.extractedText.trim() && 
                !att.extractedText.startsWith('[Error') &&
                !att.extractedText.includes('is a non-text file')
            );
            
            if (attachmentsWithText.length > 0) {
                document += `\n\nATTACHMENT CONTENTS:`;
                
                document += `\n\n=== BEGIN ATTACHMENTS SECTION (${attachmentsWithText.length} attachments) ===\n`;
                
                let totalAttachmentSize = 0;
                for (const attachmentWithContent of attachmentsWithText) {
                    const textSize = attachmentWithContent.extractedText?.length || 0;
                    totalAttachmentSize += textSize;
                    
                    document += `\n\n--- CONTENT FROM ${attachmentWithContent.filename} (${textSize} chars) ---\n`;
                    document += attachmentWithContent.extractedText;
                    document += `\n--- END OF ${attachmentWithContent.filename} ---\n`;
                }
                
                document += `\n=== END ATTACHMENTS SECTION (Total: ${totalAttachmentSize} chars) ===\n`;
                
                console.log(`Added content from ${attachmentsWithText.length} attachments to document (${totalAttachmentSize} total chars)`);
                
                if (totalAttachmentSize > 5000) {
                    console.log(`WARNING: Large attachment content (${totalAttachmentSize} chars) may require multiple chunks. Ensure proper chunking is configured.`);
                }
            } else {
                document += `\n\nNo readable content could be extracted from attachments.`;
            }
        }

        if (attachmentFiles && attachmentFiles.length > 0) {
            document += `\n\nPROCESSED_ATTACHMENTS:
${attachmentFiles.map(file => `- ${file}`).join('\n')}`;
        }

        document += `\n${comment?.comments?.length ? `\nCOMMENTS:
${comment.comments.map(c => {
            const commentText = typeof c.body === 'string' ? c.body : this.extractTextFromADF(c.body);
            return `${new Date(c.created).toLocaleString()} - ${c.author.displayName}:
${commentText}`;
        }).join('\n\n')}` : ''}`;

        document += `\n${worklog?.worklogs?.length ? `\nWORKLOG:
${worklog.worklogs.map(w => `${new Date(w.started).toLocaleString()} - ${w.author.displayName}: ${w.timeSpent}${w.comment ? ` (${w.comment})` : ''}`).join('\n')}` : ''}`;

        document += `\n\n---
Document Type: Jira Ticket
Source: ${project.name}
Ticket ID: ${key}
Processing Date: ${new Date().toISOString()}
`.trim();

        return document;
    }

    static generateFileName(jiraData: JiraTicket, orgName: string): string {
        const projectName = jiraData.fields.project.name.replace(/[^a-zA-Z0-9-_]/g, '_');
        const issueKey = jiraData.key.replace(/[^a-zA-Z0-9-_]/g, '_');
        const orgNameClean = orgName.replace(/[^a-zA-Z0-9-_]/g, '_');

        return `jira_${orgNameClean}_${projectName}_${issueKey}.txt`;
    }

    static async processAttachmentsForDocument(attachments: AttachmentData[]): Promise<AttachmentData[]> {
        const processedAttachments: AttachmentData[] = [];

        for (const attachment of attachments) {
            try {
                console.log(`Processing attachment: ${attachment.filename} (${attachment.size} bytes, ${attachment.mimeType})`);
                
                const extractedText = await this.extractTextFromAttachment(attachment);
                
                const processedAttachment: AttachmentData = {
                    ...attachment,
                    extractedText: extractedText || undefined
                };
                
                processedAttachments.push(processedAttachment);
                console.log(`Successfully processed attachment: ${attachment.filename}`);
            } catch (error) {
                console.error(`Error processing attachment ${attachment.filename}:`, error);
                processedAttachments.push({
                    ...attachment,
                    extractedText: `[Error processing attachment: ${attachment.filename}]`
                });
            }
        }

        return processedAttachments;
    }

    static extractSearchableContent(jiraData: JiraTicket, attachmentsWithContent?: AttachmentData[]): string {
        const descriptionText = jiraData.fields.description
            ? this.extractTextFromADF(jiraData.fields.description)
            : '';

        let resolutionText = '';
        if ((jiraData as any).extractedResolution) {
            resolutionText = (jiraData as any).extractedResolution;
        } else if (jiraData.fields.customfield_10070) {
            const customResolution = typeof jiraData.fields.customfield_10070 === 'string'
                ? jiraData.fields.customfield_10070
                : this.extractTextFromADF(jiraData.fields.customfield_10070);
            
            if (customResolution && customResolution.trim()) {
                resolutionText = customResolution.trim();
            }
        }
//example pr
        let attachmentText = '';
        if (attachmentsWithContent && attachmentsWithContent.length > 0) {
            attachmentText = attachmentsWithContent
                .filter(att => att.extractedText)
                .map(att => att.extractedText)
                .join(' ');
            console.log(`Including extracted text from ${attachmentsWithContent.length} attachments in searchable content`);
        }

        const content = [
            jiraData.fields.summary,
            descriptionText,
            resolutionText,
            attachmentText,
            jiraData.fields.project.name,
            jiraData.key,
            jiraData.fields.status.name,
            jiraData.fields.issuetype.name,
            jiraData.fields.assignee?.displayName || '',
            jiraData.fields.priority?.name || '',
            jiraData.fields.labels?.join(' ') || '',
            jiraData.fields.components?.map(c => c.name).join(' ') || '',
            jiraData.fields.attachment?.map(a => a.filename).join(' ') || '',
            jiraData.fields.comment?.comments?.map(c => {
                const commentText = typeof c.body === 'string' ? c.body : this.extractTextFromADF(c.body);
                return commentText;
            }).join(' ') || ''
        ].filter(Boolean).join(' ');

        return content;
    }
}