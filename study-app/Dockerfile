# syntax=docker/dockerfile:1.7
#
# 日常日本語 study-app container image. Two-stage:
#
#   - build:   `vite build` under the pinned Bun image (same point release as the
#              API container) → static assets in /app/dist.
#   - runtime: nginx:alpine serving those assets. No Bun/Node at runtime — it's a
#              static site, so the runtime image is tiny.
#
# VITE_API_BASE is baked at BUILD time: Vite inlines import.meta.env.VITE_* into the
# bundle, and a static site has no runtime env. So the API origin is a build arg —
# prod passes https://api.wkenhanced.dev (see compose.yaml `web.build.args`). The app
# (src/io/api.js) reads it to address the cross-origin API; default below keeps a
# bare `docker build` here pointed at prod.

FROM oven/bun:1.3.8 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG VITE_API_BASE=https://api.wkenhanced.dev
ENV VITE_API_BASE=$VITE_API_BASE
RUN bun run build

FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Documentation-only — compose.yaml publishes the host port. nginx listens on 80.
EXPOSE 80
