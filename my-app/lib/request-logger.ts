// lib/request-logger.ts
export function logIncomingRequest(req: Request, clientId?: string) {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.url;
    const userAgent = req.headers.get('user-agent') || 'Unknown';
    const xForwardedFor = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'Unknown';

    console.log(`[${timestamp}] ${method} ${url} - Client: ${clientId || 'Unauthenticated'} - IP: ${xForwardedFor} - UA: ${userAgent}`);
}