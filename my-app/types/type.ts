export interface JiraTicket {
    id: string;
    key: string;
    self: string;
    expand?: string;
    fields: {
        summary: string;
        description?: {
            type: string;
            version: number;
            content: any[];
        } | string;
        status: {
            self: string;
            description: string;
            iconUrl: string;
            name: string;
            id: string;
            statusCategory: {
                self: string;
                id: number;
                key: string;
                colorName: string;
                name: string;
            };
        };
        assignee?: {
            self: string;
            accountId: string;
            displayName: string;
            emailAddress?: string;
            avatarUrls: Record<string, string>;
            active: boolean;
            timeZone: string;
            accountType: string;
        };
        priority?: {
            self: string;
            iconUrl: string;
            name: string;
            id: string;
        };
        project: {
            self: string;
            id: string;
            key: string;
            name: string;
            projectTypeKey: string;
            simplified?: boolean;
            avatarUrls: Record<string, string>;
        };
        created: string;
        updated: string;
        resolutiondate?: string;
        duedate?: string;
        components: Array<{
            self?: string;
            id: string;
            name: string;
            description?: string;
        }>;
        labels: string[];
        attachment?: Array<{
            self: string;
            id: string;
            filename: string;
            author: {
                self: string;
                accountId: string;
                displayName: string;
                active: boolean;
            };
            created: string;
            size: number;
            mimeType: string;
            content?: string;
            thumbnail?: string;
        }>;
        issuelinks: Array<{
            id: string;
            self: string;
            type: {
                id: string;
                name: string;
                inward: string;
                outward: string;
                self: string;
            };
            inwardIssue?: {
                id: string;
                key: string;
                self: string;
                fields: {
                    summary: string;
                    status: {
                        name: string;
                        id: string;
                    };
                    priority: {
                        name: string;
                        id: string;
                    };
                    issuetype: {
                        name: string;
                        id: string;
                    };
                };
            };
            outwardIssue?: {
                id: string;
                key: string;
                self: string;
                fields: {
                    summary: string;
                    status: {
                        name: string;
                        id: string;
                    };
                    priority: {
                        name: string;
                        id: string;
                    };
                    issuetype: {
                        name: string;
                        id: string;
                    };
                };
            };
        }>;
        comment: {
            comments: Array<{
                self: string;
                id: string;
                author: {
                    self: string;
                    accountId: string;
                    displayName: string;
                    emailAddress?: string;
                    avatarUrls: Record<string, string>;
                    active: boolean;
                    timeZone: string;
                    accountType: string;
                };
                body: any;
                updateAuthor: {
                    self: string;
                    accountId: string;
                    displayName: string;
                    active: boolean;
                };
                created: string;
                updated: string;
                visibility?: {
                    type: string;
                    value: string;
                };
            }>;
            self: string;
            maxResults: number;
            total: number;
            startAt: number;
        };
        votes: {
            self: string;
            votes: number;
            hasVoted: boolean;
        };
        watches: {
            self: string;
            watchCount: number;
            isWatching: boolean;
        };
        worklog: {
            startAt: number;
            maxResults: number;
            total: number;
            worklogs: Array<{
                self: string;
                author: {
                    self: string;
                    accountId: string;
                    displayName: string;
                    emailAddress?: string;
                    avatarUrls: Record<string, string>;
                    active: boolean;
                    timeZone: string;
                    accountType: string;
                };
                updateAuthor: {
                    self: string;
                    accountId: string;
                    displayName: string;
                    active: boolean;
                };
                comment?: string;
                created: string;
                updated: string;
                visibility?: {
                    type: string;
                    value: string;
                };
                started: string;
                timeSpent: string;
                timeSpentSeconds: number;
                id: string;
                issueId: string;
            }>;
        };
        issuetype: {
            self: string;
            id: string;
            description: string;
            iconUrl: string;
            name: string;
            subtask: boolean;
            avatarId: number;
            entityId: string;
            hierarchyLevel: number;
        };
        creator: {
            self: string;
            accountId: string;
            emailAddress: string;
            avatarUrls: Record<string, string>;
            displayName: string;
            active: boolean;
            timeZone: string;
            accountType: string;
        };
        reporter: {
            self: string;
            accountId: string;
            emailAddress: string;
            avatarUrls: Record<string, string>;
            displayName: string;
            active: boolean;
            timeZone: string;
            accountType: string;
        };
        resolution?: {
            self: string;
            id: string;
            description: string;
            name: string;
        };
        timespent?: number;
        timeoriginalestimate?: number;
        timeestimate?: number;
        aggregatetimespent?: number;
        aggregatetimeestimate?: number;
        aggregatetimeoriginalestimate?: number;
        timetracking?: {
            originalEstimate?: string;
            remainingEstimate?: string;
            timeSpent?: string;
            originalEstimateSeconds?: number;
            remainingEstimateSeconds?: number;
            timeSpentSeconds?: number;
        };
        [key: `customfield_${string}`]: any;
        fixVersions: any[];
        versions: any[];
        environment?: string;
        subtasks: any[];
        lastViewed?: string;
        progress?: {
            progress: number;
            total: number;
            percent: number;
        };
        aggregateprogress?: {
            progress: number;
            total: number;
            percent: number;
        };
        workratio?: number;
        statuscategorychangedate?: string;
        security?: any;
        issuerestriction?: {
            issuerestrictions: Record<string, any>;
            shouldDisplay: boolean;
        };
        customfield_10070?: any;
        extractedResolution?: string;
    };
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

export interface JWTPayload {
    org_id: string;
    org_name: string;
    client_id?: string;
    exp?: number;
    iat?: number;
    [key: string]: any;
}


export interface ProcessedFile {
    filename: string;
    s3Key: string;
    size: number;
    mimeType: string;
    content?: string;
}


export interface ProcessTicketResult {
    fileName: string;
    s3Key: string;
    attachments: string[];
    uploadedFiles: ProcessedFile[];
    processedAttachments: AttachmentData[];
}

export interface AttachmentData {
    filename: string;
    content: string;
    mimeType: string;
    size: number;
    extractedText?: string;
}

export interface JiraPayloadWithAttachments {
    attachments?: AttachmentData[];
    duplicateNeeded?: boolean;
    [key: string]: any;
}

