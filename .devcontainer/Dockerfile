# Keep the Node version in step with .tool-versions (Renovate updates both).
FROM node:26.13.0-bookworm

# sudo lets `playwright install --with-deps` add Chromium's system libraries as the node user.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends sudo \
	&& rm -rf /var/lib/apt/lists/* \
	&& echo 'node ALL=(root) NOPASSWD:ALL' > /etc/sudoers.d/node \
	&& chmod 0440 /etc/sudoers.d/node

# Node 25+ no longer ships Corepack. It installs the pnpm version package.json's `packageManager`
# names, without asking first.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack && corepack enable
