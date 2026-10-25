// lib/jwt-service.ts
import { JWTPayload } from '@/types/type';
import { jwtVerify, SignJWT } from 'jose';

export class JWTService {
    private static getSecretKey(): Uint8Array {
        const secret = process.env.INTEGRATION_HUB_SECRET;
        if (!secret) {
            throw new Error('INTEGRATION_HUB_SECRET environment variable is required');
        }
        return new TextEncoder().encode(secret);
    }

    static async verifyToken(token: string): Promise<JWTPayload | null> {
        try {
            const secretKey = this.getSecretKey();

            const { payload } = await jwtVerify(token, secretKey, {
                algorithms: ['HS256']
            });

            if (!payload.org_id || !payload.org_name) {
                console.error('JWT missing required claims: org_id or org_name');
                return null;
            }

            return payload as JWTPayload;
        } catch (error) {
            console.error('JWT verification failed:', error);
            return null;
        }
    }

    static async verifyTokenWithClientValidation(token: string): Promise<JWTPayload | null> {
        try {
            const payload = await this.verifyToken(token);
            if (!payload) return null;

            const allowedClients = process.env.ALLOWED_CLIENT_IDS?.split(',') || [];
            if (allowedClients.length > 0 && payload.client_id && !allowedClients.includes(payload.client_id)) {
                console.error('Unauthorized client:', payload.client_id);
                return null;
            }

            return payload;
        } catch (error) {
            console.error('JWT verification with client validation failed:', error);
            return null;
        }
    }

    static async createToken(payload: Omit<JWTPayload, 'exp' | 'iat'>): Promise<string> {
        const secretKey = this.getSecretKey();

        return new SignJWT(payload)
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(secretKey);
    }
}