# フロントのイメージ
# SPAモード(react-router.config.tsでssr:false)なので、ビルド成果物(build/client)を
# serve.jsで配信する。VITE_BASEURLはビルド時に焼き込まれるためbuild argで渡す。

FROM node:20-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:20-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:20-alpine AS build-env
ARG VITE_BASEURL
ENV VITE_BASEURL=$VITE_BASEURL
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:20-alpine
COPY ./package.json package-lock.json serve.js /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build/client /app/build/client
WORKDIR /app
CMD ["node", "serve.js"]
