FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/
COPY web/package*.json ./web/
RUN npm install

COPY server ./server
COPY web ./web
RUN npm --workspace web run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY server/package*.json ./server/
COPY web/package*.json ./web/
RUN npm install --omit=dev

COPY server ./server
COPY --from=build /app/web/dist ./web/dist

EXPOSE 3001
CMD ["npm", "run", "start"]
