FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && python3 -m venv /opt/sweet-house-python \
  && /opt/sweet-house-python/bin/pip install --no-cache-dir reportlab pypdf uharfbuzz \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node . /app

ENV NODE_ENV=production \
    CLOUD_RUN=1 \
    SWEET_HOUSE_PYTHON=/opt/sweet-house-python/bin/python

USER node
EXPOSE 8080

CMD ["node", "local-server.mjs"]
