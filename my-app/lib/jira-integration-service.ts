// lib/jira-integration-service.ts
import { JWTService } from "./jwt-service";
export class JiraIntegrationService {
  static async sendResolutionToIntegrationHub(
    ticketKey: string,
    resolution: string,
    connectorName: string,
    orgId: string,
    baseUrl?: string,
    actionType: 'resolution' | 'duplicate' = 'resolution',
    ticketDisplayKey?: string
  ): Promise<boolean> {
    try {
      const apiBaseUrl = process.env.INTEGRATION_HUB_URL || baseUrl || 'http://localhost:3001';
      const resolutionEndpoint = `${apiBaseUrl}/api/resolution/apply`;

      console.log(`Integration Hub URL from env: ${process.env.INTEGRATION_HUB_URL}`);
      console.log(`Using API Base URL: ${apiBaseUrl}`);
      console.log(`Creating JWT token for org: ${orgId}`);
      const token = await JWTService.createToken({
        org_id: orgId,
        org_name: process.env.ORG_NAME || 'Nexagrid',
        client_id: process.env.CLIENT_ID || 'nexagrid-rag'
      });

      const targetConnector = `${connectorName}_Update`;
      console.log(`Target connector: ${targetConnector}`);

      const action = actionType === 'duplicate' ? 'mark_as_duplicate' : 'apply_resolution';
      console.log(`Action to be performed: ${action}`);

      const payload: Record<string, any> = {
        ticketKey,
        resolution,
        connectorName: targetConnector,
        orgId,
        action,
        source: 'nexagrid_rag',
        actionType
      };

      if (ticketDisplayKey && ticketDisplayKey.trim().length > 0) {
        payload.ticketDisplayKey = ticketDisplayKey.trim();
      }

      console.log(`Sending ${actionType} for ticket ${ticketKey} to Integration Hub using connector ${targetConnector}`);
      console.log(`Payload:`, JSON.stringify(payload, null, 2));
      console.log(`Endpoint:`, resolutionEndpoint);
      console.log(`Token generated successfully`);

      const response = await fetch(resolutionEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      console.log(`Response status: ${response.status}`);
      console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Integration Hub error (${response.status}):`, errorText);

        if (response.status === 404) {
          console.error('404 Error Details:');
          console.error('- Endpoint:', resolutionEndpoint);
          console.error('- Method:', 'POST');
          console.error('- Base URL:', apiBaseUrl);
          console.error('- Full URL:', resolutionEndpoint);
          console.error('- This suggests the API route might not be properly configured');
        }

        return false;
      }

      const result = await response.json();
      console.log(`${actionType === 'duplicate' ? 'Duplicate notification' : 'Resolution'} sent successfully for ${ticketKey}`, result);

      return true;
    } catch (error) {
      console.error(`Error sending ${actionType === 'duplicate' ? 'duplicate notification' : 'resolution'} to Integration Hub for ticket ${ticketKey}:`, error);

      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }

      return false;
    }
  }
}
