import { Document } from "@langchain/core/documents";
import { S3Service } from "../s3-service";
import { embedQuery } from "@/lib/pgvector/embeddings";
import { querySimilar } from "@/lib/pgvector/store";
import { updateChunks } from "@/lib/pgvector/ingest";
import { summarizeTicketPayload, TicketSummaryPayload } from "@/lib/ticket-summarizer";

export interface NormalizedTicketData {
  ticket_id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  category?: string;
  attachments?: { filename?: string }[];
  project: string; // project or group
  created_at?: string;
  updated_at?: string;
  custom_fields?: Record<string, any>;
  source_app?: string; // jira, ServiceNow, etc
  ticket_number?: string;
  resolution?: string;
  extractedResolution?: string;
  connectorName?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

function sanitize(input: string): string {
  return (input || "").toString().replace(/[^a-zA-Z0-9-_]/g, "_");
}

const DUPLICATE_THRESHOLD = 0.9;
const DONE_STATUSES = ['Done', 'Resolved', 'Closed', 'Complete', 'Completed', 'Fixed', 'Finished'];

function isDoneStatus(status?: string): boolean {
  if (!status) return false;
  return DONE_STATUSES.some(s => s.toLowerCase() === status.toLowerCase());
}

export class NormalizedDocumentProcessor {
  static validate(data: any): ValidationResult {
    const errors: string[] = [];

    if (!data) errors.push("Missing payload");
    if (!data.ticket_id) errors.push("Missing ticket_id");
    if (!data.title) errors.push("Missing title");
    if (!data.status) errors.push("Missing status");
    if (!data.project) errors.push("Missing project");

    return { isValid: errors.length === 0, errors };
  }

  static generateFileName(data: NormalizedTicketData, orgName: string): string {
    const platform = (data.source_app || 'ticket').toLowerCase();
    const org = sanitize(orgName);
    const project = sanitize(data.project);
    const ticket = sanitize(data.ticket_id);
    return `${platform}_${org}_${project}_${ticket}.txt`;
  }

  static buildDocument(
    data: NormalizedTicketData,
    nsKey: string,
    options?: {
      summary?: string;
      duplicateInfo?: {
        matchedTicketKey?: string;
        matchedTicketNumber?: string;
        similarity?: number;
      };
    }
  ): string {
    const platform = data.source_app || 'Unknown';
    const attachments = data.attachments || [];
    const custom = data.custom_fields || {};

    const customFieldsBlock = Object.keys(custom).length
      ? Object.entries(custom)
          .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join('\n')
      : '';

    const attachmentBlock = attachments.length
      ? `\nATTACHMENTS:\n${attachments
          .map((a, i) => `- ${a.filename || `file_${i+1}`}`)
          .join('\n')}`
      : '';

    const resolutionText = (data.extractedResolution || data.resolution || '').trim();
    const resolutionBlock = resolutionText
      ? `\nRESOLUTION:\n${resolutionText}`
      : '';

    const summaryBlock =
      options?.summary && options.summary.trim().length > 0
        ? `\nSUMMARY_SNIPPET:\n${options.summary.trim()}\n`
        : '';

    const duplicateInfo = options?.duplicateInfo;
    const duplicateBlock = duplicateInfo
      ? `\nDUPLICATE ISSUE DETECTED\nMATCHED TICKET: ${duplicateInfo.matchedTicketKey || 'unknown'}${duplicateInfo.matchedTicketNumber ? ` (${duplicateInfo.matchedTicketNumber})` : ''}\nSIMILARITY: ${duplicateInfo.similarity ? `${(duplicateInfo.similarity * 100).toFixed(2)}%` : 'N/A'}`
      : '';

    const created = data.created_at ? new Date(data.created_at).toISOString() : '';
    const updated = data.updated_at ? new Date(data.updated_at).toISOString() : '';

    return [
      summaryBlock,
      duplicateBlock,
      `TITLE: ${data.title}`,
      data.ticket_number ? `TICKET NUMBER: ${data.ticket_number}` : '',
      `\nDESCRIPTION:\n${data.description || ''}`,
      resolutionBlock,
      `\nSTATUS: ${data.status}`,
      data.priority ? `PRIORITY: ${data.priority}` : '',
      data.category ? `CATEGORY: ${data.category}` : '',
      customFieldsBlock ? `\nCUSTOM_FIELDS:\n${customFieldsBlock}` : '',
      attachmentBlock,
      `\n---`,
      `Document Type: Ticket`,
      `Source: ${platform}`,
      // Keep compatibility with existing parsing utilities
      `PROJECT: ${data.project} (${nsKey})`,
      `JIRA TICKET: ${data.ticket_id}`,
      created ? `Created: ${created}` : '',
      updated ? `Updated: ${updated}` : '',
      `Processing Date: ${new Date().toISOString()}`
    ].filter(Boolean).join('\n');
  }

