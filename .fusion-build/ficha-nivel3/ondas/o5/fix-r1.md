# Fixer O5 — Onda 5 (Arquétipos padrão, variante Arquétipo Livre), rodada 1

Worktree: `.../scratchpad/wt-c` (core `ficha3/o5`, satélite `xansde/fusion-systems-2e` `ficha3/o5`).

Status: **os 6 achados confirmados (2 bloqueantes, 4 importantes) foram consertados, testados e
commitados/pushados.** Nenhum achado foi contestado — todos os 6 se confirmaram reais na
verificação.

## Tabela achado → commit → teste

| Achado | Severidade | Commit (satélite) | Teste que prova o conserto |
|---|---|---|---|
| C-1 — CI vermelho (grantMaterializer/allowlist) | bloqueante | `7bb370e` | `grantMaterializer.test.ts` (75/75) + `grant-resolution-validator.test.ts` (4/4) |
| C-2 — regen do feats-core mexeu em 83 docs fora do escopo | bloqueante | `ba0c16a` | `grafo-de-feats.test.mjs` (31/31, node --test) + comparação `_id` a `_id` contra `80740cc` (added=163, changed=0, removed=0) |
| C-3 — dedicação de multiclasse no slot do Arquétipo Livre | importante | `47ce479` | `planVM.test.ts` — 2 testes novos com Alchemist/Rogue Dedication reais (rejeitam), fixture `acrobatDedicationFeatDoc` cobre a aceitação padrão |
| C-4 — dedicação completa com 1 seguimento (RAW exige 2) | importante | `b382cf5` | `planVM.test.ts` — teste circular corrigido + 2 testes novos (2 seguimentos diretos, seguimento-de-seguimento em cadeia) |
| C-5 — editar o slot preenchido esconde todas as dedicações | importante | `b382cf5` (mesmo commit de C-4 — mesma função, ver nota) | `planVM.test.ts` — 2 testes novos de `excludeSlotId` |
| C-6 — Sanguimancer Dedication sem trait `archetype` vaza pro classFeat | importante | `c9e3372` | `planVM.test.ts` — 4 testes novos com o doc real (`h1Zd9luvXtpuGwxH`), traits crus e normalizados |

Repin do core: commit `ae1a2c32` (`chore(ficha-nivel3): repina o satélite pós fixer da Onda 5,
rodada 1`), satélite `86bbe99..c9e3372`. Ambas as branches (`ficha3/o5` core e satélite)
**pushadas** para `origin` (conta `xansde`).

**Nota sobre C-4/C-5 no mesmo commit:** os dois defeitos vivem na mesma função
(`getIncompleteDedications`) e o conserto de um se entrelaça no corpo do outro (contagem de
cadeia + parâmetro `excludeSlotId` tocam as mesmas linhas) — não há uma divisão limpa sem
reescrever a função duas vezes. Documentado explicitamente na mensagem do commit.

## O que cada conserto fez (resumo técnico)

- **C-1**: o `grantMaterializer.test.ts` (census de grants, issue #16) não tinha sido atualizado
  depois que a T5.1 mudou o `grant-resolution-allowlist.mjs`. Verificado contra o vendor: 4
  dedicações (Battle Harbinger, Munitions Master, Palatine Detective, Spellshot) passaram a
  resolver (fecham #92); 4 alvos novos (Harrowing — ritual sem `traditions`; Razmiri Mask e
  Storied Skin — equipamento inicial; Catharsis Emotion — classFeature de nível 4+) entram como
  gap documentado, mesma forma estrutural dos gaps já aceitos (equipamento/spell fora de escopo).
- **C-2**: a regeneração usou um snapshot de vendor diferente do commit-base e reescreveu 83
  documentos pré-existentes (drift, não dado novo). Restaurado o conteúdo original desses 83 e
  mantidos só os 163 documentos genuinamente novos. O stash `"ficha3: sobra da o5 antes da o7a"`
  do satélite (deixado por uma rodada de conserto anterior à pausa) já continha exatamente esse
  conserto — foi conferido, confirmado por comparação `_id` a `_id`, e aplicado.
- **C-3**: o ramo `archetypeFeat` de `isFeatEligible` só exigia o trait `archetype`, sem excluir
  `multiclass`. Alchemist Dedication e Rogue Dedication são as únicas 2 (de 169) dedicações do
  pack com o trait `multiclass` — confirmado por contagem. Agora rejeitadas nesse slot.
- **C-4**: toda dedicação de arquétipo do RAW diz "two other feats", não um só. A função agora
  monta a cadeia do arquétipo (dedicação + todo talento cujo pré-requisito cita algo já
  confirmado na cadeia, contando seguimento-de-seguimento) e exige pelo menos 2 outros membros.
- **C-5**: `getIncompleteDedications` ganhou `opts.excludeSlotId` — o `PlanColumn.svelte` passa o
  slot sendo editado, então a dedicação que já ocupa esse slot não conta como "incompleta contra
  si mesma".
- **C-6**: Sanguimancer Dedication é o único talento do vendor com `traits.value: ["dedication"]`
  sem `archetype` (quirk do próprio vendor, já documentado no código mas nunca corrigido no
  dado). Conserto em duas camadas: `normalizeArchetypeTrait()` no importador (aplicado também via
  patch cirúrgico de 1 linha no pack já commitado, para não re-rodar o pipeline inteiro e
  reintroduzir o drift do C-2) + defesa em profundidade no ramo `classFeat` (rejeita qualquer
  talento com o trait `dedication`, mesmo sem `archetype`).

## Verificação (rodada nesta worktree)

- `pnpm build` (core, topológico) — **verde**.
- `pnpm typecheck` (core, 14 projetos) — **0 erros**, 24 warnings a11y/svelte pré-existentes.
- `pnpm lint` — **0 erros**, 1 warning pré-existente (`pregen-parity.test.ts`, já citado no
  baseline da Onda 0).
- `pnpm lint:boundaries` — **sem violações** (5036 módulos, 12139 dependências).
- `pnpm format:check` — **todos os arquivos no padrão Prettier**.
- `pnpm spec:report` — cobertura MVP com teste: 710 (piso 710), sem regressão.
- Testes AFETADOS (não a suíte inteira):
  - `grantMaterializer.test.ts` — 75/75
  - `grant-resolution-validator.test.ts` — 4/4
  - `planVM.test.ts` — 414/414 (+7 testes novos sobre os 407 anteriores)
  - `classFeatLeakGuard.test.ts` — 5/5
  - `grantMaterializer-realPacks.test.ts` — 11/11
  - `varredura-classes.test.ts` — 190/190
  - `actionsVM.test.ts` — 140/140
  - `traitGroups.test.ts` — 11/11
  - `planColumn-variant-rules.test.ts` — 6/6
  - `grafo-de-feats.test.mjs` (importer, node --test) — 31/31
  - `node --test src/__tests__/*.test.mjs` (importer, suíte completa) — 309 passam, **16 falhas
    pré-existentes e não relacionadas** (SF2E weapon/augmentation/conditions transform, MVP packs
    class-features-core, normalizeClassSystem/normalizeClassFeatureSystem do Magus) — confirmado
    rodando a mesma suíte com C-2/C-6 stashados: as mesmas 16 falhas aparecem sem nenhum dos meus
    consertos, então não são regressão desta rodada.
- Todos os testes novos foram verificados VERMELHOS pelo motivo certo antes do conserto (TDD):
  stash temporário do arquivo de código, rodada isolada confirmando a falha esperada, depois
  restauração e verde.

## Pendências para issue (menores, fora do escopo desta rodada — C-1..C-6 já fecham o que foi
pedido; C-7/C-8/C-9/C-10 vieram junto na revisão adversarial mas não estavam na lista de achados
confirmados a consertar)

