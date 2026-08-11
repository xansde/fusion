# Handoff — System Window no client (branch `feat/system-window-hub`)

> Sessão de 2026-08-08. Continuação de `docs/design/handoff-system-window.md`, que
> parou nas specs e no protótipo; **este** cobre o porte para o client Svelte.
> Leia antes de tocar em qualquer coisa da branch. Documento efêmero — apagar
> quando o trabalho for absorvido por um PR.

## Em uma frase

A moldura da System Window existe no client e roda; o **conteúdo** dos painéis
não existe, e é isso que falta.

---

## 1. Estado da branch

`feat/system-window-hub`, cinco commits sobre `build/app`:

| Commit    | Conteúdo                                                     |
| --------- | ------------------------------------------------------------ |
| `510f55a` | Moldura, barra de comando, atalhos, tokens de estilo         |
| `d50c854` | Notificação do Sistema (redutor de fila + pilha na tela)     |
| `21ffed6` | Lição: nenhum gate deste repo alcança `.svelte`              |
| `13a25d0` | Botões que disparam notificação (**andaime**, ver §4)        |
| `d804c54` | Correção: `crypto.randomUUID` quebra fora de contexto seguro |

**PRIMEIRO PASSO DA PRÓXIMA SESSÃO:** a branch está **15 commits atrás** de
`origin/build/app`. Mergeie antes de escrever qualquer linha e **rode os gates
depois do merge**. O que entrou lá enquanto isto era feito:

- **PR #89 foi mergeado** (2026-08-08 19:53 UTC). As specs **32 (minimapa
  tático)** e **34 (mapa de região)** agora existem em `specs/`, junto com
  `Note` com ownership próprio (REQ-DOC-056..060) e os overlays de cena
  (REQ-CNV-083..088). Isso **destrava** o painel de Mapa — ver §5.
- PR #92: os 4 systems entraram no workspace do vitest.
- **Zero PRs abertos** no repositório agora.

Nenhum PR foi aberto para esta branch. Tudo pushado em `xansde/fusion`.

---

## 2. Arquitetura — e por que ela é assim

A regra que organiza tudo: **o client roda Vitest com `environment: "node"` e
não monta componente**. Logo, lógica que merece teste mora em `lib/hub/*.ts`, e
os `.svelte` ficam finos. Não é preferência de estilo; é a única forma de o
código ter cobertura neste repo (ver §6 — os `.svelte` também não têm lint nem
format).

### Lógica testada — `packages/client/src/lib/hub/`

| Arquivo                 | Responsabilidade                                       | Testes |
| ----------------------- | ------------------------------------------------------ | ------ |
| `commandBar.ts`         | Catálogo de painéis + toda a decisão de teclado, pura  | 31     |
| `systemNotice.ts`       | Redutor da fila de notificações (puro, `now` injetado) | 24     |
| `noticeStore.svelte.ts` | Ponte reativa `$state` sobre o redutor — a fila viva   | 10     |
| `noticeDemo.ts`         | **Andaime** — roteiro de demonstração (ver §4)         | 8      |
| `domIds.ts`             | Ids únicos para `aria-labelledby`, sem `crypto`        | 5      |
| `layers.ts`             | (pré-existente) escala de camadas, REQ-UIF-008         | 11     |

**94 testes.** Os 24 do redutor de notificação foram verificados **por
mutação**: trocar o carimbo de expiração na promoção derruba 9 deles. Não é a
suíte circular da lição #48.

### Componentes — `packages/client/src/components/hub/`

- `SystemWindow.svelte` — a moldura: 4 cantos em L fora da caixa de borda,
  scanlines, título em caixa alta, 4 registros de cor (`system`/`rumour`/
  `good`/`bad`) por troca de duas variáveis locais.
- `CommandBar.svelte` — a barra fixa no rodapé. Componente **controlado**: o
  painel ativo vive no pai, para que outra coisa (macro, mudança de cena) possa
  dirigi-lo depois.
- `SystemHud.svelte` — compõe as duas, guarda o painel aberto, nasce fechado.
- `SystemNoticeStack.svelte` — a pilha de notificações no topo.

### Estilo — `packages/client/src/styles/system-window.css`

Só tokens `--fusion-sw-*`, importados por `main.ts` depois do `base.css`. O
chrome (cantos, scanlines) mora nos componentes, com escopo do Svelte.
`systemWindowStyles.test.ts` lê o arquivo e reprova: `var()` órfão, z-index
literal, e qualquer token que colida com um do shell.

### Onde está montado

`TableScreen.svelte`: `<HubLayer><SystemHud /></HubLayer>` e, **fora** do
HubLayer, `<SystemNoticeStack />`.

