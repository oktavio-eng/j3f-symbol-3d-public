# Site J3F no Framer

Implementação do site institucional da J3F no Framer, a partir do Figma.
Trabalho feito em 2026-09-18. **Nada foi publicado:** o site existe só no canvas
do Framer.

| | |
|---|---|
| Projeto Framer | <https://framer.com/projects/J3F--nJk09Eu9ebzz4eJYqjUM> (id `nJk09Eu9ebzz4eJYqjUM`) |
| Figma | arquivo `h4FEJG3mcK6sWf2pZbmwug` |
| Home (fonte da verdade) | nó `684:485 — New Home` (frame de 1920 px, só desktop) |
| Teste de elegibilidade | nó `758:780` |
| Calculadora PIS/COFINS | nó `758:1526` |
| Simulador CBS/IBS | nó `758:1812` |
| Vitrine "Quatro frentes de IA" | componente `758:373` (4 variantes) |
| Conteúdo e lógica das ferramentas | HTML do cliente — resumo mantido no repositório privado |

Regra que guiou tudo: **o visual vem do Figma; do HTML do cliente só conteúdo e
lógica.**

---

## 1. Princípios da implementação

O Figma da home foi desenhado **só em desktop, a 1920 px**. Não existem versões
tablet e mobile desenhadas. Os outros frames do arquivo (modal de elegibilidade,
calculadoras) **não são breakpoints** da home.

- **1920 px é a expressão máxima do design.** Larguras do Figma viraram
  `maxWidth`, não largura fixa (ex.: conteúdo de 1504 px → `width: 100%` +
  `maxWidth: 1504px`). Seções: largura 100%, `maxWidth 1888px`, com o padding
  de 16 px da página.
- **Fluido primeiro.** Pilhas, grids, frações (`fr`) e `aspectRatio`. Breakpoint
  só onde a composição quebra de verdade.
- **Nativo e editável.** Tudo é camada nativa do Framer, exceto o que exige
  lógica (cálculo, fluxo de etapas): esses viraram componentes de código.
- **Texto exato do Figma**, inclusive o que parece erro (ver §9).
- Skills de referência para as decisões responsivas: `marketing-pages`,
  `design-foundations` e `typography` (linha Emil Kowalski, em `~/.agents/skills`).

### Limitação do Framer que moldou o responsivo

A camada de edição do Framer **não aceita `clamp()`, `min()` nem `max()`** em
tamanhos, paddings ou gaps. Larguras são fluidas de verdade; **tipografia e
espaçamento mudam em degraus**, nos breakpoints (os estilos de texto têm um
tamanho por breakpoint).

---

## 2. Breakpoints

| Breakpoint | Faixa | Motivo |
|---|---|---|
| Desktop | ≥ 1200 px | Onde a navegação completa e as 3 colunas de "Nossas soluções" cabem |
| Tablet | 810–1199 px | Navegação vira menu; colunas empilham |
| Phone | < 810 px | Uma coluna; botões ocupam a largura |

Chegou-se a testar o Desktop a partir de 1280 px. Foi revertido: com barra de
rolagem, um notebook de 1280 px tem ~1265 px úteis e cairia no layout de Tablet.
Para ganhar espaço a 1200 px, a seção de soluções usa padding lateral de 24 px
(a 1920 nada muda, porque o conteúdo é limitado a 1504 px).

O hero, a seção "IA aplicada" e a vitrine de serviços mantêm a **proporção do
Figma** no Desktop (ex.: hero 1888:1440). Assim o recorte da imagem e a posição
do texto batem com o Figma em qualquer largura. Em Tablet e Phone a altura passa
a seguir o conteúdo, com altura mínima.

Conferido em 1920, ~1216, 810 e 390 px. A 1920 a página tem 14.146 px de altura
(Figma: 14.191 px).

---

## 3. Estrutura da home

Ordem das seções (nomes das camadas no Framer):

1. **Hero Section** — navegação, imagem CGI escurecida 50%, curva bege
   (`#EEE7D7`) na base, título `h1` em três linhas, dois CTAs.
