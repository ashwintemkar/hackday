import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: path.resolve(__dirname, 'e2e'),
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
  },
  webServer: {
    command: 'pnpm dev -p 3001',
    url: 'http://localhost:3001',
    timeout: 120_000,
    reuseExistingServer: true,
    cwd: __dirname,
    env: {
      NODE_ENV: 'test',
      NEXTAUTH_URL: 'http://localhost:3001',
      NEXTAUTH_SECRET: 'testsecret',
      TEST_AUTH: 'true',
      INTEGRATION_HUB_SECRET: 'testsecret',
      ALLOWED_CLIENT_IDS: 'integration_hub_client',
      S3_PREFIX: 'documents/test',
      GOOGLE_CLIENT_ID: 'test',
      GOOGLE_CLIENT_SECRET: 'test',
      GITHUB_ID: 'test',
      GITHUB_SECRET: 'test',
      MY_GITHUB_CLIENT_ID: 'test',
      MY_GITHUB_CLIENT_SECRET: 'test',
      AWS_S3_ACCESS_KEY_ID: 'test',
      AWS_S3_SECRET_ACCESS_KEY: 'test',
      MOCK_S3: 'true',
      DATABASE_URL: process.env.PLATFORM_NEXAGRID_DATABASE_URL || 'postgresql://chatbot_user:password@localhost:5432/db',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
