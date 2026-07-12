# ジャッジシステム（デーモン）のイメージ
# ビルドコンテキストは judge-system/
#
# コンテナ内からホストのDockerデーモン（/var/run/docker.sock）を叩いて
# サンドボックスコンテナを兄弟として生成する（Docker-outside-of-Docker）。
#
# コンパイラについて:
# dmdはarm64(Apple Silicon)に対応していないためLDCでビルドする。
# ただしubuntu24.04のapt版ldc(1.36/DMD 2.106)はconstants.dの
# 連想配列の静的初期化を壊すバグがあるため、dmd-2.111.0と同じ
# フロントエンドのldc-1.41.0をinstall.shで導入する。

FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    curl xz-utils gpg gcc libc6-dev libsqlite3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# D言語(ldc-1.41.0 = DMD v2.111.0フロントエンド)
RUN curl -fsS https://dlang.org/install.sh | bash -s ldc-1.41.0
ENV PATH=/root/dlang/ldc-1.41.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LIBRARY_PATH=/root/dlang/ldc-1.41.0/lib \
    LD_LIBRARY_PATH=/root/dlang/ldc-1.41.0/lib

# サンドボックス操作用のdocker CLI（デーモンはソケット経由でホストのものを使う）
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app/judge-system

COPY dub.json dub.selections.json ./
COPY source ./source
RUN dub build --compiler=ldc2 --build=release

ENV DB_PATH=/data/data.db

CMD ["./judge"]
