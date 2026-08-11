# Validar — wi-mapa-som-01

**Item:** Upload aceita mp3 e ogg, com teto de tamanho por tipo
**Branch:** `feat/wi-mapa-som-01` (base: `main` / `b337755`)
**Commit examinado:** `e857e13` — 11 arquivos, +922/−35
**Risco classificado:** **sensível** (mexe no portão de upload: allowlist de tipos por magic bytes e teto de tamanho)
**Data:** 2026-08-07

---

## 1. O que foi rodado (e o que deu)

| Verificação | Comando | Resultado |
|---|---|---|
| Suíte completa | `pnpm test` | **4120 passaram**, 0 falharam, 1 pulada, 186 arquivos, 257 s — exit 1 pelo `Timeout calling "onTaskUpdate"` (§2) |
| Testes de asset, servidor | `npx vitest run assets-audio + magic-bytes + upload-limits + assets` | **60 passaram**, exit **0** |
| Testes de asset, cliente | `npx vitest run src/lib/assets` | **85 passaram**, exit **0** |
| Tipos | `pnpm typecheck` | **0 erros** (1447 arquivos, 50 warnings de a11y/`state_referenced_locally`, todos pré-existentes e fora do diff) |
| Lint | `pnpm lint` | **limpo** — o erro de `planVM.ts:2779` que estava vermelho no M2 já não aparece nesta base |
| Mutação A — desligar o cap por tipo (`if (false && buf.length > cap)`) | manual | **2 vermelhos**: `rejects an image above the image cap` e `rejects audio above the audio cap, naming the kind`. Confere com o declarado pela fase Implementar. |
| Mutação B — remover `isOgg`/`isMp3` de `detectType` | manual | **8 vermelhos** (3 em `magic-bytes.test.ts`, 5 em `assets-audio.test.ts`) |

Ambas as mutações foram revertidas; `git status` mostra a árvore idêntica ao commit
(só `.esteira/` untracked, como já era).

## 2. O exit 1 que NÃO é regressão

`pnpm test` termina com exit 1 e um `Unhandled Error: [vitest-worker]: Timeout
calling "onTaskUpdate"` — **sem nenhum teste falhando** (`Test Files 186 passed`,
`Tests 4120 passed | 1 skipped`). É a flakiness de infra já documentada no
`CLAUDE.md` do repo, e a fase Implementar já a tinha medido dos dois lados
(branch e `main`, resultado idêntico). Os arquivos deste item rodam com exit 0
quando executados isolados — feito acima.

## 3. Achado do review — alargar a allowlist alargou três pickers que só querem imagem

**Severidade:** médio. Não é falha de segurança e não é o escopo declarado do
item; é um estado quebrado, persistido, que **passou a ser alcançável em um
gesto** por causa desta mudança.

O `FilePicker` é o portão único de três consumidores, todos exclusivamente de
imagem e nenhum deles passando `kinds`:

- `SceneCreateDialog.svelte:268` → `formData.background`
- `TokenAddDialog.svelte:346` → textura do token
- `CharacterSheet.svelte:1190` → retrato

A prop `kinds` nova deriva **só o `accept` do diálogo do sistema** — e o `accept`
é a única das três entradas que o navegador filtra. As duas que realmente
entregam arquivo continuam globais:

1. **A grade.** `assetStore.filtered` (`assetStore.svelte.ts:160`) filtra apenas
   por texto de busca. Um `.mp3` na biblioteca aparece como card (com o ícone ♫,
   que já existia) em **todo** picker, e `handleSelectAsset` devolve
   `assetUrl(name)` sem olhar o tipo.
2. **O arraste.** `handleDrop` ignora `kinds` — está no docblock do componente,
   de propósito — e, com um único arquivo, o `onDone` auto-seleciona o que
   acabou de subir. Soltar um `.mp3` sobre o picker aberto pelo
   `SceneCreateDialog` grava `scene.background = "/assets/….mp3"`.

`validateSceneForm` (`sceneController.ts:81-84`) só cobra tamanho da string:
não há checagem de extensão em nenhum ponto do caminho. O resultado é uma cena
com fundo que o `Assets.load()` do PIXI não consegue carregar.

**Por que não pega no review do diff:** o docblock do `FilePicker` justifica o
arraste global dizendo que "a validação é feita pelo clientValidation (e, de
verdade, pelo servidor)". Isso responde *"este arquivo é permitido em algum
lugar?"*, não *"este arquivo é do tipo certo AQUI?"*. A segunda pergunta era
verdadeira por acidente enquanto não existia asset não-imagem no mundo.

**Conserto sugerido (item novo, não emenda desta fase):** `kinds` precisa
alcançar as três entradas, não uma — filtrar `assetStore.filtered` por
`kinds` na grade e recusar em `handleDrop`/`handleFileInput` o arquivo cuja
extensão não caia num dos `kinds`. Cabe naturalmente no item irmão do M3 que já
vai mexer no `FilePicker` (o "excluir na UI"). Enquanto não for feito, vale
passar `kinds={["audio"]}` no picker do player de som, para pelo menos o novo
consumidor nascer estreito.

