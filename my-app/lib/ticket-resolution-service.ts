// lib/ticket-resolution-service.ts
import { prisma } from "./prisma";
import { JiraIntegrationService } from "./jira-integration-service";
import { queryPineconeForTicketResolution } from "./pgvector/query";
import { embedQuery } from "./pgvector/embeddings";
import { AttachmentData } from "@/types/type";
import { summarizeTicketPayload } from "./ticket-summarizer";

export interface ResolutionResult {
  found: boolean;
  confidence?: number;
  matchedTicketKey?: string;
  matchedTicketNumber?: string;
  resolutionText?: string;
  generatedSummary?: string;
  duplicateProjectKey?: string;
  type?: 'duplicate' | 'resolution' | 'none';
}

export interface AutoResolution {
  id?: string;
  ticketKey: string;
  matchedTicketKey: string;
  confidence: number;
  resolution: string;
  status: 'suggested' | 'applied' | 'rejected';
  orgId: string;
  connectorName: string;
}

function formatResolution(
  resolution: string,
  matchedTicketKey: string,
  confidence: number,
  matchedTicketNumber?: string
): string {
  const formattedDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const confidencePercent = Math.round(confidence * 100);
  const hasDisplayNumber =
    typeof matchedTicketNumber === 'string' && matchedTicketNumber.trim().length > 0;
  const referenceLabel = hasDisplayNumber
    ? matchedTicketNumber!.trim()
    : matchedTicketKey;

  const hasWorkaround = /(?:workaround|work\s*around)/i.test(resolution);
  const hasPermanentFix = /(?:permanent\s*fix|fix)/i.test(resolution);

  let solutionLabel = "SOLUTION SUMMARY:";
  if (hasWorkaround && hasPermanentFix) {
    solutionLabel = "SOLUTION (Workaround + Permanent Fix):";
  } else if (hasWorkaround) {
    solutionLabel = "WORKAROUND:";
  } else if (hasPermanentFix) {
    solutionLabel = "PERMANENT FIX:";
  }

  return `SUGGESTED SOLUTION FOUND (NEXAGRID GENERATED)

BASED ON SIMILAR ISSUE: ${referenceLabel}
  
${solutionLabel}
${resolution}

CONFIDENCE: ${confidencePercent}%

LAST VERIFIED SOLUTION: ${formattedDate}`;
}

function formatDuplicateMessage(
  originalTicketId: string,
  displayTicketNumber?: string
): string {
  const formattedDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const referenceLabel =
    typeof displayTicketNumber === 'string' && displayTicketNumber.trim().length > 0
      ? displayTicketNumber.trim()
      : originalTicketId;

  return `DUPLICATE ISSUE DETECTED (NEXAGRID GENERATED)

This ticket appears to be a duplicate of: ${referenceLabel}

Please refer to the original ticket for resolution status.

DETECTED ON: ${formattedDate}`;
}


