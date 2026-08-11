# r28 — Sessão noturna: fechar os buracos de importação do PF2e

> Plano escrito em 2026-08-10, após o merge do PR #101 (Player Core 2). Fonte da
> medição: vendor pf2e (~16k docs) vs packs curados (~4,7k). Cada workstream
> abaixo é uma task AUTO-CONTIDA para um subagente, com worktree, branch e PR
> próprios. **Nenhum agente mergeia nada** — os PRs ficam para o Alexandre de manhã.

## Regras globais (valem para TODOS os agentes — falha aqui invalida a entrega)

1. **Worktree própria** a partir de `origin/build/app` (fetch antes), com
   `pnpm install` (NUNCA em paralelo com outra worktree instalando — corrompe o
   store) e `pnpm build` antes de qualquer teste.
2. **Pipeline fresco** (errata da noite): a ordem real é
   `node src/extract.mjs --all && node src/normalize.mjs --all && node src/transform.mjs --all`
   (o plano original omitia o `normalize.mjs` — o transform falha sem ele). O
   `out/` é gitignorado — um `out/` velho REVERTE enrichment em silêncio (foi o
   defeito latente do WIP da r27). **Errata 2 (incidente de disco 100% cheio na
   Onda 1)**: como as 4 branches partem do MESMO commit, o `out/` fresco foi
   gerado UMA vez no repo principal e compartilhado por junction somente-leitura
   em cada worktree. Agente que precisar ALTERAR extract/normalize/transform
   deve PARAR e reportar ao orquestrador em vez de rodar a pipeline no `out/`
   compartilhado.
3. **`build-mvp-subset.mjs` regenera os 14 packs**: depois do build, commitar
   SOMENTE os packs que o workstream possui (lista em cada task) e reverter o
   resto com `git restore` — senão todo PR conflita com todo PR nos `pack.json`.
4. **Tradução pt-BR obrigatória** na entrada (nunca "traduzo depois"): fluxo
   `extract.mjs → chunks → traduzir → translated-NNN.json → apply.mjs → qa.mjs`
   do `tools/translate-packs`. Validar cada lote por script: ids batendo com o
   chunk REAL da worktree (um agente da r27 leu chunk homônimo velho de outro
   diretório) e refs `@UUID/@Damage/@Check/@Template` 100% preservadas.
   **Distância em PÉS** (convenção do pack; nada de metros). Glossário:
   `glossary.pt-BR.json` — trait novo = entrada nova + gate de contagem
   (`documentDetails.test.ts`) atualizado com racional.
5. **Regenerar mapas do client** ao final: `gen-client-maps.mjs`,
   `gen-prerequisite-names.mjs`, `gen-familiar-abilities-i18n.mjs`.
6. **Gates completos antes do PR**: `pnpm test` (301+ arquivos), `typecheck`,
   `lint`, `lint:boundaries`, `format:check` (prettier nos packs!),
   `spec:report`. Testes com contagem fixa (varredura, choice-sets, traitGroups,
   grantMaterializer) são GATES DELIBERADOS: atualizar com racional no
   comentário, nunca afrouxar. ChoiceSet novo → classificar no
   `choiceSetInventory.ts` (`pendente` é aceitável; invisível não é).
7. **Clean-room**: dados ORC do vendor ok; arte da Paizo PROIBIDA (placeholder);
   nunca copiar texto de tradução oficial.
8. **Commit pequeno e verde + push imediato** (`gh auth switch -u xansde` para
   push, voltar para `xansde-seazone` depois). PR contra `build/app` com corpo
   descrevendo o que entrou, o que ficou de fora e por quê.
9. **Data-dir de servidor de teste NUNCA dentro da worktree** (lição do
   incidente de 2026-08-10: `git add -A` levou `~/.fusion` pro remoto). Servir
   em porta 33001+ com `--data-dir` no scratchpad FORA da árvore git.
10. **Identidade de documento = `flags.fusion.sourceId`**, nunca o nome
    (homônimos são padrão no PF2e).

## Ordem de ondas (dependências)

- **Onda 1 (paralelo)**: A1, A2, A3, A4 — packs disjuntos, zero interseção.
- **Onda 2 (depois da onda 1 abrir PRs)**: A5 (equipment-core toca o mesmo
  pack que A1 se armaduras forem para equipment-core — por isso A1 cria packs
  NOVOS) e A6 (classes tocam feats-core/class-features-core, que ninguém da
  onda 1 toca — pode rodar na onda 1 se a capacidade permitir).
- Um **monitor** cobre o estado "travou" (orquestração > 20 min): checar a cada
  30 min se cada agente comitou algo novo; agente mudo por 1h = investigar.

---

## A1 — Armaduras e escudos (packs novos `armor-core` + `shields-core`)

**Por quê primeiro**: é o que impede fechar uma ficha — 0 de 201 armaduras,
0 de 118 escudos.

- Branch: `feat/armor-shields-core`. Packs que o workstream possui:
  `armor-core`, `shields-core` (novos), `build-report.json`.
- Curadoria: começar por Player Core + Player Core 2 (armor `system.category`
  light/medium/heavy + unarmored; escudos básicos). Itens mágicos/específicos
  de aventura ficam FORA desta leva (declarar no PR).
- Novo pack exige: entrada no `build-mvp-subset.mjs` (predicado próprio, espelhar
  o de `weapons-core`), `pack.json`, registro onde o sistema lista packs
  (procurar como `weapons-core` é registrado no `systems/pf2e`), i18n overlay.
