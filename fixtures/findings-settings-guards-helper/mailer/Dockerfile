FROM node:22-alpine
WORKDIR /app
COPY . .
ENV MAIL_FROM=noreply@example.com
CMD ["doppler", "run", "--", "node", "dist/app.js"]
