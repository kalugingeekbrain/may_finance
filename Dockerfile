FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY web ./web
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