export async function handleNewTicketResolution(
  jiraData: any,
  orgId: string,
  orgName: string,
  req: Request,
  attachmentsWithContent?: AttachmentData[],
  duplicateNeeded: boolean = true
): Promise<ResolutionResult> {
  try {
    const statusName = jiraData.fields?.status?.name || 'Unknown';
    
    
    const doneStatuses = ['Done', 'Resolved', 'Closed', 'Complete', 'Fixed', 'Finished'];
    if (doneStatuses.some(status => statusName.toLowerCase() === status.toLowerCase())) {
      console.log(`Ticket ${jiraData.key} has status "${statusName}" - skipping resolution handling for done tickets`);
      return { found: false, type: 'none' };
    }
    
    console.log(`Checking for resolution for new ticket: ${jiraData.key} with status "${statusName}"`);

    const summary = jiraData.fields?.summary || '';
    const description = jiraData.fields?.description || '';
    const projectKey = jiraData.fields?.project?.key || '';

    console.log(`Ticket project key: ${projectKey}`);
    
    if (attachmentsWithContent && attachmentsWithContent.length > 0) {
      console.log(`Processing resolution with ${attachmentsWithContent.length} processed attachments`);
    }

    const descriptionText = typeof description === 'string'
      ? description
      : extractTextFromADF(description);
    const primarySummary = `${summary}\n${descriptionText}`.trim() || summary || descriptionText || '';
    const generatedSummary = primarySummary;

    const searchQueries = buildSearchQueries(jiraData, summary, descriptionText, attachmentsWithContent);

    console.log(`Built ${searchQueries.length} search queries for ticket ${jiraData.key}`);
    searchQueries.forEach((query, idx) => {
      console.log(`Query ${idx + 1}: ${query.substring(0, 150)}...`);
    });

    if (searchQueries.length === 0) {
      console.log(`No searchable content found for ticket ${jiraData.key}`);
      return { found: false, type: 'none' };
    }

    let bestResult: any = null;
    let bestConfidence = 0;
    let duplicateResult: any = null;
    let duplicateConfidence = 0;

    if (!duplicateNeeded) {
      console.log(`Duplicate detection disabled for ticket ${jiraData.key}. Will only search for resolution suggestions.`);
    } else {
      console.log(`Duplicate detection enabled for ticket ${jiraData.key}. Will check for both duplicates and resolutions.`);
    }

    for (const searchText of searchQueries) {
      console.log(`Searching with query: ${searchText.substring(0, 100)}...`);

      const result = await queryPineconeForTicketResolution({ query: searchText, orgId, duplicateNeeded });

      if (result.type === "duplicate" && result.score && result.score >= 0.82) {
        if (!duplicateNeeded) {
          console.log(`Skipping duplicate detection for ticket ${jiraData.key} as duplicateNeeded is false`);
          continue;
        }

        console.log(`Found duplicate ticket with score ${result.score.toFixed(3)}`);

        if (result.original_ticket_id === jiraData.key) {
          console.log(`Matched ticket ${result.original_ticket_id} is the same as current ticket. Skipping duplicate detection.`);
          continue;
        }

        if (result.projectKey && projectKey && result.projectKey !== projectKey) {
          console.log(`Project key mismatch: Ticket is from ${projectKey} but match is from ${result.projectKey}. Skipping duplicate suggestion.`);
          continue;
        }

        if (result.score > duplicateConfidence) {
          duplicateResult = result;
          duplicateConfidence = result.score;
          console.log(`New best duplicate match: ${result.original_ticket_id} with score ${result.score.toFixed(3)}`);
          
          if (result.score >= 0.9) {
            console.log(`Found high confidence duplicate (${result.score.toFixed(3)}), using it immediately`);
            break;
          }
        }
      }
      else if (result.type === "resolution" && result.score && result.score >= 0.7) {
        console.log(`Found resolution from ticket ${result.source_ticket_id} with score ${result.score.toFixed(3)}`);

        if (result.source_ticket_id === jiraData.key) {
          console.log(`Matched ticket ${result.source_ticket_id} is the same as current ticket. Skipping resolution suggestion.`);
          continue;
        }

        if (!result.projectKey || !projectKey || result.projectKey !== projectKey) {
          console.log(`Project key mismatch: Ticket is from ${projectKey} but match is from ${result.projectKey || 'unknown'}. Skipping resolution.`);
          continue;
        }

        if (result.score > bestConfidence) {
          bestResult = result;
          bestConfidence = result.score;
        }

        if (result.score > 0.85) {
          console.log(`High confidence resolution match found in same project (${result.score.toFixed(3)}), using this result`);
          break;
        }
      }
    }

    console.log(`Finished search queries. Best duplicate confidence: ${duplicateConfidence.toFixed(3)}, Best resolution confidence: ${bestConfidence.toFixed(3)}`);
    
    if (!duplicateNeeded) {
      console.log(`Duplicate detection was disabled. Only resolution suggestions will be considered.`);
    }
    
    if (duplicateResult && duplicateResult.type === "duplicate" && duplicateConfidence >= 0.82) {
      const formattedMessage = formatDuplicateMessage(
        duplicateResult.original_ticket_id || "unknown",
        duplicateResult.original_ticket_number
      );
      console.log(`Selected duplicate ticket: ${duplicateResult.original_ticket_id} with confidence ${duplicateConfidence.toFixed(3)}`);

      await saveAutoResolution({
        ticketKey: jiraData.key,
        matchedTicketKey: duplicateResult.original_ticket_id || "unknown",
        confidence: duplicateResult.score,
        resolution: formattedMessage,
        status: 'suggested',
        orgId,
        connectorName: (jiraData as any).connectorName || jiraData.fields?.project?.key || 'unknown'
      });

      const protocol = req.headers.get("x-forwarded-proto") || "http";
      const host = req.headers.get("host") || "";
      const baseUrl = `${protocol}://${host}`;

      const integrationSuccess = await JiraIntegrationService.sendResolutionToIntegrationHub(
        jiraData.key,
        formattedMessage,
        (jiraData as any).connectorName || jiraData.fields?.project?.key || 'unknown',
        orgId,
        baseUrl,
        'duplicate'
      );

      if (!integrationSuccess) {
        console.error(`Failed to send duplicate notification to Integration Hub for ticket ${jiraData.key}`);
      }

      return {
        found: true,
        confidence: duplicateResult.score,
        matchedTicketKey: duplicateResult.original_ticket_id,
        matchedTicketNumber: duplicateResult.original_ticket_number,
        duplicateProjectKey: duplicateResult.projectKey,
        resolutionText: formattedMessage,
        generatedSummary: generatedSummary || primarySummary,
        type: 'duplicate'
      };
    }
    else if (bestResult && bestResult.type === "resolution") {
      const formattedResolution = formatResolution(
        bestResult.message,
        bestResult.source_ticket_id || "unknown",
        bestResult.score,
        bestResult.source_ticket_number
      );

      await saveAutoResolution({
        ticketKey: jiraData.key,
        matchedTicketKey: bestResult.source_ticket_id || "unknown",
        confidence: bestResult.score,
        resolution: formattedResolution,
        status: 'suggested',
        orgId,
        connectorName: (jiraData as any).connectorName || jiraData.fields?.project?.key || 'unknown'
      });

      const protocol = req.headers.get("x-forwarded-proto") || "http";
      const host = req.headers.get("host") || "";
      const baseUrl = `${protocol}://${host}`;

      const integrationSuccess = await JiraIntegrationService.sendResolutionToIntegrationHub(
        jiraData.key,
        formattedResolution,
        (jiraData as any).connectorName || jiraData.fields?.project?.key || 'unknown',
        orgId,
        baseUrl,
        'resolution',
        bestResult.source_ticket_number
      );

      if (!integrationSuccess) {
        console.error(`Failed to send resolution to Integration Hub for ticket ${jiraData.key}`);
      }

      return {
        found: true,
        confidence: bestResult.score,
        matchedTicketKey: bestResult.source_ticket_id,
        resolutionText: formattedResolution,
        type: 'resolution'
      };
    }

    return {
      found: false,
      type: 'none',
      resolutionText: "No similar tickets found in the knowledge base."
    };
  } catch (error) {
    console.error(`Error handling ticket resolution for ${jiraData.key}:`, error);
    return { found: false };
  }
}

