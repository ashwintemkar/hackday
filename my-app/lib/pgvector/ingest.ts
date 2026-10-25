import { Document } from "@langchain/core/documents";
import { createOptimizedChunks } from "./embeddings";
import { upsertChunks, deleteTicketFromNamespace, checkTicketExistsInNamespace } from "./store";

const alreadyEmbeddedFiles = new Set<string>();

function isDuplicateTicket(content: string): boolean {
  return [
    /DUPLICATE ISSUE DETECTED/i,
    /This ticket appears to be a duplicate of:/i,
    /duplicate of:\s*[A-Z]+-\d+/i,
    /marked as duplicate/i,
    /close(?:d)?\s+as\s+duplicate/i,
  ].some((pattern) => pattern.test(content));
}

function hasAttachments(content: string): boolean {
  return content.includes("ATTACHMENT CONTENTS:") || content.includes("ATTACHMENTS:");
}

function extractAttachmentsFromDuplicate(content: string, sourceFile: string, projectKey?: string): Document[] {
  const attachments: Document[] = [];
  const sections = content.split(/--- CONTENT FROM /);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const endIndex = section.indexOf("--- END OF ");
    if (endIndex === -1) continue;

    const attachmentContent = section.substring(0, endIndex).trim();
    const fileNameMatch = section.match(/CONTENT FROM ([^\n]+)/);
    const fileName = fileNameMatch ? fileNameMatch[1].trim() : `attachment_${i}`;

    if (attachmentContent.length > 50) {
      attachments.push(
        new Document({
          pageContent: attachmentContent,
          metadata: {
            source: `attachment_${fileName}`,
            fileName,
            originalSource: sourceFile,
            isAttachment: true,
            projectKey: projectKey || "unknown",
          },
        }),
      );
    }
  }
  return attachments;
}

function normalizeStatus(status: string): string {
  const statusMap: Record<string, string> = {
    "1": "New", "2": "InProgress", "3": "Pending", "6": "Completed", "7": "Completed", "8": "Cancelled",
    done: "Completed", resolved: "Completed", closed: "Completed", complete: "Completed",
    completed: "Completed", fixed: "Completed", finished: "Completed", new: "New", open: "New",
    "in progress": "InProgress", "work in progress": "InProgress", working: "InProgress",
    pending: "Pending", "on hold": "Pending", "awaiting user info": "Pending",
    "awaiting vendor": "Pending", blocked: "Blocked", cancelled: "Cancelled",
  };
  return statusMap[status.toLowerCase().trim()] || status;
}

type NamespaceInfo = {
  namespace: string;
  isJira: boolean;
  isNormalized?: boolean;
  platform?: string;
  projectKey?: string;
  status?: string;
  ticketKey?: string;
  isDuplicate?: boolean;
  hasAttachments?: boolean;
};

/** Ported from lib/pinecone/embeddings.ts's determineNamespace - pure metadata/content
 * inspection, no Pinecone dependency, so the routing logic (which project/status namespace a
 * ticket belongs in) carries over unchanged. `namespace` here is just a column value, not a
 * Pinecone index namespace. */
function determineNamespace(doc: Document): NamespaceInfo {
  const sourceFile = doc.metadata.source as string;
  const content = doc.pageContent;
  const lowerSource = sourceFile.toLowerCase();
  const isJiraDocument = lowerSource.includes("jira_");
  const isServiceNowDocument = lowerSource.includes("servicenow_");

  if (doc.metadata?.normalized) {
    const platform = doc.metadata.platform as string | undefined;
    const projectKey = doc.metadata.projectKey as string | undefined;
    const ticketKey = doc.metadata.ticketKey as string | undefined;
    const metadataStatus = (doc.metadata.ticketStatus || doc.metadata.status || "") as string;
    const statusMatches = [...content.matchAll(/STATUS:\s*([^\n]+)/gi)];
    const rawStatusFromContent = statusMatches.length > 0 ? statusMatches[statusMatches.length - 1][1].trim() : "";
    const rawStatus = (metadataStatus || rawStatusFromContent).trim();
    const normalizedStatus = normalizeStatus(rawStatus);
    const isDup = isDuplicateTicket(content);
    const isDone = normalizedStatus === "Completed";
    const effectiveProjectKey = projectKey || `${(platform || "platform").toLowerCase()}_default`;
    const namespace = isDup ? `${effectiveProjectKey}_duplicate` : isDone ? `${effectiveProjectKey}_done` : `${effectiveProjectKey}_todo`;

    return {
      namespace, isJira: false, isNormalized: true, platform, projectKey: effectiveProjectKey,
      status: normalizedStatus, ticketKey, isDuplicate: isDup, hasAttachments: false,
    };
  }

  if (isServiceNowDocument) {
    const ticketMatch = content.match(/TICKET NUMBER:\s*([^\n]+)/i) || content.match(/INCIDENT:\s*([^\n]+)/i);
    const projectMatch = content.match(/PROJECT:\s*([^(]+)\s*\(([^)]+)\)/);
    const statusMatch = content.match(/STATUS:\s*([^\n]+)/i);
    if (ticketMatch && projectMatch && statusMatch) {
      const projectKey = projectMatch[2].trim();
      const ticketKey = ticketMatch[1].trim();
      const normalizedStatus = normalizeStatus(statusMatch[1].trim());
      const isDone = normalizedStatus === "Completed";
      return {
        namespace: isDone ? `${projectKey}_done` : `${projectKey}_todo`,
        isJira: false, isNormalized: true, platform: "servicenow", projectKey,
        status: normalizedStatus, ticketKey, isDuplicate: false, hasAttachments: false,
      };
    }
  }

  if (!isJiraDocument) {
    return { namespace: "default", isJira: false };
  }

  const projectMatch = content.match(/PROJECT:\s*([^(]+)\s*\(([^)]+)\)/);
  const ticketMatch = content.match(/JIRA TICKET:\s*([^\n]+)/);
  const statusMatch = content.match(/STATUS:\s*([^\n]+)/);
  if (!projectMatch || !ticketMatch || !statusMatch) {
    return { namespace: "default", isJira: true };
  }

  const projectKey = projectMatch[2].trim();
  const ticketKey = ticketMatch[1].trim();
  const normalizedStatus = normalizeStatus(statusMatch[1].trim());
  const isDuplicate = isDuplicateTicket(content);
  const hasAttachmentContent = hasAttachments(content);
  const isDone = normalizedStatus === "Completed";
  const namespace = isDuplicate ? `${projectKey}_duplicate` : isDone ? `${projectKey}_done` : `${projectKey}_todo`;

  return { namespace, isJira: true, projectKey, status: normalizedStatus, ticketKey, isDuplicate, hasAttachments: hasAttachmentContent };
}