> **Não mova a pilha de notificações para dentro do HubLayer.** O host do Hub é
> `fixed` + `z-index`, logo abre um contexto de empilhamento; qualquer filho
> fica preso na banda do Hub, e notificação pertence a
> `--fusion-z-notification` (REQ-UIF-008), visível inclusive sobre um modal.

---

## 3. Decisões tomadas — não reabrir sem motivo

1. **A mesma tecla fecha o painel; `Escape` dispensa o Sistema.** Diverge do
   protótipo, onde sempre há um painel aberto porque a página _é_ o Hub. Aqui
   ele flutua sobre o canvas.
2. **`contenteditable` bloqueia atalho.** O protótipo só protegia
   `INPUT`/`TEXTAREA`; este client tem TipTap no chat e no diário. Sem isso,
   digitar "quero" no chat escancara a janela de missões na primeira letra.
   `Escape` **atravessa** o alvo digitável de propósito.
3. **Ctrl/Cmd/Alt nunca disparam atalho; Shift dispara.** `Q` é como se digita
   `q` com caps lock — rejeitar Shift faria o atalho falhar de forma
   intermitente.
4. **Fila de notificação com teto 3 e espera**, nunca descarte. Revelação que
   ninguém viu revelada vira "mas eu revelei isso".
5. **O relógio da notificação começa quando ela fica VISÍVEL**, não quando entra
   na fila. É a regra que o teste de mutação protege.
6. **A barra de vida é decorativa.** Quem decide o vencimento é o redutor, não o
   fim da animação — senão uma aba em segundo plano, com timers estrangulados,
   deixaria a notificação para sempre na tela.
7. **Paleta em namespace próprio (`--fusion-sw-*`).** Redefinir um token do
   shell repintaria o aplicativo inteiro assim que o `main.ts` importasse o
   arquivo.
8. **Nada de `crypto.randomUUID()`** — ver §6.

---

## 4. O andaime, e como removê-lo

Nada no client chama `notify()` ainda. Para a pilha não ser invisível na
revisão, existem hoje:

- Quatro botões no rodapé do painel aberto (`SystemHud.svelte`, bloco `.demo`),
  um por registro de cor;
- `?hud-demo=1`, que toca a mesma sequência ao abrir a mesa e deixa
  `window.fusionHudDemo()` para repetir.

**Ambos são temporários.** Quando existir emissor de verdade, apagar:
`lib/hub/noticeDemo.ts`, `lib/hub/__tests__/noticeDemo.test.ts`, o bloco
`.demo` do `SystemHud.svelte` (marcação + CSS) e o `$effect` de demonstração no
`SystemNoticeStack.svelte`. Todos estão marcados com `SCAFFOLDING` no código.

---

## 5. O que falta — a lista

Em ordem de dependência, não de tamanho.

### 5.1. Painel de Mapa — **destravado agora**

A spec **34-mapa-de-regiao.md** entrou na `build/app` com o PR #89, e o
protótipo `docs/design/prototipo-log-missoes.html` já tem a câmera funcionando
com as quatro regras do `mapa-isekai.md` §5.1 implementadas e testadas em
jsdom. É o painel com o caminho mais curto entre spec e tela:

- duas camadas (`world` com transform da câmera; `nodes` **sem** transform — o
  pino mantém o tamanho em pixels, só a posição é recalculada);
- LOD de rótulo (assentamento sempre · demais ≥ 1,3× · categoria ≥ 2,2×);
- zoom de roda ancorado no cursor, pan travado nas bordas;
- Console de Revelação no próprio pino, com `todos ▸` que nunca rebaixa quem já
  viu.

Atenção: o protótipo é **SVG**, o canvas do Fusion é **PIXI**. Duas das três
armadilhas de SVG do `mapa-isekai.md` §5.2 não transferem; a terceira (parser
de path cobrindo `Q`/`T`/`A`) só importa ao importar geografia do Azgaar.

### 5.2. Painéis de Missões e Comitiva — **bloqueados**

Dependem da **spec 28 (Hub do jogador)**, que **ainda não existe em `specs/`** —
está sendo escrita pelo Mario. A issue **#90** carrega o protótipo como insumo e
as 5 perguntas que a spec precisa responder. Não invente o modelo de dados de
missão antes dela; o relógio de missão talvez pertença à spec 33 (Motor de
Campanha), não à 28.

O que o protótipo define para Comitiva, quando destravar: HP + Pontos de Foco
(pips 0–3) + condições PF2e por membro, expansível.

### 5.3. Emissores reais de notificação

