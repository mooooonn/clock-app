FROM python:3.12-slim

WORKDIR /app
COPY server.py index.html styles.css app.js /app/

ENV STATE_DIR=/data \
    PORT=8080 \
    BIND=0.0.0.0

EXPOSE 8080

CMD ["python", "-u", "server.py"]
