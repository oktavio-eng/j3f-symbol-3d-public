# J3F sizing refactor — working log

## Arquitetura original do J3F

- O site publicado é um projeto Framer. A home usa frames, stacks, variants e text styles nativos; os breakpoints efetivos são Desktop `>= 1200px`, Tablet `810–1199.98px` e Phone `<= 809.98px`.
- O layout nativo foi desenhado em pixels. No archive analisado há aproximadamente 1.194 ocorrências de `px`, uma de `rem`, 129 de `em`, 42 de `vw` e cinco de `vh`/`dvh`.
- A largura de origem do design é 1920px. A home usa um canvas desktop de 1200px no editor, mas os containers publicados chegam a `1888px`, coerentes com uma viewport de 1920px e margem externa de 12px/16px.
- A hero é nativa do Framer: `1440px` de altura, `32px` de raio, `40px 32px 204px` de padding, conteúdo de até `699px` e imagem de fundo em `cover`. O elemento visual é uma imagem CGI, não um canvas/WebGL no site atual.
- Navigation, Button, Submit e FAQ são componentes Framer reutilizáveis. A navegação desktop mede `56px` de altura; o logo mede `116px × 56px`; botões usam `16px 24px` e gap de `8px`.
- A home contém um único code component, `FunilDiagnostico.tsx`. As três páginas de ferramentas usam outros code components, mas não fazem parte da composição visual alvo desta primeira rodada.
- O Framer não oferece `calc()`/`rem` nos campos de frame/stacks do canvas. `rootFontSize` de breakpoint aceita somente um número em px. Portanto, a camada fonte viável é um code component pequeno e versionável que injeta CSS determinístico, usando atributos semânticos `data-framer-name` e `data-styles-preset`, sem depender de classes hash.

## Arquitetura da Motto

- O archive real define `:root { --size: 390; }`, troca para `--size: 1500` em `@media (min-width: 650px)` e usa `html { font-size: calc(10 * 100vw / var(--size)); }`.
- Layout, tipografia, larguras, alturas, paddings, gaps e raios são majoritariamente expressos em `rem` (aproximadamente 1.257 ocorrências no CSS principal).
- `px` permanece principalmente em breakpoints, hairlines/bordas, sombras, pills de `9999px` e detalhes independentes da escala.
- O sistema é mobile-first com referência de 390px e desktop a partir de 650px com referência de 1500px; breakpoints adicionais refinam composição em 375, 415, 768/769, 1024, 1280 e 1536px.

## Estratégia para o J3F

- Adicionar uma única fonte de verdade, `DesktopSizingSystem.tsx`, renderizando um `<style>` estável e SSR-safe na home.
- Manter `html { font-size: 10px; }` em Tablet e Phone para que `1.6rem` continue equivalendo a 16px nesses breakpoints.
- Em Desktop, usar `font-size: calc(10 * 100vw / 1920)`. A viewport de 1536px passa a ter root de 8px, reproduzindo a composição antiga a 80% sem `transform`, `zoom` ou JavaScript de detecção.
- Converter semanticamente os valores desktop da home: text styles, container widths, alturas, paddings, gaps, offsets, raios, navegação, botões, cards, grids e ícones de layout.
- Preservar um piso tipográfico equivalente a 80% dos tokens desktop do Figma. Abaixo de 1536px o layout continua fluido em rem, mas o texto não encolhe além da escala do golden target; acima disso, a tipografia volta a acompanhar o root proporcional.
- Usar `text-wrap: balance` apenas em leads e descrições curtas, mantendo parágrafos longos com fluxo natural.
- Manter em px: media queries, bordas/hairlines de 1px/1.5px/2px quando funcionam como traço, dimensões intrínsecas de assets, e qualquer resolução interna de mídia.
- Converter o sizing inline do `FunilDiagnostico` para rem, preservando comportamento e conteúdo. Como Tablet/Phone usam root 10px, o componente continua visualmente equivalente nesses breakpoints.

## Arquivos e componentes previstos

- Novo `framer/code-components/DesktopSizingSystem.tsx` e sua cópia sincronizada no projeto Framer.
- `framer/code-components/FunilDiagnostico.tsx`, somente para sizing semântico.
- Home Framer: uma instância absoluta de `DesktopSizingSystem`, sem alterar ordem, copy ou funcionalidade.
- Este log e a documentação final de validação.

## Riscos e mitigação

- **CSS gerado pelo Framer:** seletores usam nomes e IDs semânticos do canvas, não hashes minificados.
- **Hydration:** o CSS é uma constante; não lê viewport ou browser no render.
- **Breakpoints:** as regras fluidas ficam restritas a `min-width: 1200px`; Tablet e Phone conservam escala 10px/rem.
- **Browser zoom:** a compensação é intencional dentro do breakpoint desktop; cruzar 1200px ativa o layout Tablet do próprio Framer.
- **Acessibilidade:** browser zoom continua habilitado e não há meta viewport restritiva. A compensação atua somente enquanto o layout permanece no breakpoint Desktop; ao cruzar para Tablet, o root retorna a 10px e o zoom volta a ampliar o conteúdo. Reduced motion é preservado.
- **Framing da hero:** primeiro será validado somente pelo redimensionamento coordenado do container. A imagem/arte não será modificada.
- **Outras páginas:** a folha é montada apenas na home nesta rodada, evitando mudar ferramentas antes de converter seus code components.

## Validação executada

- O frame Figma `684:485` confirmou a referência desktop de 1920px e os tokens principais: 56px para H1, 48px para heading de seção, 32px para títulos de cards, 20px para leads, 18px para body e 16px para navegação/botões.
- Em 1536px, o root calculado é 8px; hero, navigation, heading, body e CTAs coincidem visualmente com o screenshot antigo a 80%.
- Medidas computadas: root `6.6667 / 7.5 / 8 / 10px` em `1280 / 1440 / 1536 / 1920px`; hero `960 / 1080 / 1152 / 1440px`; raio `21.33 / 24 / 25.6 / 32px`.
- A tipografia mantém piso de 80% do Figma entre 1200 e 1536px: H1 `44.8px`, heading de seção `38.4px`, títulos de cards `25.6px`, body de cards `14.4px`. Em 1920px retorna aos valores integrais do Figma.
- Não houve overflow horizontal nas quatro viewports (`scrollWidth === innerWidth`).
- Tablet 1199px e Mobile 390px ficaram pixel-idênticos ao archive anterior nos screenshots comparativos.
- Nos testes equivalentes a zoom 80%, 100% e 125%, o layout permanece estável. Em 125%, o piso tipográfico permite que o texto aumente, preservando uma resposta acessível ao zoom.
- Os dois code components passaram no typecheck do Framer. O preview reportou zero erros e zero warnings.
- O único erro de console observado no archive local (`ServiceMap requested but not available`) já existe no baseline salvo do Framer e não foi introduzido pela refatoração.
- O projeto não oferece o recurso Framer Branching. Com autorização do usuário, a implementação ficou no `main` e foi publicada na versão Framer `6ae415a41` após a validação final.
