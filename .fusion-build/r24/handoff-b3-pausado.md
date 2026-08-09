> **⚠️ OBSOLETO — não siga este documento.** Verificado em 2026-08-09: a esteira
> B0→B3 foi inteiramente concluída e mergeada (PRs #67, #70, #74, #75). Os 7 commits
> do B3 estão em `origin/build/app` e não há nenhum PR aberto. O que está descrito
> abaixo como "pausado" ou "travado" já não existe. Mantido só como registro
> histórico. Estado atual em `.fusion-build/r26/handoff-frentes-abertas.md`.

# Handoff — B3 pausado com o trabalho commitado, gates de workspace NÃO rodados

Sessão interrompida por queda de energia em 2026-08-02. Tudo está commitado na
`fix/b2-conteudo-packs`. **Nada foi enviado ao remoto** e **nenhum PR foi aberto**.

## O que está commitado (7 commits meus, nesta ordem)

| commit | assunto | issues |
| --- | --- | --- |
| `0248225` | preserva o overlay persistido, resolve por sourceId no painel | #10, #42 |
| `370ec49` | overlay pt-BR por `(packName, sourceId)` no servidor | #43 |
| `70c3659` | rótulos residuais da ficha + picker de perícias | #40, #64 |
| `91674e8` | extrator para de tratar entrada sem descrição como pronta | (habilita #9) |
| `c7b5d15` | traduz as 1.128 descrições que faltavam | #9 |
| `421d2d8` | pré-requisitos em pt-BR por composição | #32 |
| `456620e` | traits faltantes + tools sob gate de CI | #71 |

## O QUE FALTA — leia antes de continuar

### 1. Os gates de workspace NÃO foram rodados por mim

Foi aqui que a sessão parou. **Rode antes de qualquer outra coisa:**

```
pnpm build && pnpm typecheck && pnpm lint && pnpm lint:boundaries
pnpm format:check
pnpm test
node --test tools/translate-packs/src/__tests__/*.test.mjs
node --test tools/importer-pf2e/src/__tests__/*.test.mjs
```

O que **eu** verifiquei de fato, com a saída na mão:

- `qa.mjs` dos packs: **exit 0**, todos os packs passam (só avisos heurísticos
  não-fatais de `glossary-applied`).
- `node --test` do translate-packs: **157/157**.
- Testes do compêndio no servidor: **43/43** (depois de eu consertar o barrel
  `compendium/index.ts`, que não reexportava o handler novo — o registro sozinho
  quebrava 14 testes).
- `glossary.test.mjs`: **9/9**. `traitNames.sync` + `documentDetails`: **150/150**.
- Comparador do overlay contra o HEAD: **1.128 ganhos, 1 alteração deliberada,
  0 perdas**.
- Acentuação: **621 antes, 621 depois** — o batch não introduziu nenhuma.

Os agentes reportaram `pnpm --filter @fusion/client test` verde (2.348 testes) e
`typecheck` com 0 erros, mas **isso é relato deles, não medição minha** — e no B2
um agente reportou verde tendo rodado pacote a pacote enquanto o workspace
inteiro acusava 5 falhas. Trate como não verificado.

### 2. Mergear `build/app` ANTES de abrir o PR

A sessão paralela da #66 avança direto na `build/app`. Mergeie e **rode os gates
depois do merge**, não antes.

### 3. A #65 ficou aberta, e o conserto está mapeado

`AutoFeatureModel` **já carrega** `docId`, vindo de `featuresByLevel[].uuid`
(trabalho da #14, no B1). O que falta é do outro lado: `buildContentNameTranslator`
(`planVM.ts:4975`) indexa **só por nome normalizado**, e `PlanNameIndexEntry`
(`planVM.ts:4936`) não tem `_id`. Então o `docId` correto chega até a UI e é
ignorado.

Conserto: `PlanNameIndexEntry` ganha `_id`, o tradutor indexa por ele, e
`autoFeatureDisplay` (`PlanColumn.svelte:581`) passa `feature.docId` com o nome
como fallback. Resolve não só o "Deity" — o próprio código admite que **5**
entradas de `featuresByLevel` carregam nome que o pack não tem ("Debilitating
Strikes" vs "Debilitating Strike", "Deity" vs "Deity (Cleric)").

**Cuidado:** `planVM.ts` e `PlanColumn.svelte` são os arquivos que a sessão da
#66 disputa. Fazer depois do merge da `build/app`.

Há um comentário MENTIROSO em `planVM.ts:4963-4965` dizendo que o nome normalizado
é "the only reliable key" porque "the pack index does NOT expose
`flags.fusion.sourceId`" — falso desde a #41. O mesmo texto obsoleto está em
`characterSheetVM.ts:2811`. Corrigir junto.

### 4. Colisão com a sessão paralela — já aconteceu duas vezes

Durante esta sessão, a sessão da #66 rodou um commit que **engoliu meu staging**
e levou todo o changeset da #71 para dentro do commit dela
(`docs(r24): handoff do diagnóstico de merge da stack B0→B1→B2`). Depois ela
amendou esse commit e meus arquivos voltaram para a árvore, então eu os
recommitei corretamente em `456620e`. **Confira `git log --oneline -5` e
`git status` antes de qualquer `git add`** — e prefira `git add <caminhos>` +
`git commit` num único comando, para encurtar a janela.

### 5. O PR ainda não existe

Um PR por batch, empilhado: base `fix/b1-identidade`? **Não** — o B3 empilha
sobre `fix/b2-conteudo-packs`. Como os commits do B3 foram feitos *na própria*
`fix/b2-conteudo-packs`, é preciso decidir: ou criar `fix/b3-i18n` a partir daqui
e reapontar, ou aceitar que o PR #74 passa a conter B2+B3. **Recomendo separar**:
o PR #74 já está aberto e revisável, e misturar 1.128 traduções nele destrói a
revisibilidade.

No corpo do PR, lembrar: o commit `456620e` fecha a #71, mas se o histórico for
reescrito pela sessão paralela, conferir se o `Closes #71` sobreviveu.

## Issues a ABRIR (medido, fora do escopo do B3)

1. **621 campos do overlay com acento perdido**, incluindo NOMES que o jogador lê:
   `Nao Detectado` (condição), `Pericia Terreno`, `Multilingue`, `Acuidade Tatica`,
   `Visao de Calor`, `Pericia com Armas`. O corretor **já existe e é testado**
   (`tools/translate-packs/src/fix-missing-accents.mjs`); em `--dry-run` são
   **567 docs, 3.838 substituições**. Não rodei porque afogaria o review do B3.
2. **Mistraduções e contaminação pt-PT**: `Touch of Undeath` está como
   "Toque da Morte Indígena"; `Demon Form` está como "Forma de **Demónio**"
   (português europeu); `Beast Trainer` como "Domestica Animal Ação";
   `Kodama Call` como "Espíritos da Madeira Prestamívos" (palavra inexistente).
3. **Colisão no glossário**: `finesse` (trait) e `precision` (tipo de dano) viram
   ambos "precisao". São conceitos distintos no PF2e e a distinção é mecânica.
   `finesse` é o lado a mudar. Não corrigi porque 15 agentes já traduziram com a
   forma atual.
4. **Inconsistências pré-existentes do corpus**, para uma passada de padronização:
   `low-light vision` tem TRÊS formas no repo; "bônus de condição" (244) x
   "bônus de status" (10); `kinetic gate` é "Portão Cinético" numa feature e
   "portal cinetista" em `actions-core`; `signature spell` alterna entre
   "de assinatura" e "emblemática"; `cineticista` (16) x `cinetista` (18).
5. **Asset da Paizo em `unconvertedRules`**: `equipment-core/xHtscw4I2ztIg0r5`
   ("Torch") carrega `icons/sundries/lights/torch-brown-lit.webp` no `value` de
   uma regra inerte. A substituição de assets normaliza a chave `img` mas não
   alcança caminho dentro do `value` de regra. Inerte hoje; vira caminho resolvido
   se a #51 (B6) ligar o consumidor. Pertence ao B6.
6. **Nome de equipamento sem tradução na ficha** ("Longsword" no bloco de
   Ataques). Nenhum ponto da ficha resolve nome de equipamento para pt-BR; magias
   têm `buildSpellNameTranslator` alimentado por fetch do índice do pack, armas
   não têm equivalente. É infraestrutura nova, espelhando o mecanismo das magias.
7. **Erro de fonte do vendor**: `feats-core/OvWkyr83lV3J1atA` ("Drowning Mist")
   traz `"sarglagoninspired"` no EN — hífen perdido na extração. Curadoria do
   importer.

## Ferramentas de verificação que escrevi (no scratchpad da sessão, NÃO commitadas)

Se forem úteis de novo, vale recriar ou promover para `tools/`:

- `check-regressao.mjs` — compara cada overlay contra o `HEAD` e separa em ganho /
  alterado / perdido. **Foi ele que pegou os dois problemas mais sérios do batch**:
  120 nomes sobrescritos e 34 descrições que seriam revertidas para enrichers
  quebrados.
- `check-consistencia.mjs` — mapeia os nomes canônicos do overlay e acha prosa que
  cita documento sem usar a forma canônica.
- `diff-acentos.mjs` — conta acento perdido no HEAD e na árvore com a mesma régua.
- `check-overlap.mjs` — prova que os `translated-*.json` residuais não atropelam a
  rodada nova.
- `audit-art.mjs` — auditoria clean-room varrendo campo aninhado.

**Três armadilhas de medição que eu atravessei** e que vão morder de novo:

1. **Enricher aninha colchete.** `@Damage[2d4[persistent,bleed]|options:area-damage]`:
   um strip com `[^\]]*` para no `]` interno e deixa lixo que parece prosa.
2. **Menção dentro de `@UUID[...]` sem rótulo não é texto traduzível** — o nome de
   exibição é resolvido em runtime. Contar essas mençōes inflou um relatório em ~10x
   (393 achados viraram 40 depois da correção).
3. **Verbo homógrafo.** `pratica`/`critica` são grafias corretas; `prática`/`crítica`
   são outro uso. E `sabedoria`, `carisma`, `destreza`, `ferocidade` nunca levam
   acento. Um dicionário de "só existe acentuada" não pode conter nenhuma delas.