2. **Section — Pergunta** — "Sua empresa paga o imposto certo?" + render do cubo.
3. **Section — Enquanto você lê** — o número "R$ 594.880.000" (estático, ver §8).
4. **Section — Nossas soluções** (`#solucoes`) — 3 cards numerados + 2 cards de
   gestão do passivo, em grids (altura igual por linha).
5. **Section — IA aplicada**.
6. **Section — Ecossistema de IA** (`#ecossistema`) — vitrine com 4 abas; aba
   SPED ativa (ver §8).
7. **Section — Método** (`#metodo`) — coluna esquerda fixa com rolagem
   (`sticky`, 40 px do topo) + 3 passos.
8. **Section — Autoavaliação (CTA)** — curva clara + recorte da especialista.
9. **Section — Setores** — Saúde em destaque + 3 imagens.
10. **Section — Maturidade fiscal** — 6 estágios; coluna esquerda `sticky`.
11. **Section — Solicitar diagnóstico** (`#diagnostico`) — funil de 3 etapas
    (componente de código) + card "Ou traga o cenário direto para uma conversa".
12. **Section — Dúvidas** (`#duvidas`) — 4 itens de FAQ.
13. **Section — Somos J3F** — texto institucional + "12+" e "25+".
14. **Section — Radar da reforma** — newsletter (formulário nativo do Framer).
15. **Footer — Contato** — navegação, contato, newsletter, selo "Aniversário 12 Anos".

Âncoras de rolagem (`elementId`): `metodo`, `solucoes`, `diagnostico`,
`ecossistema`, `duvidas`.

### Adaptações por breakpoint que merecem nota

- **Soluções:** grid de 3 e de 2 colunas no Desktop; lista vertical no Tablet e
  no Phone.
- **Setores:** Tablet em grid de 3 colunas com Saúde ocupando a linha toda (evita
  uma imagem sozinha na última linha); Phone empilhado.
- **Método:** no Phone o número de cada passo vai para cima do texto.
- **Vitrine de serviços:** abas em grid 2×2 no Tablet e no Phone; no Phone as
  miniaturas somem.
- **Rodapé:** colunas proporcionais (marca `1fr` até 317 px; colunas `3.4fr`;
  newsletter `1.35fr`) — a 1200 px as larguras fixas do Figma se sobrepunham.

---

## 4. Sistema visual

### Cores (estilos de cor)

| Estilo | Valor | Origem |
|---|---|---|
| `Bege/200` | `#FCFAF7` | variável do Figma (fundo da página) |
| `Bege/300` | `#EEE7D7` | cor da curva do hero e do FAQ |
| `Azul/900` | `#003239` | variável do Figma |
| `Cor/Azul` | `#00B1CC` | variável do Figma (ciano) |
| `Cor/Azul Escuro` | `#005564` | variável do Figma |
| `Cor/Marrom` | `#A1937D` | variável do Figma |
| `Cor/Branco` / `Cor/Preto` | `#FFFFFF` / `#000000` | variáveis do Figma |
| `Cinza/600` | `#677176` | texto secundário do Figma |

Outras cores do Figma usadas diretamente: teal `#005263`, `#96C9D7`, `#F0F5F6`,
`#03252E`.

### Estilos de texto (Manrope)

Títulos com tracking de −4% (`-0.04em`). Tamanhos Desktop → Tablet → Phone:

| Estilo | Tamanhos | Uso |
|---|---|---|
| `Heading/56` (h1) | 56 → 46 → 36 | título do hero |
| `Heading/48` (h2) | 48 → 38 → 32 | títulos de seção |
| `Heading/44` | 44 → 38 → 30 | FAQ |
| `Heading/40` | 40 → 34 → 28 | IA aplicada, vitrine, maturidade, diagnóstico, Radar |
| `Heading/32` (h3) | 32 → 28 → 26 | títulos de card |
| `Heading/24` (h3) | 24 → 22 → 20 | estágios, perguntas |
| `Display/80`, `Display/86`, `Stat/50` | números grandes (Light, dígitos de largura fixa) | |
| `Text/24`, `Text/20`, `Text/18` (+ Medium, SemiBold, Bold, Caps), `Text/16` (Regular, Medium), `Text/14` (Regular, Medium), `Label/12` | corpo e rótulos | |
| `Tool/*` (Eyebrow, Title, Lead, Heading, Sub, Label, Small) | páginas das ferramentas | |