Substituir o andaime. Candidatos naturais: local revelado (spec 34), missão
avançada (spec 28), condição aplicada (combate). **Cada emissor tem que passar
pela redação de visibilidade do servidor** — `packages/server/src/net/redaction.ts`

- `isRolePrivileged`, nunca um canal paralelo. Notificação que conta ao jogador
  algo que ele não deveria saber é vazamento, não recurso.

### 5.4. Acabamentos conhecidos

- **Ícones da barra.** O protótipo usa sprite SVG (`#ic-scroll`, `#ui-user`,
  `#ic-pin`); portei sem ícone, só rótulo + `kbd`.
- **Badge com número real.** `CommandBar` já aceita a prop `badges`; ninguém a
  alimenta. No protótipo é a contagem de missões ativas, sensível ao papel.
- **Toggle de papel (Mestre/jogador)** do protótipo — no client isso é o
  ownership de verdade, não um botão.
- **Persistir o painel aberto** entre recargas.
- **Atalho de teclado para zoom** (`+`/`-`/`0`): deliberadamente ausente no
  protótipo, para manter a barra `Q`/`C`/`M` limpa. Decidir ao fazer o mapa.

---

## 6. Armadilhas — todas custaram tempo nesta sessão

1. **Rebuild do client com o servidor no ar = tela preta.** O servidor entrega o
   `index.html` que leu no boot; o Vite troca os hashes. `GET /` responde 200, o
   `<script>` seguinte 404, nada monta. **Reinicie o servidor após rebuildar.**
   Registrado em `docs/lessons.md`.
2. **Ao reiniciar, mate o processo antigo de verdade.** O mundo tem lock por
   PID: o novo morre com `WorldLockedError: World "isekai" is already in use by
process <pid>`.
3. **`crypto.randomUUID()` é secure-context only.** Funciona em `localhost`,
   é `undefined` em `http://192.168.x.x` — ou seja, quebra para todo jogador
   menos o GM. Use `lib/hub/domIds.ts`. Há um teste que remove
   `globalThis.crypto` para impedir a volta.
4. **Nenhum gate deste repo alcança `.svelte`.** ESLint ignora `**/*.svelte`;
   `format:check` só varre `{ts,tsx,json,md}` e o Prettier daqui não tem o
   plugin de Svelte. O único gate que os enxerga é `svelte-check` — e ele checa
   tipo e a11y, não estilo. Rode-o **de dentro de `packages/client`**: da raiz
   do workspace ele acusa erros espúrios de resolução.
5. **Antes do primeiro `svelte-check`, rode `pnpm build`.** Sem o `dist` do
   `@fusion/shared`, aparecem ~300 erros de "Cannot find module".
6. **`pregen-parity.test.ts` falha em worktree nova** — lê
   `tools/importer-pf2e/vendor/`, que é gitignored e só existe na árvore
   principal. Não é regressão.
7. **Os `node_modules` da worktree sumiram no meio da sessão** (os symlinks,
   não o `.pnpm`), e `pnpm install` insistia em "Already up to date". Remédio:
   apagar `node_modules/.modules.yaml` + `.pnpm-workspace-state-v1.json`, apagar
   os `node_modules` e reinstalar. Se repetir em `Temp`, suspeite de limpeza de
   disco do Windows sobre o scratchpad.

---

## 7. Como rodar e ver

```
# na raiz da worktree
pnpm --filter @fusion/client build
node packages/server/dist/index.js serve --world isekai --port 33000 \
  --data-dir "C:\Users\xansd\.fusion" --no-open
```

Local: `http://localhost:33000` · LAN: `http://192.168.77.110:33000`
(também Hamachi `25.56.147.103` e ZeroTier `10.241.183.140`).

Mundo `isekai`, usuários **Xande**/Igor/Mayk/Narrador sem senha, Gamemaster com.
Entre na mesa → barra no rodapé (`Q`/`C`/`M`) → dentro do painel, atrás da régua
tracejada, os botões de notificação.

Diagnóstico de tela preta em dez segundos:

```
curl -s http://<host>:33000/ | grep -o 'assets-client/index-[^"]*\.js'
ls packages/client/dist/assets-client/ | grep -E '^index-.*\.js$'
```

Nomes diferentes = servidor obsoleto, reinicie.

### Gates

```
pnpm build                                    # shared antes de tudo
pnpm --filter @fusion/client test             # 2662 verdes; 1 vermelho conhecido (§6.6)
cd packages/client && npx svelte-check --tsconfig tsconfig.json   # de DENTRO do pacote
npx eslint packages/client/src/lib/hub        # .ts apenas — .svelte é ignorado
npx prettier --check "packages/client/src/lib/hub/**/*.ts"
```