  static async process(
    data: NormalizedTicketData,
    orgId: string,
    orgName: string,
    req: Request,
    options?: {
      duplicateCheck?: boolean;
      duplicateMatch?: {
        matchedTicketKey?: string;
        matchedTicketNumber?: string;
        similarity?: number;
        projectKey?: string;
      };
      summaryOverride?: string;
    }
  ) {
    const trimmedResolution =
      typeof data.resolution === 'string' && data.resolution.trim().length > 0
        ? data.resolution.trim()
        : undefined;
    const trimmedExtracted =
      typeof data.extractedResolution === 'string' && data.extractedResolution.trim().length > 0
        ? data.extractedResolution.trim()
        : undefined;

    const normalizedData: NormalizedTicketData = {
      ...data,
      resolution: trimmedResolution,
      extractedResolution: trimmedExtracted || trimmedResolution,
    };

    const platform = (normalizedData.source_app || 'ticket').toLowerCase();
    const projectKey = sanitize(normalizedData.project);
    const nsProjectKey = `${platform}_${projectKey}`; // ensures cross-platform isolation
    const duplicateCheckEnabled = options?.duplicateCheck !== false && !isDoneStatus(normalizedData.status);

    const summaryPayload: TicketSummaryPayload = {
      summary: normalizedData.title,
      description: normalizedData.description || normalizedData.extractedResolution || '',
      comment: normalizedData.custom_fields?.comment || normalizedData.custom_fields?.comments || '',
      attachment: normalizedData.custom_fields?.attachment_text || '',
    };

    let summarySnippet = options?.summaryOverride || '';
    if (!summarySnippet) {
      try {
        summarySnippet = await summarizeTicketPayload(summaryPayload);
      } catch (err) {
        console.warn(`[NormalizedDocumentProcessor] Failed to summarize ticket ${normalizedData.ticket_id}:`, err);
        summarySnippet = `${normalizedData.title}\n${normalizedData.description || ''}`.trim();
      }
    }

    let duplicateInfo: {
      matchedTicketKey?: string;
      matchedTicketNumber?: string;
      similarity?: number;
      projectKey?: string;
    } | null = null;

    if (duplicateCheckEnabled) {
      if (options?.duplicateMatch?.matchedTicketKey) {
        duplicateInfo = {
          matchedTicketKey: options.duplicateMatch.matchedTicketKey,
          matchedTicketNumber: options.duplicateMatch.matchedTicketNumber,
          similarity: options.duplicateMatch.similarity,
          projectKey: options.duplicateMatch.projectKey || nsProjectKey,
        };
      } else if (summarySnippet && summarySnippet.trim().length > 0) {
        try {
          const todoNamespace = `${nsProjectKey}_todo`;
          const embedding = await embedQuery(summarySnippet);
          const matches = await querySimilar(todoNamespace, embedding, 5);

          const bestMatch = matches[0];
          if (bestMatch?.score && bestMatch.score >= DUPLICATE_THRESHOLD) {
            const content = bestMatch.content || '';
            const ticketKeyMatch = content.match(/JIRA\s*TICKET:\s*([^\n]+)/i);
            const ticketNumberMatch =
              content.match(/TICKET\s*NUMBER:\s*([^\n]+)/i) ||
              content.match(/INCIDENT\s*NUMBER:\s*([^\n]+)/i) ||
              content.match(/CASE\s*NUMBER:\s*([^\n]+)/i);

            duplicateInfo = {
              matchedTicketKey: ticketKeyMatch ? ticketKeyMatch[1].trim() : bestMatch.ticketKey,
              matchedTicketNumber: ticketNumberMatch ? ticketNumberMatch[1].trim() : undefined,
              similarity: bestMatch.score,
              projectKey: nsProjectKey,
            };

            console.log(`[NormalizedDocumentProcessor] Duplicate detected for ${normalizedData.ticket_id} -> ${duplicateInfo.matchedTicketKey} (score ${(bestMatch.score * 100).toFixed(2)}%)`);
          }
        } catch (err) {
          console.warn(`[NormalizedDocumentProcessor] Duplicate check failed for ${normalizedData.ticket_id}:`, err);
        }
      }
    }

    const fileName = this.generateFileName(normalizedData, orgName);
    const docContent = this.buildDocument(normalizedData, nsProjectKey, {
      summary: summarySnippet,
      duplicateInfo: duplicateInfo || undefined,
    });

    // Upload text document to S3 for auditability
    const folder = `${platform}_${orgId}`;
    const buffer = Buffer.from(docContent, 'utf-8');
    const s3Key = await S3Service.uploadFile(buffer, fileName, folder);

    // Build a LangChain document for embedding
    const document: Document = new Document({
      pageContent: docContent,
      metadata: {
        source: fileName,
        type: 'text',
        normalized: true,
        platform,
        projectKey: nsProjectKey,
        ticketKey: data.ticket_id,
        ticketStatus: normalizedData.status,
        ticketNumber: normalizedData.ticket_number,
        normalizedSummary: summarySnippet,
        duplicateOf: duplicateInfo?.matchedTicketKey,
        duplicateSimilarity: duplicateInfo?.similarity,
      }
    });

    await updateChunks([document]);

    return {
      fileName,
      s3Key,
      attachments: [],
      uploadedFiles: [],
      processedAttachments: []
    };
  }
}

