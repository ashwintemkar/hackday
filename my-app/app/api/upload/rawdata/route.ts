// app/api/upload/rawdata/route.ts
import { NextResponse } from "next/server";
import { S3Service } from "@/lib/s3-service";
import { JWTService } from "@/lib/jwt-service";
import { logIncomingRequest } from '@/lib/request-logger';
import { handleNewTicketResolution, handleNewTicketResolutionNormalized } from '@/lib/ticket-resolution-service';
import { JiraPayloadWithAttachments, ProcessedFile } from "@/types/type";
import { JiraDocumentProcessor } from "@/lib/documents/jira-document-processor";
import { NormalizedDocumentProcessor } from "@/lib/documents/normalized-document-processor";
import { extractResolutionFromTicket, handleTicketStatusUpdate, processTicketDocument } from "@/lib/documents/jira-preprocess";
import crypto from "crypto";



function normalizePossibleProject(value: any): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function deriveProjectKey(candidate: any): string | undefined {
  const normalized = normalizePossibleProject(candidate);
  if (!normalized) return undefined;
  return normalized.toUpperCase();
}

function deriveProjectKeyFromTicketId(ticketId: any): string | undefined {
  if (typeof ticketId !== "string") return undefined;
  const trimmed = ticketId.trim();
  if (!trimmed) return undefined;
  const delimiterIndex = trimmed.indexOf("-");
  if (delimiterIndex <= 0) return undefined;
  return trimmed.substring(0, delimiterIndex).toUpperCase();
}

function ensureJiraProjectMetadata(jiraData: any): void {
  if (!jiraData || typeof jiraData !== "object") return;
  jiraData.fields = jiraData.fields || {};
  const project = (jiraData.fields.project = jiraData.fields.project || {});
  const normalized = (jiraData as any)._normalized || {};

  const candidateKeys: Array<string | undefined> = [
    project.key,
    normalized.projectKey,
    deriveProjectKey(normalized.project),
    deriveProjectKeyFromTicketId(jiraData.key),
    deriveProjectKeyFromTicketId((jiraData as any).ticket_id),
    deriveProjectKey(project.id),
    deriveProjectKey(project.name),
  ];

  const resolvedKey = candidateKeys.map(deriveProjectKey).find(Boolean);
  if (resolvedKey) {
    project.key = resolvedKey;
  }

  if (!project.name || typeof project.name !== "string" || !project.name.trim()) {
    const normalizedName =
      typeof normalized.projectName === "string" && normalized.projectName.trim()
        ? normalized.projectName.trim()
        : undefined;
    project.name =
      normalizedName ||
      normalizePossibleProject(normalized.project) ||
      project.name ||
      project.key ||
      "Unknown Project";
  }
}

function mapServiceNowState(state: any, display?: string): string {
  if (display && typeof display === 'string' && display.trim().length > 0) return display;
  const code = typeof state === 'string' ? parseInt(state, 10) : Number(state);
  switch (code) {
    case 1: return 'New';
    case 2: return 'InProgress';
    case 3: return 'Pending';
    case 6: return 'Completed';
    case 7: return 'Completed';
    case 8: return 'Cancelled';
    default: return typeof state === 'string' ? state : 'Unknown';
  }
}

function toStr(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return (v.display_value || v.name || v.value || v.sys_id || '').toString();
  return String(v);
}

