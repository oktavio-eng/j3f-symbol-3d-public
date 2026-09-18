# Deploy do protótipo Three.js na Vercel

O protótipo de `web/` (Fases 1 e 2: as 14 lâminas convergindo com o scroll +
Circular Flow) está publicado na Vercel desde 2026-09-18.

| | |
|---|---|
| URL de produção | <https://j3f-simbolo-3d.vercel.app> |
| Sem painel de debug | <https://j3f-simbolo-3d.vercel.app/web/index.html> |
| Projeto Vercel | `j3f-simbolo-3d`, conta `oktavio-4322` |
| Tipo | site estático, sem build (o protótipo é zero-build: import map + three.js vendorizado) |

## O que é publicado

Só o que o protótipo carrega, na mesma estrutura de pastas do repositório, para
que os caminhos relativos de `web/src/j3f-config.js` (`../export/…`) funcionem
sem alteração:

```
web/                          # index.html, src/, vendor/three/
export/j3f-symbol.glb
export/j3f-symbol-states.json
vercel.json                   # gerado pelo script
```

Os `.blend`, os scripts do Blender, os previews PNG de `export/` e `assets-3d/`
**não** são publicados.

`vercel.json`:

- `/` redireciona (307) para `/web/index.html?debug`, a URL que era usada localmente.
- `export/*` com `Cache-Control: public, max-age=3600`.

## Como publicar de novo

```bash
scripts/deploy_vercel.sh            # produção
scripts/deploy_vercel.sh --preview  # preview
```

O script monta uma pasta temporária, liga-a ao projeto `j3f-simbolo-3d` e faz o
deploy pela CLI via `npx` (não precisa instalar a Vercel CLI). Requer Node.js e
login na Vercel (`npx vercel login`). O repositório não é alterado.

## Verificação feita no primeiro deploy

Deploy `j3f-simbolo-3d-nk2x6epd8-oktavio-4322s-projects.vercel.app`, alvo
production, status Ready. Respostas públicas:

| Caminho | Resposta |
|---|---|
| `/` | 307 → `/web/index.html?debug` |
| `/web/index.html` | 200 `text/html` |
| `/web/vendor/three/build/three.core.js` | 200 `application/javascript` |
| `/export/j3f-symbol.glb` | 200 `model/gltf-binary` |
| `/export/j3f-symbol-states.json` | 200 `application/json` |

A cena 3D não foi aberta num navegador depois do deploy; vale conferir o scroll e
o painel de debug.

## Atenção: o deploy é público

O repositório é **privado** porque contém o símbolo oficial da J3F (IP de marca).
O deploy de produção é **público**: qualquer pessoa com o link baixa o
`j3f-symbol.glb`. Se isso não for desejado, ative a proteção por senha ou por
login em *Project Settings → Deployment Protection* na Vercel, ou publique só como
preview.
