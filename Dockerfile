FROM nginx:1.27-alpine

RUN apk add --no-cache nodejs

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY server/ata-token.mjs /opt/ata-token.mjs
COPY server/40-ata-token.sh /docker-entrypoint.d/40-ata-token.sh
RUN chmod +x /docker-entrypoint.d/40-ata-token.sh
COPY index.html /usr/share/nginx/html/index.html
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