export async function handleNewTicketResolutionNormalized(
  data: { title: string; description?: string; status?: string; project: string; ticket_id: string; source_app?: string; connectorName?: string },
  orgId: string,
  orgName: string,
  req: Request,
  duplicateNeeded: boolean = true
): Promise<ResolutionResult> {
  try {
    const statusName = data.status || 'Unknown';
    const doneStatuses = ['Done', 'Resolved', 'Closed', 'Complete', 'Fixed', 'Finished', 'Completed'];
    if (doneStatuses.some(status => statusName.toLowerCase() === status.toLowerCase())) {
      console.log(`Normalized ticket ${data.ticket_id} has status "${statusName}" - skipping resolution handling for done tickets`);
      return { found: false, type: 'none' };
    }

    const summary = data.title || '';
    const descriptionText = data.description || '';
    const platform = (data.source_app || 'platform').toLowerCase();
    const projectKeyRaw = (data.project || 'default').toString().replace(/[^a-zA-Z0-9-_]/g, '_');
    const projectKey = `${platform}_${projectKeyRaw}`;

    let generatedSummary = '';
    try {
      generatedSummary = await summarizeTicketPayload({
        summary: summary,
        description: descriptionText,
        comment: '',
        attachment: '',
      });
      console.log(`Generated LLM summary for normalized ticket ${data.ticket_id}: ${generatedSummary.substring(0, 200)}...`);
    } catch (err) {
      console.warn(`Failed to summarize normalized ticket ${data.ticket_id}:`, err);
    }

    const projectInfo = `PROJECT: ${data.project} (${projectKey})\n`;
    const queries: string[] = [];
    const primarySummary = generatedSummary || `${summary}\n${descriptionText}`.trim();
    const fallbackSummary = summary || descriptionText;

    if (primarySummary.trim().length > 0) {
      queries.push(`${projectInfo}SUMMARY_SNIPPET:\n${primarySummary}`);
      queries.push(`${projectInfo}${primarySummary}`);
    }

    if (fallbackSummary) {
      queries.push(`${projectInfo}TITLE: ${summary}`);
      queries.push(`${projectInfo}TITLE: ${summary}\n\nDESCRIPTION:\n${descriptionText}`);
    }

    console.log(`Built ${queries.length} search queries for normalized ticket ${data.ticket_id}`);
    if (queries.length > 0) {
      console.log(`Normalized ticket first query preview: ${queries[0].substring(0, 200)}...`);
    }
    if (queries.length === 0) return { found: false, type: 'none' };

    let bestResult: any = null;
    let duplicateResult: any = null;

    if (!duplicateNeeded) {
      console.log(`Duplicate detection disabled for ticket ${data.ticket_id}. Will only search for resolution suggestions.`);
    } else {
      console.log(`Duplicate detection enabled for ticket ${data.ticket_id}. Will check for duplicates and resolutions.`);
    }

    for (const searchText of queries) {
      console.log(`Searching with normalized query: ${searchText.substring(0, 150)}...`);
      const result = await queryPineconeForTicketResolution({ query: searchText, orgId, duplicateNeeded });

      if (result.type === 'duplicate' && duplicateNeeded) {
        duplicateResult = result;
        break;
      }

      if (result.type === 'resolution') {
        bestResult = result;
        break;
      }
    }

    if (duplicateResult && duplicateResult.original_ticket_id) {
      const formattedMessage = formatDuplicateMessage(
        duplicateResult.original_ticket_id,
        duplicateResult.original_ticket_number
      );
      await saveAutoResolution({
        ticketKey: data.ticket_id,
        matchedTicketKey: duplicateResult.original_ticket_id || 'unknown',
        confidence: duplicateResult.score || 0,
        resolution: formattedMessage,
        status: 'suggested',
        orgId,
        connectorName: data.connectorName || projectKey
      });

      const protocol = req.headers.get("x-forwarded-proto") || "http";
      const host = req.headers.get("host") || "";
      const baseUrl = `${protocol}://${host}`;

      const integrationSuccess = await JiraIntegrationService.sendResolutionToIntegrationHub(
        data.ticket_id,
        formattedMessage,
        data.connectorName || projectKey,
        orgId,
        baseUrl,
        'duplicate'
      );

      if (!integrationSuccess) {
        console.error(`Failed to send duplicate notification to Integration Hub for normalized ticket ${data.ticket_id}`);
      }

      return {
        found: true,
        confidence: duplicateResult.score,
        matchedTicketKey: duplicateResult.original_ticket_id,
        resolutionText: formattedMessage,
        type: 'duplicate'
      };
    }

    if (bestResult && bestResult.type === 'resolution') {
      const formattedResolution = formatResolution(
        bestResult.message,
        bestResult.source_ticket_id || 'unknown',
        bestResult.score || 0,
        bestResult.source_ticket_number
      );

      await saveAutoResolution({
        ticketKey: data.ticket_id,
        matchedTicketKey: bestResult.source_ticket_id || 'unknown',
        confidence: bestResult.score || 0,
        resolution: formattedResolution,
        status: 'suggested',
        orgId,
        connectorName: data.connectorName || projectKey
      });

      const protocol = req.headers.get("x-forwarded-proto") || "http";
      const host = req.headers.get("host") || "";
      const baseUrl = `${protocol}://${host}`;

      const integrationSuccess = await JiraIntegrationService.sendResolutionToIntegrationHub(
        data.ticket_id,
        formattedResolution,
        data.connectorName || projectKey,
        orgId,
        baseUrl,
        'resolution',
        bestResult.source_ticket_number
      );

      if (!integrationSuccess) {
        console.error(`Failed to send resolution to Integration Hub for normalized ticket ${data.ticket_id}`);
      }

      return {
        found: true,
        confidence: bestResult.score,
        matchedTicketKey: bestResult.source_ticket_id,
        matchedTicketNumber: bestResult.source_ticket_number,
        resolutionText: formattedResolution,
        generatedSummary: generatedSummary || primarySummary,
        type: 'resolution'
      };
    }

    return { found: false, type: 'none', resolutionText: 'No similar tickets found in the knowledge base.', generatedSummary: generatedSummary || primarySummary };
  } catch (error) {
    console.error(`Error handling normalized ticket resolution for ${data.ticket_id}:`, error);
    return { found: false };
  }
}