## 4. O que o review NÃO achou de errado

Conferi lendo o código, não só o diff:

- **`isMp3` não colide com JPEG.** O frame sync exige `b1 & 0xE0 === 0xE0`, e o
  JPEG traz `FF D8`, com `0xD8 & 0xE0 = 0xC0`. Além disso `isJpeg` é avaliado
  antes. O sync é uma assinatura **larga** (qualquer binário que comece com
  `FF Ex/Fx` vira `.mp3`), mas o serving já manda
  `X-Content-Type-Options: nosniff` (`routes.ts:561`), então não há caminho de
  sniffing para HTML — o custo é um arquivo inútil no disco, não um vetor.
- **`isOgg`** ancora nos 4 bytes `OggS`; não conflita com nada da allowlist.
- **WAV continua rejeitado** e há teste provando (`415 UNSUPPORTED_MEDIA_TYPE`),
  junto com um teste que prova que o WebP não regrediu no mesmo prefixo `RIFF`.
- **A ordem das checagens no `routes.ts` está certa**: teto global no buffer →
  `detectType` → `kindOfMime` → cap por tipo → sanitização de SVG. Um mime fora
  do allowlist não herda cap de ninguém (`kindOfMime` devolve `null` → 415).
- **`effectiveCapForKind` combina por `min`**, então o override de 1 MB do
  `assets.test.ts:246` continua valendo e um override nunca alarga além do que o
  multipart aceita — com teste literal para os quatro casos.
- **Testes não são circulares.** `upload-limits.test.ts` fixa os números
  literais (`20 * MB`, `100 * MB`) em vez de derivá-los do módulo, e as duas
  mutações do §1 provam que a suíte está presa ao comportamento.
- **`guessMime` já tratava `.mp3`/`.ogg`** desde antes; nada a mudar no serving.
- **Sem `--no-verify`, sem push, sem PR.** Um commit local na branch do item.

## 5. Suposição ainda aberta (herdada, não resolvida aqui)

O teto de áudio segue como **suposição declarada**: 100 MB, valor da spec 20
(`REQ-AST-008`). A fase Plano registrou ter fechado esse número com o dono, mas
ele nunca chegou no `run-input`. Se o número acordado for outro, é trocar uma
constante em `packages/server/src/assets/upload-limits.ts` e a cópia de UX em
`clientValidation.ts` — o desenho não muda.

Imagem continua nos 20 MB de hoje (a spec diz 50 MB; subir seria mudança de
comportamento que este item não pediu).

## 6. Prova jogada — PENDENTE de veredito do dono

O repo não tem infra de e2e automatizado (sem Playwright, sem
`.claude/skills/tutorial-e2e/`), e a convenção estabelecida no M1/M2 é a
**sessão de prova jogada com o mundo aberto**. Não rodei esta prova: o veredito
é do dono, não meu.

Roteiro mínimo:

1. **Pré-requisito de build**: `pnpm build` do client **e reiniciar o servidor**
   (lição já registrada: o servidor lê o `index.html` no boot).
2. **Abrir o Asset Browser** por qualquer caminho que hoje o abre (criar cena,
   adicionar token, retrato).
3. **Arrastar e soltar um `.mp3` de verdade** na área de drop → a barra de
   progresso vai até o fim e **aparece um card com o ícone ♫** na grade, com o
   nome e o tamanho. *(Este é o gesto que o item existe para destravar; o 201 do
   servidor sozinho não prova nada.)*
4. **Repetir com um `.ogg`** → mesmo resultado.
5. **Tentar um `.wav`** → erro de tipo não suportado, sem card.
6. **Tentar uma imagem acima de 20 MB** → mensagem de tamanho **nomeando
   `image`**; e um áudio do mesmo tamanho **passa**. É o par que dá nome ao item.
7. **Não-regressão**: subir um `.png` normal por "Browse files" continua
   funcionando, e o diálogo do sistema num picker de imagem continua oferecendo
   só `.png,.jpg,.jpeg,.webp,.svg`.
8. **Conferir o achado do §3** (opcional, mas é o passo que mostra o problema):
   com um `.mp3` na biblioteca, abrir "criar cena" → o card do mp3 aparece na
   grade e pode ser escolhido como fundo.

## 7. Veredito

O código faz o que o item promete, os limites são cobrados na ordem certa, os
testes estão presos ao comportamento (verificado por duas mutações), tipos e
lint estão limpos e a suíte inteira está verde. O que sobra para o humano: o
veredito da prova jogada (§6), a decisão sobre o achado do §3 (item novo) e a
confirmação do número do teto de áudio (§5).