Nenhuma issue foi aberta nesta rodada (fora do escopo pedido); títulos e corpos abaixo ficam
prontos para abrir quando alguém decidir agir sobre eles.

1. **Repo:** `xansde/fusion-systems-2e`
   **Título:** `planVM: seguimento com pré-requisito composto "A or B" não é reconhecido (C-7)`
   **Corpo:** O requisito de "We're on the List" é `"Alter Ego Dedication or Archaeologist
   Dedication"`, e a comparação em `getIncompleteDedications`/`checkSlotRequirement`
   (`planVM.ts:~3432`) é por igualdade exata de string — não reconhece nenhum dos dois lados do
   "or". Reutilizar o separador de "or" que já existe (`planVM.ts:~3070`, usado em outro
   contexto) para dividir o pré-requisito em alternativas antes de comparar. Achado C-7 da
   revisão adversarial da Onda 5 (ficha-nivel3), severidade menor.

2. **Repo:** `xansde/fusion-systems-2e`
   **Título:** `PlanColumn: dedicação bloqueada some do picker sem motivo visível (C-8)`
   **Corpo:** Quando `isFeatEligible` rejeita uma nova dedicação por causa da regra "uma
   dedicação por vez" (T5.3), o item simplesmente não aparece na lista — sem nenhum aviso do
   motivo. Mostrar um aviso no padrão do `showRepeatCapNotice` (issue #57) quando o clique cair
   numa dedicação bloqueada por esse motivo. Arquivo: `PlanColumn.svelte:~1100`. Achado C-8 da
   revisão adversarial da Onda 5, severidade menor.

3. **Repo:** `xansde/fusion-systems-2e`
   **Título:** `Pool de 166 dedicações padrão não checa pré-requisito/raridade/dedicação de
   arquétipo de classe (C-9)`
   **Corpo:** Comportamento pré-existente (a checagem nunca existiu), mas a superfície afetada
   passou de ~5 dedicações especiais-casadas para 166 com a T5.1. `isFeatEligible`
   (`planVM.ts:~2347`) e `isStandardArchetypeDedication`
   (`build-mvp-subset.mjs`) não verificam pré-requisito textual, raridade (`rare`/`uncommon`
   exigem regra de acesso) nem excluem dedicações que são na verdade o mecanismo de uma subclasse
   específica (`class-archetype-gap`, categoria já usada no allowlist). Levantar o escopo real do
   problema e decidir se entra nesta fatia ou fica para depois. Achado C-9, severidade menor.

4. **Repo:** `xansde/fusion-systems-2e`
   **Título:** `As 163 dedicações novas do feats-core não têm tradução pt-BR (C-10)`
   **Corpo:** A T5.1 importou 163 documentos novos em `feats-core`
   (`systems/pf2e/packs/feats-core/documents.json`) sem entrada correspondente em
   `i18n.pt-BR.json` — aparecem em inglês na ficha (ex.: "Acrobat Dedication"). Mesmo padrão da
   issue #58 (deities). Achado do juiz na revisão adversarial da Onda 5 (C-10), severidade menor.

## `tocou_fluxo_criacao`

`true` — os consertos de C-3, C-4, C-5 e C-6 mudam `planVM.ts` (elegibilidade de talento,
`getIncompleteDedications`) e `PlanColumn.svelte` (picker de talento), que são exatamente o
código que a criação/subida de nível de personagem executa e exibe. C-1/C-2 mexem em dado de pack
e teste de census, sem alterar comportamento do picker além do que C-6 já cobre.