function buildSearchQueries(jiraData: any, summary: string, descriptionText: string, attachmentsWithContent?: AttachmentData[]): string[] {
  const queries: string[] = [];
  const projectKey = jiraData.fields?.project?.key || '';
  const projectName = jiraData.fields?.project?.name || '';

  const projectInfo = projectKey && projectName ? `PROJECT: ${projectName} (${projectKey})\n` : '';


  const attachmentContent = attachmentsWithContent && attachmentsWithContent.length > 0
    ? attachmentsWithContent
      .filter(att => att.extractedText)
      .map(att => att.extractedText)
      .join(' ')
    : '';

  if (attachmentContent) {
    console.log(`Including ${attachmentContent.length} chars of extracted attachment content in search queries`);
    console.log(`Attachment content preview: ${attachmentContent.substring(0, 200)}...`);
  }

  if (summary) {
    queries.push(`${projectInfo}${summary}`);
    queries.push(`${projectInfo}TITLE: ${summary}`);
  }

  if (summary && descriptionText) {
    queries.push(`${projectInfo}${summary} ${descriptionText}`);
  }

  if (descriptionText && descriptionText.length > 30) {
    queries.push(`${projectInfo}${descriptionText}`);
  }

  if (attachmentContent) {
    if (summary) {
      queries.push(`${projectInfo}${summary} ${attachmentContent.substring(0, 500)}`);
    }

    queries.push(`${projectInfo}${attachmentContent.substring(0, 1000)}`);

    const attachmentError = extractErrorMessage(attachmentContent);
    if (attachmentError) {
      queries.push(`${projectInfo}${attachmentError}`);
    }
  }

  const errorMessage = extractErrorMessage(summary + ' ' + descriptionText + ' ' + attachmentContent);
  if (errorMessage) {
    queries.push(`${projectInfo}${errorMessage}`);
  }

  const components = extractComponents(jiraData);
  if (components.length > 0) {
    queries.push(`${projectInfo}${components.join(' ')} ${summary}`);
  }

  const keyPhrases = extractKeyPhrases(summary + ' ' + descriptionText);
  if (keyPhrases.length > 0) {
    queries.push(`${projectInfo}${keyPhrases.join(' ')}`);
  }

  return queries
    .filter(q => q.trim().length > 5)
    .filter((query, index, self) => self.indexOf(query) === index);
}



