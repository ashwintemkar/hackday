# Base image
FROM node:20-alpine

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install

# Copy the rest of the application
COPY . .

# prisma.config.ts requires DATABASE_URL to be set just to parse (not to connect) - a
# build-time placeholder is enough for `prisma generate`; the real value comes from
# docker-compose's `environment:` at container start.
ARG DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
ENV DATABASE_URL=$DATABASE_URL

# Generate Prisma client
RUN pnpm run prisma:client

# Build application
RUN pnpm run build

# Expose port
EXPOSE 3000

# Start the application
CMD ["pnpm", "start"]