import { defineConfig, env } from "prisma/config";

// Only load dotenv locally; CI already passes env vars and skipping it avoids extra FS work.
if (!process.env.CI && !process.env.GITHUB_ACTIONS) {
  await import("dotenv/config");
}

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
