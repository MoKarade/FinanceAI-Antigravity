# Relais /api/** de FinanceAI : aucune dépendance npm, aucun secret.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json relais.mjs server.mjs ./
USER node
CMD ["node", "server.mjs"]
