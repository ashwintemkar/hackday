const { SignJWT } = require('jose');
require('dotenv').config({ path: '.env' });

async function generateTestJWT() {
    const secret = process.env.JWT_SECRET || process.env.INTEGRATION_HUB_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET not found in environment variables');
    }

    const secretKey = new TextEncoder().encode(secret);
    
    const payload = {
        org_id: "test_org_123",
        org_name: "Test Organization",
        client_id: "integration_hub_client"
    };

    const token = await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secretKey);

    console.log('Generated JWT Token:');
    console.log(token);
    console.log('\nPayload:', payload);
    
    return token;
}

generateTestJWT().catch(console.error);