function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];

  const parts = text.split(/[.,;:()]/);

  parts.forEach(part => {
    const trimmed = part.trim();
    if (trimmed.length > 15 && trimmed.length < 100) {
      phrases.push(trimmed);
    }
  });

  return phrases;
}


function extractErrorMessage(text: string): string | null {
  const errorPatterns = [
    /error[:\s]+([^\n\r]{10,100})/gi,
    /failed[:\s]+([^\n\r]{10,100})/gi,
    /exception[:\s]+([^\n\r]{10,100})/gi,
    /cannot[:\s]+([^\n\r]{10,100})/gi,
  ];

  for (const pattern of errorPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractComponents(jiraData: any): string[] {
  const components: string[] = [];

  if (jiraData.fields?.components) {
    jiraData.fields.components.forEach((comp: any) => {
      if (comp.name) {
        components.push(comp.name);
      }
    });
  }

  if (jiraData.fields?.labels) {
    components.push(...jiraData.fields.labels);
  }

  if (jiraData.fields?.issuetype?.name) {
    components.push(jiraData.fields.issuetype.name);
  }

  return components;
}

function parseResolutionResponse(response: string): {
  status: 'FOUND' | 'NOT_FOUND';
  confidence: string;
  matchedTicket: string;
  resolution: string;
  technicalDetails: string;
} {
  const lines = response.split('\n');
  let status = 'NOT_FOUND' as 'FOUND' | 'NOT_FOUND';
  let confidence = 'Low';
  let matchedTicket = '';
  let resolution = 'No applicable resolution found.';
  let technicalDetails = '';

  let currentSection = '';

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('RESOLUTION_STATUS:')) {
      status = trimmedLine.includes('FOUND') ? 'FOUND' : 'NOT_FOUND';
    } else if (trimmedLine.startsWith('CONFIDENCE:')) {
      confidence = trimmedLine.split(':')[1]?.trim() || 'Low';
    } else if (trimmedLine.startsWith('MATCHED_TICKET:')) {
      matchedTicket = trimmedLine.split(':')[1]?.trim() || '';
    } else if (trimmedLine.startsWith('RESOLUTION:')) {
      currentSection = 'RESOLUTION';
      resolution = '';
    } else if (trimmedLine.startsWith('TECHNICAL_DETAILS:')) {
      currentSection = 'TECHNICAL_DETAILS';
      technicalDetails = '';
    } else if (currentSection === 'RESOLUTION' && trimmedLine) {
      resolution += (resolution ? '\n' : '') + trimmedLine;
    } else if (currentSection === 'TECHNICAL_DETAILS' && trimmedLine) {
      technicalDetails += (technicalDetails ? '\n' : '') + trimmedLine;
    }
  }

  if (technicalDetails && status === 'FOUND') {
    resolution += '\n\nTechnical Details:\n' + technicalDetails;
  }

  return { status, confidence, matchedTicket, resolution, technicalDetails };
}

function extractTextFromADF(adfContent: any): string {
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

async function saveAutoResolution(resolution: AutoResolution): Promise<AutoResolution> {
  try {
    if ('autoResolution' in prisma) {
      const saved = await (prisma as any).autoResolution.create({
        data: {
          ticketKey: resolution.ticketKey,
          matchedTicketKey: resolution.matchedTicketKey,
          confidence: resolution.confidence,
          resolution: resolution.resolution,
          status: resolution.status,
          orgId: resolution.orgId,
          connectorName: resolution.connectorName
        }
      });

      return saved;
    } else {
      console.log('AutoResolution model not yet available in the Prisma client. Skipping database save.');
      return resolution;
    }
  } catch (error) {
    console.error('Error saving auto resolution:', error);
    return resolution;
  }
}
