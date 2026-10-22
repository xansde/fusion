# Sonda — Arquétipos e Multiclasse (nível 2-3)

Ref lida: `origin/feat/classes-necromancer-runesmith` (73fb5e), via `git show ... :systems/pf2e/packs/<pack>/documents.json` dentro de `external/fusion-systems-2e` (submodule não tocado). 29 classes em `classes-core`.

> **ESCOPO CORTADO (Alexandre, durante a sonda):** dedicação de MULTICLASSE sai da 1ª fatia. Os itens 1-2 abaixo separam os dois grupos; a ausência de dedicações de multiclasse deixou de ser tratada como bloqueador.

## 1. Talentos de dedicação no pack `feats-core`

7 talentos "X Dedication" no total, em dois grupos por trait:

- **Multiclasse de verdade** (trait `multiclass`, pré-requisito é atributo, dá acesso a uma classe existente): **Alchemist Dedication**, **Rogue Dedication** — só 2 das 29 classes.
- **Arquétipo não-multiclasse** (fora do escopo cortado — dedicações de "class archetype" do War of Immortals, pré-requisito é já ser a classe, ou arquétipo comum): **Avenger Dedication**, **Bloodrager Dedication**, **Runelord Dedication**, **Vindicator Dedication** (trait `class`, não `multiclass`), **Unassuming Dedication** (trait só `halfling`, arquétipo comum sem feats dependentes no pack).

## 2. Arquétipos cobertos vs. dedicação presente

119 feats com trait `archetype`; ~68 arquétipos distintos referenciados via prerequisito "`<Nome> Dedication`". Focando só no grupo NÃO-multiclasse (item 1): **5 arquétipos têm a própria dedicação presente e acessível** (Avenger, Bloodrager, Runelord, Vindicator, Unassuming). Os demais ~63 arquétipos (Acrobat, Alter Ego, Cavalier, Dandy, Pathfinder Agent, Linguist, etc.) têm feats de nível superior no pack mas nenhuma dedicação — inacessíveis por falta de dado, **mas isso é esperado**: a maior parte desses feats é nível 4+ (fora do escopo nível 2-3) e a lacuna de dedicação de multiclasse já está fora de escopo por decisão.

## 3. Talentos de arquétipo nível 2-3

16 feats com trait `archetype` em nível 2 ou 3 (todas as 7 dedicações + 9 feats de seguimento: Dueling Acumen, We're on the List, Familiar Oddities, Ivy District Influencer, Fresh Ingredients, Malleable Movement, Embed Aeon Stone, Express Driver, Know the Beat, Inspired Memory). **100% (16/16) têm `prerequisites` não-vazio** exigindo a dedicação correspondente.

## 4. Mecanismo/UI de multiclasse por níveis — ENCERRADO (fora de escopo)

Existe fundação no servidor (`engine-2e/src/levelContext.ts`, `planVM.ts` linha ~4959 `setClassLevelsVariant`), UI na aba Plano não confirmada em profundidade — não aprofundado por instrução.

## 5. Regras de validação (só arquétipo comum, multiclasse fora)

- **Pré-requisito de dedicação em feat de seguimento**: validado pelo resolvedor de prerequisito free-text genérico em `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2559-2677` (compara `system.prerequisites[].value` normalizado contra os feats que o personagem possui — mesmo mecanismo usado para qualquer feat, não é lógica dedicada a arquétipo).
- **"Uma dedicação por vez até pegar 2 feats dela"**: NÃO encontrada em código nem em specs — sem evidência de implementação.
- **`regra:dedicacao-nao-cabe-em-slot-de-classe`**: não existe como identificador de código/spec no repo atual; só aparece citada na memória do projeto (ficha-alvo Fofurinha, PR #95) como decisão de produto (RAW) NÃO corrigida — segue pendente, sem enforcement no `planVM`.

## Elfo Ancião (Ancient Elf) — NOVO, prioritário

- (a) **Presente** em `heritages-core` na ref lida (`git show origin/feat/classes-necromancer-runesmith:systems/pf2e/packs/heritages-core/documents.json`), doc `name: "Ancient Elf"`.
- (b) **Concede nada hoje**: `system.rules` está vazio `[]`; a concessão de dedicação de multiclasse (`GrantItem` com uuid `{item|flags.system.rulesSelections.ancientElf}`) foi MOVIDA para `flags.fusion.disabledRules[0]` com `decision: "DEC-MC-01"`, `decidedOn: "2026-08-23"` — já desativada na fonte do pack.
- (c) **Mecanismo `curation/disabled-rules.mjs` existe e já cobre este caso exato**: entrada dedicada em `external/fusion-systems-2e/tools/importer-pf2e/src/curation/disabled-rules.mjs:59-64` (`docName: "Ancient Elf"`, mesmo `rules: [{ kind: "grant-item", uuid: "{item|flags.system.rulesSelections.ancientElf}" }]`), coberto por `__tests__/disabled-rules.test.mjs`. Para mundos já criados antes dessa versão do pack, a mesma desativação é replicada por `packages/server/src/db/migrations/010_dec_mc_01_ancient_elf.ts` (procura o `GrantItem` embutido em atores/itens existentes e move para `disabledRules`, mesmo formato).

## 6. Veredito (escopo ajustado)

Multiclasse: fora de escopo por decisão do Alexandre, não é mais "bloqueador" a reportar. Arquétipo comum nível 2-3: bloqueador de **DADO parcial** (só 5/~68 arquétipos com dedicação própria acessível, mas os 5 presentes cobrem os 16 feats de nível 2-3 do pack) + bloqueador de **MECANISMO parcial** (regra "uma dedicação até 2 feats" ausente; `dedicacao-nao-cabe-em-slot-de-classe` pendente como decisão RAW não corrigida). Elfo Ancião: **NÃO fura o corte** — a via de multiclasse por herança já está desativada tanto no pack quanto para mundos existentes (DEC-MC-01), então nível 1 não introduz multiclasse pela porta dos fundos.