- A ficha precisa ENXERGAR armadura: verificar se o client tem aba de inventário
  que lista armor (spec 17/varredura #61). Se a UI não existir, o pack entra
  mesmo assim e o PR declara a lacuna de UI — conteúdo primeiro, gatilho de UI
  vira issue.
- Testes: catraca de contagem no estilo `packs-validation.test.ts` (N armaduras,
  N escudos, asserção de conjunto por sourceId — NÃO circular: validar contra
  fixture de personagem real, ex. AC esperada de um Fighter de couro batido).

## A2 — Bestiário Monster Core (`bestiary-core` 10 → ~492)

- Branch: `feat/bestiary-monster-core`. Packs: `bestiary-core`,
  `build-report.json`.
- Importar as 492 criaturas do `pathfinder-monster-core` (out/ já transforma).
  Ícones: placeholder (arte Paizo proibida).
- Tradução: nome + traits obrigatórios; a PROSA de lore pode entrar como
  `noDescription: true` deliberado quando o custo explodir — decidir por
  orçamento: traduzir descrição das ~150 criaturas de nível ≤ 5 (as que a mesa
  usa primeiro), o resto name-only marcado. Declarar a régua no PR.
- Validação de jogabilidade: arrastar criatura para cena vira token com HP/AC
  derivados corretos (teste de servidor com 3 criaturas de níveis distintos,
  contra valores do statblock do vendor — cuidado com teste circular).

## A3 — Fechar o arco Player Core 2 (backgrounds + spells)

- Branch: `feat/pc2-backgrounds-spells`. Packs: `backgrounds-core`,
  `spells-core`, `build-report.json`.
- Backgrounds: +23 do PC2 (43 → 66). Spells: +48 do PC2 (1262 → 1310).
- Mesmo padrão do PR #101 (predicado `isRemasterCoreDoc` já existe — estender
  aos packs certos SEM alargar os outros; ver o comentário de advertência no
  próprio `isPlayerCoreDoc`).
- Tradução completa (backgrounds e spells são curtos). Skills de background com
  escolha → `choiceSetInventory` (padrão Hermit/skill `pendente`).

## A4 — Armas restantes (`weapons-core` 42 → ~200)

- Branch: `feat/weapons-expansion`. Packs: `weapons-core`, `build-report.json`.
- Curadoria: TODAS as armas simples/marciais/avançadas NÃO-mágicas de
  PC1+PC2 (o vendor tem 975 contando mágicas/específicas — essas ficam fora,
  declarar). Estimar ~200; medir antes e cravar a contagem na catraca.
- Traits de arma novos → glossário + gate de contagem.
- Validar: o construtor de ficha oferece as armas por proficiência da classe
  (o harness de r25 — `classBuildHarness` — já testa proficiência nomeada).

## A5 — Consumíveis e equipamento de aventura (`equipment-core` 18 → ~300)

**Onda 2** (mesmo pack que outros podem tocar; rodar sozinho).

- Branch: `feat/equipment-consumables`. Packs: `equipment-core`,
  `build-report.json`.
- Curadoria por fatia de valor de mesa: kit do aventureiro, ferramentas,
  poções/elixires/talismãs de nível ≤ 8 de PC1+PC2+GM Core. Estimar ~300 docs;
  o resto (1.666 consumíveis!) fica para levas futuras com régua declarada.
- `Tengu Feather Fan`, `Orc Warmask`, `Clan Dagger`, `Clan Pistol`, `Head Gem`,
  `Lucky Keepsake`, `Pilgrim's Token` — os 7 grants de equipamento hoje
  documentados como gap no `grantMaterializer.test.ts`: incluir os itens e
  REMOVER da lista de gaps (o teste aperta sozinho).

## A6 — Classe nova piloto: Druid (classes-core 14 → 15)

**A mais arriscada — rodar por último ou com o melhor modelo disponível.**

- Branch: `feat/class-druid`. Packs: `classes-core`, `class-features-core`,
  `feats-core`, `spells-core` (focus spells de ordem), `build-report.json`.
- Seguir o processo de curadoria de classe da r22 (`curation/classes/*.json`:
  eixos, classFeats rule, proficiencyUpgrades) usando Gunslinger/Psychic do #95
  como modelo mais recente. Ordem druídica = eixo (ChoiceSet), animal companion
  = dívida declarada (`pendente`).
- **Consultar o Waybuilder ANTES** (uso liberado pelo Igor): issues #3 (grants
  vazios), #10 (eixos tortos) — a base dele pode dar os eixos prontos, mas
  conferir contra o vendor.
- Validação: NADA de teste circular (lição #48) — construir um Druid nível 1-5
  no harness e conferir contra ficha de referência externa (Pathbuilder).
- Se o tempo estourar: entregar fundação (classe + features + eixo de ordem)
  sem os 100+ class feats traduzidos — feats do Druid podem vir em PR seguinte;
  declarar.

---

## O que NÃO entra na noite (deliberado)

- Divindades, journals, roll tables, efeitos de item, iconics como fichas — nem
  extraídos ainda; exigem decisão de modelo de dados (ex.: deity toca Cleric).
- SF2e (5 packs stub) — onda própria depois do PF2e estabilizar.
- As outras 12 classes — o Druid é piloto; o processo validado vira fábrica.
- UI nova (inventário/loja, painéis do HUD) — a noite é de CONTEÚDO; lacuna de
  UI vira issue com label, não código improvisado às 3h.

## Encerramento da noite (último agente ou o orquestrador)

1. Conferir que cada workstream abriu PR e o CI está verde; PR sem CI verde é
   trabalho não-entregue — consertar ou declarar no corpo do PR.
2. Atualizar `.fusion-build/r28/resultado.md` com: PRs abertos, contagens
   antes/depois por pack, dívidas declaradas, o que ficou de fora.
3. Atualizar a memória do projeto (`project_fusion` / nova `project_r28`).
4. NÃO mergear nada. NÃO deletar branch. NÃO tocar em `main`.
