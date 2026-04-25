FROM node:20-alpine
WORKDIR /app

# openssl required by Prisma at runtime
RUN apk add --no-cache openssl

# Install all deps first (better layer cache when only source changes)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client for the build platform (ARM64 on Raspberry Pi)
RUN npx prisma generate

# Copy source and build Nuxt
COPY . .
RUN npm run build

EXPOSE 3000

# On each start: apply pending migrations, then serve
CMD ["sh", "-c", "npx prisma migrate deploy && node .output/server/index.mjs"]
