FROM node:20-alpine

RUN apk add --no-cache openssl ssl_client

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

EXPOSE 9000

CMD ["sh", "-c", "npx prisma generate && npm run dev"]