function normalizeFromServiceNowPayload(payload: any) {
  const src = payload?.result
    ? (Array.isArray(payload.result) ? payload.result[0] : payload.result)
    : payload || {};

  const ticket_number = toStr(src.number || payload.number);
  const ticket_id = src.sys_id || payload.sys_id || ticket_number || '';
  const title = src.short_description || payload.short_description || '';
  const description = src.description || payload.description || '';
  const rawState = (src.state ?? src.incident_state ?? payload.state ?? payload.incident_state);
  const status = mapServiceNowState(rawState, src.state_display_value ?? payload.state_display_value);
  const priority = toStr(src.priority_display_value) || toStr(src.priority);
  const category = toStr(src.category);
  const created_at = src.sys_created_on || src.opened_at || payload.opened_at;
  const updated_at = src.sys_updated_on || src.updated_at || payload.updated_at;
  const assignment_group = src.assignment_group || payload.assignment_group;
  const project = toStr(assignment_group) || 'default';

  // Try to derive resolution text if present
  const resolutionSegments: string[] = [];
  const contextualSegments: string[] = [];

  const toCleanText = (value: any): string | undefined => {
    if (value === null || value === undefined) return undefined;
    const raw =
      typeof value === 'string'
        ? value
        : typeof value === 'object'
        ? value.display_value ?? value.value ?? value.name ?? value.label ?? value.sys_id ?? ''
        : String(value);
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const addSegment = (
    label: string,
    value: any,
    includeInResolution: boolean
  ) => {
    const text = toCleanText(value);
    if (!text) return;
    if (includeInResolution) {
      resolutionSegments.push(text);
    }
    contextualSegments.push(`${label}:\n${text}`);
  };

  addSegment('Close Notes', src.close_notes, true);
  addSegment('Resolution', (src as any).resolution, true);
  addSegment('Resolution Notes', (src as any).resolution_notes, true);
  addSegment('Resolution Details', (src as any).u_resolution_details, true);
  addSegment('Solution', (src as any).solution, true);

  addSegment('Work Notes', src.work_notes, false);
  addSegment('Comments', src.comments, false);

  const resolutionText = resolutionSegments.length
    ? resolutionSegments.join('\n\n')
    : undefined;

  const extractedResolution =
    contextualSegments.length > 0
      ? contextualSegments.join('\n\n')
      : resolutionText;

  const normalized = {
    ticket_id,
    title,
    description,
    status,
    priority,
    category,
    attachments: [],
    project,
    created_at,
    updated_at,
    custom_fields: {
      assignee: toStr(src.assigned_to || payload.assigned_to),
      caller: toStr(src.caller_id || payload.caller_id),
      opened_by: toStr(src.opened_by || payload.opened_by),
      impact: toStr(src.impact || payload.impact),
      urgency: toStr(src.urgency || payload.urgency),
      ticket_number: ticket_number
    },
    source_app: 'ServiceNow',
    ticket_number,
    resolution: resolutionText,
    extractedResolution,
    connectorName: payload.connectorName || (src as any).connectorName || ''
  };

  if (!normalized.ticket_id || !normalized.title || !normalized.status || !normalized.project) {
    return null;
  }

  return normalized;
}

export async function POST(req: Request) {
  try {
    console.log('Jira webhook endpoint called');

    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: "Missing or invalid authorization header" }, { status: 401 });
    }

    const token = authHeader.substring(7);

    const jwtPayload = await JWTService.verifyTokenWithClientValidation(token);
    if (!jwtPayload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    logIncomingRequest(req, jwtPayload.client_id);
    console.log('Authenticated request from client:', jwtPayload.client_id);

    const { org_id, org_name } = jwtPayload;
    if (!org_id || !org_name) {
      return NextResponse.json({ error: "Missing org_id or org_name in token" }, { status: 400 });
    }

    let jiraData: JiraPayloadWithAttachments | any;
    let uploadedFiles: ProcessedFile[] = [];

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const payloadEntry = formData.get('payload');

      if (!payloadEntry || typeof payloadEntry !== 'string') {
        return NextResponse.json({ error: "Missing payload in form data" }, { status: 400 });
      }

      jiraData = JSON.parse(payloadEntry);

      const files = formData.getAll('files') as File[];
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${jiraData.key}_${sanitizedFilename}`;
        const chatFolder = `jira_${org_id}/attachments`;

        const s3Key = await S3Service.uploadFile(buffer, fileName, chatFolder);

        uploadedFiles.push({
          filename: sanitizedFilename,
          s3Key,
          size: file.size,
          mimeType: file.type,
          content: buffer.toString('base64')
        });

        console.log(`Uploaded file: ${fileName} -> ${s3Key}`);
      }
    } else {
      jiraData = await req.json();
    }

    console.log('Received data for org:', org_name);
    const sourceSystemHeader = req.headers.get('x-source-system') || '';
    const webhookEventRaw = (jiraData && (jiraData.webhookEvent || '')) as string;
    const isNormalized = !!(jiraData && (jiraData.ticket_id || jiraData.source_app || jiraData.sourceSystem));
    const sourceSystem = (jiraData?.sourceSystem || jiraData?.source_app || sourceSystemHeader || 'jira').toLowerCase();

    console.log('Ticket key:', isNormalized ? (jiraData.ticket_id || 'UNKNOWN') : (jiraData.key || 'UNKNOWN'));

    const webhookEvent = webhookEventRaw || 'jira:issue_updated';
    console.log('Webhook event:', webhookEvent);

    const duplicateNeeded = jiraData.duplicateNeeded !== false;
    console.log('Duplicate detection enabled:', duplicateNeeded);

    const attachments = jiraData.attachments || [];
    if (attachments.length > 0) {
      console.log(`Found ${attachments.length} attachments in payload`);
    }

    if (uploadedFiles.length > 0) {
      console.log(`Found ${uploadedFiles.length} uploaded files`);
    }

    if (isNormalized && sourceSystem === 'jira') {
      const raw = (jiraData as any)._raw || (jiraData as any).raw || (jiraData as any).original;
      if (raw && raw.fields) {
        const merged = {
          ...raw,
          webhookEvent,
          sourceSystem: 'jira',
          connectorName: (jiraData as any).connectorName ?? (raw as any).connectorName,
          duplicateNeeded,
          attachments: (jiraData as any).attachments ?? (raw as any).attachments,
          extractedResolution: (jiraData as any).extractedResolution ?? (raw as any).extractedResolution,
          _normalized: jiraData
        } as any;

        const normalizedTicketId = (jiraData as any).ticket_id || (jiraData as any).key;
        if (!(merged.fields?.project?.name) && (jiraData as any).project) {
          merged.fields = merged.fields || {};
          merged.fields.project = merged.fields.project || { name: (jiraData as any).project };
        }
        if (merged.fields?.project) {
          const existingProject = merged.fields.project as any;
          const projectKeyFromRaw = existingProject.key || (raw as any)?.fields?.project?.key;
          const derivedProjectKey = projectKeyFromRaw || (normalizedTicketId ? String(normalizedTicketId).split('-')[0] : undefined);
          if (!existingProject.key && derivedProjectKey) {
            existingProject.key = derivedProjectKey;
          }
          if (!existingProject.name) {
            existingProject.name = (jiraData as any).project || derivedProjectKey || existingProject.key || '';
          }
          merged.fields.project = existingProject;
        }
        if (!merged.key && (jiraData as any).ticket_id) {
          merged.key = (jiraData as any).ticket_id;
        }
        if (!(merged.fields?.summary) && (jiraData as any).title) {
          merged.fields = merged.fields || {};
          merged.fields.summary = (jiraData as any).title;
        }
        if (!(merged.fields?.status?.name) && (jiraData as any).status) {
          merged.fields = merged.fields || {};
          merged.fields.status = merged.fields.status || {};
          merged.fields.status.name = (jiraData as any).status;
      }

      jiraData = merged;
      ensureJiraProjectMetadata(jiraData);
    }
  }

  if (isNormalized && sourceSystem !== 'jira') {
      // Normalized route (e.g., ServiceNow)
      // If Integration Hub didn’t apply mapping yet, attempt a best-effort normalization here
      const needsAutoNormalize = !jiraData.ticket_id || !jiraData.title || !jiraData.status || !jiraData.project;
      if (needsAutoNormalize && (sourceSystem === 'servicenow' || webhookEvent.startsWith('servicenow:'))) {
        const raw = (jiraData as any)._raw || (jiraData as any).raw || (jiraData as any).original || jiraData;
        const outerConnectorName = (jiraData as any).connectorName || '';
        const auto = normalizeFromServiceNowPayload(raw);
        if (auto) {
          if (outerConnectorName && !auto.connectorName) {
            (auto as any).connectorName = outerConnectorName;
          }
          jiraData = auto;
          if (!jiraData.project || String(jiraData.project).trim().length === 0) {
            jiraData.project = 'sow';
          }
        }
      }

      const validation = NormalizedDocumentProcessor.validate(jiraData);
      if (!validation.isValid) {
        console.error('Validation failed:', validation.errors);
        return NextResponse.json({ error: "Invalid normalized data", details: validation.errors }, { status: 400 });
      }

      const statusName = jiraData.status || 'Unknown';
      const duplicateNeeded = jiraData.duplicateNeeded !== false;

      try {
        if (!jiraData.content_hash) {
          const parts: string[] = [];
          parts.push(String(jiraData.status || ''));
          parts.push(String(jiraData.title || ''));
          parts.push(String(jiraData.description || ''));
          if (jiraData.extractedResolution) parts.push(String(jiraData.extractedResolution));
          const canonical = parts.join('|');
          jiraData.content_hash = crypto.createHash('md5').update(canonical, 'utf8').digest('hex');
        }

        const sanitize = (v: any) => String(v || '').replace(/[^a-zA-Z0-9-_]/g, '_');
        const platform = (jiraData.source_app || sourceSystem || 'ticket').toLowerCase();
        const markerFolder = `idempotency/${org_id}/${sanitize(platform)}_${sanitize(jiraData.project)}/${sanitize(jiraData.ticket_id)}`;
        const markerKey = `${markerFolder}/${jiraData.content_hash}.marker`;
        const exists = await S3Service.objectExists(markerKey);
        if (exists) {
          console.log(`Idempotent skip: ${jiraData.ticket_id} hash ${jiraData.content_hash}`);
          return NextResponse.json({
            success: true,
            message: 'Duplicate content state. Skipping embedding.',
            ticketKey: jiraData.ticket_id,
            contentHash: jiraData.content_hash,
            processed: false,
            idempotent: true
          }, { status: 200 });
        }

        (jiraData as any).__idempotency_marker = { folder: markerFolder, file: `${jiraData.content_hash}.marker` };
      } catch (idemErr) {
        console.warn('Idempotency check failed (continuing):', idemErr);
      }

      if (
        webhookEvent === 'servicenow:incident_created' ||
        webhookEvent === 'jira:issue_created' ||
        webhookEvent === 'salesforce:case_created' ||
        webhookEvent === 'salesforce:case_comment'
      ) {
        console.log(`Processing new normalized ticket ${jiraData.ticket_id} with status "${statusName}"`);

        const resolutionResult = await handleNewTicketResolutionNormalized({
          title: jiraData.title,
          description: jiraData.description,
          status: jiraData.status,
          project: jiraData.project,
          ticket_id: jiraData.ticket_id,
          source_app: sourceSystem,
          connectorName: jiraData.connectorName || ''
        },
        org_id,
        org_name,
        req,
        duplicateNeeded
        );

        if (resolutionResult.found && resolutionResult.resolutionText) {
          console.log(`Found resolution for ticket ${jiraData.ticket_id}. Including in document before embedding.`);
          jiraData.extractedResolution = resolutionResult.resolutionText;
        }

        await NormalizedDocumentProcessor.process(
          jiraData,
          org_id,
          org_name,
          req,
          {
            duplicateCheck: duplicateNeeded,
            duplicateMatch: resolutionResult.type === 'duplicate'
              ? {
                  matchedTicketKey: resolutionResult.matchedTicketKey,
                  matchedTicketNumber: resolutionResult.matchedTicketNumber,
                  similarity: resolutionResult.confidence,
                  projectKey: resolutionResult.duplicateProjectKey,
                }
              : undefined,
            summaryOverride: resolutionResult.generatedSummary,
          }
        );
        try {
          const mk = (jiraData as any).__idempotency_marker;
          if (mk?.folder && mk?.file) {
            await S3Service.uploadFile(Buffer.from('1'), mk.file, mk.folder);
          }
        } catch (merr) {
          console.warn('Failed writing idempotency marker:', merr);
        }
        return NextResponse.json({
          success: true,
          message: "New normalized ticket processed",
          ticketKey: jiraData.ticket_id,
          status: statusName,
          processedForEmbedding: true,
          duplicateDetectionEnabled: duplicateNeeded,
          resolutionFound: !!resolutionResult.found,
        });
      } else {
        const acceptedStatuses = ['Done', 'Resolved', 'Closed', 'Complete', 'Completed'];
        if (!statusName || !acceptedStatuses.some(s => s.toLowerCase() === statusName.toLowerCase())) {
          console.log(`Normalized ticket ${jiraData.ticket_id} has status "${statusName}" - not processing for update event`);
          return NextResponse.json({ message: `Ticket status "${statusName}" not in accepted statuses`, processed: false }, { status: 200 });
        }

        console.log(`Processing normalized ticket update ${jiraData.ticket_id} with status "${statusName}" for knowledge base`);
        const normalizedResult = await NormalizedDocumentProcessor.process(
          jiraData,
          org_id,
          org_name,
          req,
          {
            duplicateCheck: false,
            summaryOverride: undefined,
          }
        );
        try {
          const mk = (jiraData as any).__idempotency_marker;
          if (mk?.folder && mk?.file) {
            await S3Service.uploadFile(Buffer.from('1'), mk.file, mk.folder);
          }
        } catch (merr) {
          console.warn('Failed writing idempotency marker:', merr);
        }
        return NextResponse.json({
          success: true,
          message: "Normalized ticket added to knowledge base",
          fileName: normalizedResult.fileName,
          s3Key: normalizedResult.s3Key,
          orgId: org_id,
          ticketKey: jiraData.ticket_id,
          status: statusName
        });
      }
    }

    // Jira route (unchanged)
    ensureJiraProjectMetadata(jiraData);
    const validation = JiraDocumentProcessor.validateJiraData(jiraData);
    if (!validation.isValid) {
      console.error('Validation failed:', validation.errors);
      return NextResponse.json({
        error: "Invalid Jira data",
        details: validation.errors
      }, { status: 400 });
    }

    const statusName = jiraData.fields?.status?.name;

    if (webhookEvent === 'jira:issue_created' || webhookEvent === 'servicenow:incident_created') {
      console.log(`Processing new ticket ${jiraData.key} with status "${statusName}"`);
      
      console.log(`Processing attachments for ticket ${jiraData.key}`);
      
      const processedAttachments = attachments.length > 0 || uploadedFiles.length > 0 
        ? await JiraDocumentProcessor.processAttachmentsForDocument(
            [...attachments, ...uploadedFiles.map(file => ({
              id: file.filename,
              filename: file.filename,
              mimeType: file.mimeType,
              content: file.content || '',
              size: file.size
            }))]
          )
        : [];
      
      console.log(`Checking for potential resolution for ticket ${jiraData.key}`);
      const resolutionResult = await handleNewTicketResolution(
        jiraData,
        org_id,
        org_name,
        req,
        processedAttachments,
        duplicateNeeded
      );

      if (resolutionResult.found && resolutionResult.resolutionText) {
        console.log(`Found resolution for ticket ${jiraData.key}. Adding to ticket data before embedding.`);
        jiraData.extractedResolution = resolutionResult.resolutionText;
      }

      console.log(`Processing document for embedding for ticket ${jiraData.key}`);
      const processResult = await processTicketDocument(jiraData, org_id, org_name, req, attachments, uploadedFiles);

      return NextResponse.json({
        success: true,
        message: "New Jira ticket processed",
        ticketKey: jiraData.key,
        resolutionFound: resolutionResult.found,
        status: statusName,
        processedForEmbedding: true,
        attachmentsProcessed: attachments.length,
        duplicateDetectionEnabled: duplicateNeeded,
        ...(resolutionResult.found && {
          confidence: resolutionResult.confidence,
          matchedTicket: resolutionResult.matchedTicketKey
        })
      });
    } else {
      const acceptedStatuses = ['Done', 'Resolved', 'Closed', 'Complete', 'Completed'];

      if (!statusName || !acceptedStatuses.some(status =>
        statusName.toLowerCase() === status.toLowerCase()
      )) {
        console.log(`Ticket ${jiraData.key} has status "${statusName}" - not processing for update event`);
        return NextResponse.json({
          message: `Ticket status "${statusName}" is not in accepted statuses for updates: ${acceptedStatuses.join(', ')}`,
          processed: false
        }, { status: 200 });
      }

      console.log(`Processing updated ticket ${jiraData.key} with status "${statusName}" for knowledge base only`);

      const resolutionText = extractResolutionFromTicket(jiraData);
      if (resolutionText) {
        console.log(`Found resolution for ticket ${jiraData.key}: ${resolutionText.substring(0, 100)}...`);
        jiraData.extractedResolution = resolutionText;
      }

      
      const result = await handleTicketStatusUpdate(jiraData, org_id, org_name, req, attachments, uploadedFiles);

      return NextResponse.json({
        success: true,
        message: "Jira ticket added to knowledge base",
        fileName: result.fileName,
        s3Key: result.s3Key,
        orgId: org_id,
        ticketKey: jiraData.key,
        status: statusName,
        attachmentsProcessed: attachments.length,
        resolutionFound: !!resolutionText
      });
    }

  } catch (error: any) {
    console.error("Error processing Jira webhook:", error);
    return NextResponse.json(
      {
        error: "Error processing Jira data",
        details: error instanceof Error ? error.message : 'An unknown error occurred',
        success: false
      },
      { status: 500 }
    );
  }
}


