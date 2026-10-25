import { createHmac } from "node:crypto";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Minimal HS256 JWT signer, matching integration-hub's own JWTService
 * (services/jwt.service.ts), so the gateway can authenticate as a machine
 * client without adding a JWT library for one call site.
 */
export function signHs256Jwt(payload: Record<string, unknown>, secret: string, expiresInSeconds = 3600): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(fullPayload));
  const signature = base64url(createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest());

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
