FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000 DATA_FILE=/data/db.json
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
