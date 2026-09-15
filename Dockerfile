# The cloud, as Railway runs it.
#
# One image serves both the API and the dashboard: the cloud serves
# dashboard/dist itself, so there is nothing else to deploy. Only the cloud and
# the dashboard go in; the till (backend/, the Electron app) is installed on
# shop PCs and has no place in a server image — .dockerignore keeps it out.
#
# Two stages, because the dashboard is expensive to build and free to serve.
# Building it needs frontend's runtime packages: it compiles screens out of
# frontend/src, and those files import packages that resolve upward from where
# the importing file sits — into frontend/node_modules. On a laptop that
# directory exists because the POS has been installed there; on a clean
# checkout it does not, and the build fails on the first `recharts` import.
# So the first stage installs them and builds; the second copies out only the
# built files and the cloud's own few megabytes of dependencies. Nothing from
# the first stage's node_modules survives into what is deployed.

# ---------------------------------------------------------------- build ---
FROM node:22-alpine AS build
WORKDIR /app

# frontend's runtime packages. Everything heavy — Electron, electron-builder,
# the POS's own Vite — is dev-only and skipped; --ignore-scripts guards against
# any postinstall reaching for the network or a native toolchain.
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm ci --prefix frontend --omit=dev --ignore-scripts

COPY dashboard/package.json dashboard/package-lock.json dashboard/
RUN npm ci --prefix dashboard

# The dashboard compiles screens out of frontend/src; nothing else of the
# frontend is needed.
COPY frontend/src frontend/src
COPY dashboard dashboard
RUN npm run build --prefix dashboard

# ------------------------------------------------------------------ run ---
FROM node:22-alpine
WORKDIR /app

COPY cloud/package.json cloud/package-lock.json cloud/
RUN npm ci --prefix cloud --omit=dev

COPY cloud cloud
# Exactly where cloud/server.js looks for it: ../dashboard/dist.
COPY --from=build /app/dashboard/dist dashboard/dist

# Loopback is the right default on a box behind a reverse proxy, which is what
# cloud/server.js assumes. Inside a container the proxy is Railway's edge, on
# another machine, so the process has to listen on every interface.
ENV NODE_ENV=production
ENV BLAZE_CLOUD_HOST=0.0.0.0

# Railway injects PORT; 4000 is the fallback cloud/server.js uses without it.
EXPOSE 4000

CMD ["node", "cloud/server.js"]