### Componentes nativos

| Componente | Variantes | Controles |
|---|---|---|
| **Button** | Primary (ciano), Secondary (branco), Outline (borda) + hover | Title, Link |
| **Navigation** | Desktop, Mobile, Mobile Open (menu abre e fecha no clique) | — |
| **FAQ/Item** | Open, Closed (alterna no clique) | Question, Answer |
| **Button/Submit** | Default + hover | Title (usado nos formulários de newsletter) |

### Imagens

Enviadas ao Framer a partir dos assets do Figma. Três foram preparadas antes do upload:

- **Logo J3F:** os três grupos vetoriais do Figma combinados num único SVG.
- **Cubo** (seção 2): espelhado horizontalmente (transform do Figma) e esticado
  para 609×460, que é como o Figma o exibe (preenchimento esticado).
- **Medalha "12 Anos":** PNG + marca J3F sobreposta, combinados num SVG.

As curvas (hero e CTA) são o SVG exato do Figma, usado como preenchimento de um
frame com a mesma proporção (5,3943:1).

---

## 5. Páginas das ferramentas

No Figma os três frames se chamam "Modal". Foram implementados como **páginas
próprias**, para poderem ser linkadas de qualquer lugar e o botão Voltar do
navegador funcionar. Trocar por sobreposições em cima da home é possível, se
preferido.

| Página | Figma | Conteúdo |
|---|---|---|
| `/teste-de-elegibilidade` | `758:780` | Fundo bege; componente `TesteElegibilidade` |
| `/ferramentas/calculadora-pis-cofins` | `758:1526` | Fundo teal; componente `CalculadoraPisCofins` |
| `/ferramentas/simulador-cbs-ibs` | `758:1812` | Fundo teal; componente `SimuladorCbsIbs` + seção nativa "Quatro mudanças…" |

Cabeçalhos ("Comece aqui · 40 segundos", "Ferramentas J3F", títulos e textos de
apoio) são camadas nativas. "Ferramentas J3F" linka para a home.

### Links para as ferramentas

- **Teste:** "Receber Direcionamento" (hero), "Avalie sua maturidade fiscal",
  "Comece pela autoavaliação", "Avalie seu momento".
- **Calculadora:** "Calcular agora, é gratuito", "Ferramentas" (navegação) e
  "Calculadora" (rodapé).
- **Seções da home:** "Conheça a inteligência J3F" → `#metodo`; "Falar com um
  especialista" → `#diagnostico`; "Entenda como a IA participa" → `#ecossistema`.

---

## 6. Componentes de código

Código versionado no repositório privado (`framer/code-components/`).
**A cópia viva é a do Framer**; ao editar lá, atualize esta pasta (e vice-versa).

| Arquivo | Onde está | O que faz |
|---|---|---|
| `TesteElegibilidade.tsx` | `/teste-de-elegibilidade` | 4 perguntas → trilha por regra de prioridade |
| `CalculadoraPisCofins.tsx` | `/ferramentas/calculadora-pis-cofins` | Faixa de crédito recuperável em 5 anos |
| `SimuladorCbsIbs.tsx` | `/ferramentas/simulador-cbs-ibs` | Efeito de caixa e de carga na transição |
| `FunilDiagnostico.tsx` | home, seção "Solicitar diagnóstico" | Funil de 3 etapas |

Todos seguem o visual dos frames do Figma e usam **a lógica transcrita
literalmente do HTML do cliente** (fórmulas, constantes, textos, máscaras de
telefone e CNPJ, validações, bloqueio de e-mail pessoal). Detalhes em
no repositório privado.

### Lógica

A lógica de negócio (fórmulas, fatores, regras de roteamento e textos) é do
cliente e fica **apenas no repositório privado**.

### Cadastro (lead) e integração

Os três fluxos das ferramentas liberam o detalhamento só depois do cadastro. O
teste e o funil também pedem contato.

Cada componente tem um controle **"Webhook (CRM)"** no painel do Framer. Se
preenchido, envia um `POST` com JSON para a URL; **vazio, não envia nada** e o
fluxo segue como no protótipo do cliente (que também só fazia `console.log`).
Payloads:

