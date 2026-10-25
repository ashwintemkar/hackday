import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command
} from "@aws-sdk/client-s3";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { Upload } from "@aws-sdk/lib-storage";

const USE_MOCK = process.env.MOCK_S3 === 'true';
const BASE_PREFIX = (process.env.S3_PREFIX || 'documents').replace(/\/$/, '');

const s3Client = new S3Client({
    region: "ap-south-1",
    credentials: {
        accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID || process.env.AWS_S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY || process.env.AWS_S3_SECRET_ACCESS_KEY!,
    },
});

const BUCKET_NAME = "documentsbucket-haddows";

export class S3Service {
    static async uploadFile(file: Buffer, fileName: string, chatFolder: string): Promise<string> {
        const key = `${BASE_PREFIX}/${chatFolder}/${fileName}`;
        if (USE_MOCK) {
            return key;
        }

        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: BUCKET_NAME,
                Key: key,
                Body: file,
                ContentType: this.getContentType(fileName),
            },
            queueSize: 4, 
            partSize: 5 * 1024 * 1024, 
            leavePartsOnError: false,
        });

        upload.on("httpUploadProgress", (progress) => {
            console.log(`Upload progress for ${fileName}: ${JSON.stringify(progress)}`);
        });

        await upload.done();
        return key;
    }

    static async objectExists(key: string): Promise<boolean> {
        const normalizedKey = key.startsWith('documents/') ? key : `documents/${key}`;
        try {
            await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: normalizedKey }));
            return true;
        } catch (err: any) {
            if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false;
            console.warn(`S3 headObject error for ${normalizedKey}:`, err?.name || err);
            return false;
        }
    }

    static async uploadImage(imageBuffer: Buffer, imageName: string, chatFolder: string): Promise<string> {
        await this.ensureFolder(`${BASE_PREFIX}/${chatFolder}/images`);

        const key = `${BASE_PREFIX}/${chatFolder}/images/${imageName}`;
        if (USE_MOCK) {
            return key;
        }

        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: BUCKET_NAME,
                Key: key,
                Body: imageBuffer,
                ContentType: this.getContentType(imageName),
            }
        });

        await upload.done();
        return key;
    }

    static async ensureFolder(folderPath: string): Promise<void> {
        if (USE_MOCK) return;
        try {
            const command = new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
                Prefix: `${folderPath}/`,
                MaxKeys: 1
            });

            const response = await s3Client.send(command);

            if (!response.Contents || response.Contents.length === 0) {
                await this.createFolder(folderPath);
            }
        } catch (error) {
            console.error(`Error checking/creating folder ${folderPath}:`, error);
            throw error;
        }
    }

    static async getFile(key: string): Promise<Buffer> {
        if (USE_MOCK) {
            return Buffer.from("");
        }
        try {
            const normalizedKey = key.startsWith(`${BASE_PREFIX}/`)
                ? key
                : key.startsWith('documents/')
                    ? key
                    : `${BASE_PREFIX}/${key}`;

            const response = await s3Client.send(
                new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: normalizedKey,
                })
            );

            if (response.Body instanceof Readable) {
                return this.streamToBuffer(response.Body);
            } else {
                throw new Error("Invalid response body type");
            }
        } catch (error) {
            console.error(`Error retrieving file ${key}:`, error);
            throw error;
        }
    }

    static async deleteFile(key: string): Promise<void> {
        if (USE_MOCK) return;
        const normalizedKey = key.startsWith(`${BASE_PREFIX}/`)
            ? key
            : key.startsWith('documents/')
                ? key
                : `${BASE_PREFIX}/${key}`;

        await s3Client.send(
            new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: normalizedKey,
            })
        );
    }

    static async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
        const normalizedKey = key.startsWith(`${BASE_PREFIX}/`)
            ? key
            : key.startsWith('documents/')
                ? key
                : `${BASE_PREFIX}/${key}`;
        if (USE_MOCK) {
            return `https://example.com/${normalizedKey}`;
        }

        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: normalizedKey,
        });

        return getSignedUrl(s3Client, command, { expiresIn });
    }

    static async listFiles(chatFolder: string, includeImages: boolean = false): Promise<string[]> {
        if (USE_MOCK) return [];
        const prefix = `${BASE_PREFIX}/${chatFolder}/`;

        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: prefix,
        });

        const response = await s3Client.send(command);
        return (response.Contents || [])
            .filter(file => {
                const key = file.Key!;
                const isFolder = key.endsWith('/');
                const isImage = key.includes('/images/');

                return !isFolder &&
                    file.Size! > 0 &&
                    (includeImages || !isImage);
            })
            .map(file => file.Key!)
            .filter(key => key.length > 0);
    }

    static async listImages(chatFolder: string): Promise<string[]> {
        if (USE_MOCK) return [];
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: `${BASE_PREFIX}/${chatFolder}/images/`,
        });

        const response = await s3Client.send(command);
        return (response.Contents || [])
            .filter(file => !file.Key!.endsWith('/') && file.Size! > 0)
            .map(file => file.Key!)
            .filter(key => key.length > 0);
    }

    static async createFolder(folderPath: string): Promise<void> {
        if (USE_MOCK) return;
        const normalizedPath = folderPath.startsWith(`${BASE_PREFIX}/`) ? 
            folderPath : `${BASE_PREFIX}/${folderPath}`;

        const key = `${normalizedPath}/`;
        
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: BUCKET_NAME,
                Key: key,
                Body: Buffer.from(''),
                ContentLength: 0,
            }
        });

        await upload.done();
    }

    private static getContentType(fileName: string): string {
        const ext = fileName.split('.').pop()?.toLowerCase();
        const mimeTypes: { [key: string]: string } = {
            'pdf': 'application/pdf',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc': 'application/msword',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls': 'application/vnd.ms-excel',
            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'ppt': 'application/vnd.ms-powerpoint',
            'csv': 'text/csv',
            'json': 'application/json',
            'html': 'text/html',
            'css': 'text/css',
            'js': 'application/javascript',
        };

        return mimeTypes[ext || ''] || 'application/octet-stream';
    }

    private static async streamToBuffer(stream: Readable): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: any[] = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }
}
