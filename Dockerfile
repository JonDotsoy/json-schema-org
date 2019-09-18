from node:alpine as builder

workdir /app
copy . .
run npm install && \
  npm run build

from node:alpine

workdir /app
env NODE_ENV=production
copy --from=builder /app/package.json ./package.json
copy --from=builder /app/package-lock.json ./package-lock.json
copy --from=builder /app/src ./src

run npm install --production

cmd npm start