- `ferramenta: "teste-elegibilidade"` — nome, empresa, e-mail, as 4 respostas, trilha.
- `ferramenta: "calculadora-pis-cofins"` — contato, faturamento, setor, regime, estimativa mín./máx.
- `ferramenta: "simulador-cbs-ibs"` — contato + CNPJ, perfil, setor, entradas, carga e caixa.
- `ferramenta: "funil-tax-scan-360"` — faturamento, necessidade, contato.

A calculadora e o simulador também têm o controle "Política de Privacidade" (link
do consentimento LGPD).

### Modo administrador

Com `adm-j3f` na URL (ex.: `…/calculadora-pis-cofins#adm-j3f`), como no protótipo
do cliente, aparecem as premissas editáveis (faixa da calculadora; alíquotas e
percentuais do simulador), a lista de premissas e o aviso legal.

---

## 7. Diferenças deliberadas em relação ao Figma

- Páginas em vez de modais (§5).
- Estados que o Figma não desenha (resultado do teste, valores preenchidos,
  detalhamento aberto, erros, sucesso) foram montados na mesma linguagem visual
  dos frames.
- No funil nenhuma opção começa marcada (o Figma mostra a primeira como exemplo).
- Colunas `sticky` do Método, da Maturidade e do FAQ ficam a 40 px do topo (no
  Figma, 0).
- Título do FAQ com quebra balanceada em vez da quebra forçada (no Phone ela
  deixava "de" sozinho numa linha).
- Detalhes mínimos: traços da lista do diagnóstico em peso regular (Figma:
  extra-bold); alguns textos de 15 px viraram 16 px.

---

## 8. Pendências

**Conteúdo e integrações (dependem do cliente):**

- [ ] **Endpoint do CRM** para os 4 componentes de código.
- [ ] **Links provisórios do HTML:** WhatsApp (`wa.me/5511999999999`), Google
      Meet, `contato@j3f.com.br`, página de Política de Privacidade. Os botões de
      WhatsApp e Meet estão **sem link** de propósito.
- [ ] **Resposta de preço do FAQ** ("Quanto custa o Tax Scan 360?") — o próprio
      cliente marcou como condição a confirmar.
- [ ] **CNPJ no rodapé:** está o placeholder literal do Figma, `{{cnpj}}`.
- [ ] **Contador "R$ 594.880.000":** pedido um contador em tempo real ligado à API
      do Impostômetro (ACSP/SP). O HTML não tem API nem lógica para isso; falta a
      fonte dos dados. Números grandes ganharão animação de contagem na entrada.
- [ ] **Vitrine das 4 frentes:** nas variantes do componente `758:373`, título e
      descrição são iguais (placeholder). Quando houver texto por aba, virar
      componente com troca de aba no clique.
- [ ] **FAQ e Setores:** interações futuras (Setores expande no hover).
- [ ] Menu "Ferramentas" com submenu, "Publicações" e páginas internas não existem.

**Para confirmar com o designer:**

- Texto branco sobre o ciano dos botões: contraste ~2,5:1 (mínimo de
  acessibilidade: 4,5:1). Mantidas as cores do Figma.
- "Publicacões" (grafia do Figma), os dois cards com "GESTÃO DO PASSIVO" e o botão
  "Explore SPED Analyzer" na seção Método.

**Técnico:**

- [ ] Percorrer os 4 fluxos no Preview do Framer (a verificação feita foi só de
      render no canvas).
- [ ] Metadados do site (título e descrição) não definidos.
- [ ] Publicar — nunca foi feito; só quando pedido.

---

## 9. Como continuar trabalhando no Framer

A edição foi feita pela CLI `@framer/agent` (Node 24+):

```bash
npx @framer/agent@latest setup                       # uma vez
npx @framer/agent@latest session new "https://framer.com/projects/J3F--nJk09Eu9ebzz4eJYqjUM"
npx @framer/agent@latest exec -s <id> <<'EOF'
console.log(await framer.getProjectInfo())
EOF
```

O Figma foi lido pelo MCP oficial (`https://mcp.figma.com/mcp`, registrado como
`figma-desktop` na configuração local deste projeto no Claude Code).
