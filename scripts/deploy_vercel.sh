#!/usr/bin/env bash
# Publica o protótipo Three.js (web/) na Vercel, projeto `j3f-simbolo-3d`.
#
# Monta uma pasta temporária só com o que o protótipo carrega — web/ e os dois
# arquivos de export/ referenciados em web/src/j3f-config.js — e faz o deploy de
# produção pela CLI da Vercel via npx. O repositório não é alterado.
#
# Uso (a partir de qualquer pasta):
#   scripts/deploy_vercel.sh            # produção (https://j3f-simbolo-3d.vercel.app)
#   scripts/deploy_vercel.sh --preview  # deploy de preview
#
# Requer Node.js e login na Vercel (`npx vercel login`, conta oktavio-4322).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="j3f-simbolo-3d"
TMP="$(mktemp -d)"
OUT="$TMP/$PROJECT"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT/export"
rsync -a --exclude ".DS_Store" "$ROOT/web" "$OUT/"
cp "$ROOT/export/j3f-symbol.glb" "$ROOT/export/j3f-symbol-states.json" "$OUT/export/"

# A raiz abre o protótipo com o painel de debug, como no uso local.
cat > "$OUT/vercel.json" <<'JSON'
{
  "redirects": [{ "source": "/", "destination": "/web/index.html?debug", "permanent": false }],
  "headers": [{ "source": "/export/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=3600" }] }]
}
JSON

cd "$OUT"
npx -y vercel@latest link --yes --project "$PROJECT" >/dev/null
if [[ "${1:-}" == "--preview" ]]; then
  npx -y vercel@latest deploy --yes
else
  npx -y vercel@latest deploy --prod --yes
fi