async function handleTicketStatusChange(info: NamespaceInfo): Promise<void> {
  if ((!info.isJira && !info.isNormalized) || !info.ticketKey || !info.projectKey) return;

  const allPossibleNamespaces = [`${info.projectKey}_todo`, `${info.projectKey}_done`, `${info.projectKey}_duplicate`];
  for (const namespace of allPossibleNamespaces) {
    const exists = await checkTicketExistsInNamespace(namespace, info.ticketKey);
    if (exists) {
      // Whether it's the current namespace (about to be replaced with the fresh version) or a
      // stale one (ticket moved since last sync), either way the old row needs to go first.
      await deleteTicketFromNamespace(namespace, info.ticketKey);
    }
  }
}

/**
 * Replaces lib/pinecone/embeddings.ts's updatePinecone - same per-document routing (namespace
 * determination, duplicate-ticket attachment extraction, status-change namespace migration,
 * chunking) but writing to Postgres instead of a Pinecone index. Call sites that used
 * `updatePinecone(client, indexName, docs)` just drop the first two args now - pgvector needs
 * neither a client object nor an index name.
 */
export async function updateChunks(docs: Document[]): Promise<void> {
  const processedInBatch = new Set<string>();

  const processedFileNames = new Set(
    docs
      .filter((doc) => (doc.metadata.source as string).toLowerCase().includes("_processed"))
      .map((doc) => (doc.metadata.source as string).replace(/_processed/gi, "")),
  );

  const filteredDocs = docs.filter((doc) => {
    const sourceFile = doc.metadata.source as string;
    const isProcessed = sourceFile.toLowerCase().includes("_processed");
    const baseFileName = sourceFile.replace(/_processed/gi, "");
    return isProcessed || !processedFileNames.has(baseFileName);
  });

  for (const doc of filteredDocs) {
    const sourceFile = doc.metadata.source as string;
    const fileKey = doc.metadata.chatId
      ? `${doc.metadata.chatId}_${sourceFile}_${doc.pageContent.length}`
      : `${sourceFile}_${doc.pageContent.length}`;

    const info = determineNamespace(doc);

    if (!info.isJira && !info.isNormalized) {
      if (processedInBatch.has(fileKey) || alreadyEmbeddedFiles.has(fileKey)) continue;
      processedInBatch.add(fileKey);
      alreadyEmbeddedFiles.add(fileKey);
    }

    if (!doc.pageContent.trim()) continue;

    if (info.isJira || info.isNormalized) {
      await handleTicketStatusChange(info);
    }

    if (info.isJira && info.isDuplicate && info.hasAttachments) {
      const attachmentDocs = extractAttachmentsFromDuplicate(doc.pageContent, sourceFile, info.projectKey);
      for (const attachmentDoc of attachmentDocs) {
        const attachmentNamespace = `${info.projectKey}_attachment`;
        const attachmentChunks = await createOptimizedChunks(attachmentDoc);
        await upsertChunks(attachmentNamespace, attachmentChunks);
      }
    }

    const chunks = await createOptimizedChunks(doc);
    const enrichedChunks = chunks.map(
      (chunk) =>
        new Document({
          pageContent: chunk.pageContent,
          metadata: {
            ...chunk.metadata,
            ...(info.isJira && { projectKey: info.projectKey, ticketKey: info.ticketKey, ticketStatus: info.status }),
            ...(info.isNormalized && {
              projectKey: info.projectKey, ticketKey: info.ticketKey, platform: info.platform, ticketStatus: info.status,
            }),
          },
        }),
    );

    await upsertChunks(info.namespace, enrichedChunks);
  }
}
