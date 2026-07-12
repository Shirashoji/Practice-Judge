#!/bin/bash
# ジャッジが異常終了した際に残った孤児サンドボックスコンテナを削除する。
# （正常時はジャッジが自分で削除するので通常は何も出ない）
set -eu

ids=$(docker ps -aq --filter label=practice-judge.sandbox)
if [ -z "$ids" ]; then
    echo "孤児サンドボックスはありません。"
    exit 0
fi

echo "$ids" | xargs docker rm -f
echo "削除しました。"
