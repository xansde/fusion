# Sonda de criação de ficha — grupo "subsistema-próprio" (Kineticist, Champion, Exemplar)

Fonte: `external/fusion-systems-2e` @ `origin/feat/classes-necromancer-runesmith` (packs `classes-core`, `class-features-core`, `feats-core`, `equipment-core`, lidos via `git show`, nunca checkout). Builder: `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (5876 linhas) + componentes em `sheets/pf2e/src/components/sheets/pf2e/plan/`.

## 1. Kineticist

Features nível 1-3 (`classes-core` → `featuresByLevel`): 5 no total — **Kinetic Aura** (n1, 2 rules), **Kinetic Gate** (n1, 2 rules "grant-item" apontando para placeholders `{item|flags...rulesSelections.elementOne/Two}"`), **Impulses** (n1, 2 rules grant-item para Elemental Blast + Base Kinesis), **Will Expertise** (n3, 0 rules — passiva pura), **Extract Element** (n3, 1 rule grant-item). 5/5 features têm ao menos 1 rule preenchida (0 grants totalmente vazios), mas o mecanismo REAL de escolha (gate único/duplo, elemento(s)) vive em `flags.fusion.unconvertedRules` como 3 `ChoiceSet` com `_conversionState: "unsupported"` — o servidor genérico NÃO resolve ChoiceSet (decisão V2 documentada em `planVM.ts:907`).

**Mas** o builder já tem um mecanismo PRÓPRIO, hand-coded, que substitui o ChoiceSet ausente: `KineticGateDialog.svelte` (476 linhas) + `GateThresholdDialog.svelte` (363 linhas) + funções `chooseKineticGate`/`chooseGateThreshold`/`readGateElements` em `planVM.ts` (linhas ~2710-3030). Elemento e tipo de gate (single/dual) e o dano do gate's threshold (nível 5/9/13/17) são um enum FIXO no código (`KINETIC_ELEMENTS`, `KINETIC_ELEMENT_DAMAGE_TYPES`), não dependem de tag no pack — por isso funcionam mesmo sem dado de opções taggeado (confirmado: tag `kineticist-kinetic-gate` tem **0 hits** nos packs). Há teste dedicado `__tests__/kineticGate.test.ts`.

Impulsos de nível 1 (feats com trait `kineticist`, nível 1): **28** no pack (Aerial Boomerang, Air Cushion, Burning Jet, etc.) — selecionáveis pelo picker genérico de `classFeat` (mesma trilha de qualquer feat de classe), sem mecanismo especial adicional identificado.

Talentos de classe nível 1-2 (trait `kineticist`): **30** total, apenas **1** com `prerequisites` não-vazio.

**Cascata de escolha**: 2 níveis de profundidade — (1) tipo de gate [single/dual] → (2) elemento(s) [6 opções] → (2b) impulso(s) de nível 1 do(s) elemento(s) escolhido(s) [classFeat normal, filtrado por trait]. Suportada pelo `KineticGateDialog` (fixo/enum), não pelo ChoiceSet do pack.

## 2. Champion

Features nível 1-3: 5 no total — **Deity (Champion)** (n1, 3 rules grant-item, incl. placeholder `{...rulesSelections.deity}`), **Cause** (n1, 1 rule grant-item placeholder `{...rulesSelections.cause}`), **Devotion Spells** (n1, 0 rules, 0 unconverted — feature passiva de fato vazia mas correta), **Shield Block** (n1, compartilhada com Fighter/Exemplar), **Blessing of the Devoted** (n3). 5/5 com ao menos 1 rule preenchida; Devotion Spells é a única "vazia" por ser genuinamente sem mecânica própria.

**Cause**: mecanismo TOTALMENTE suportado — slot genérico `CLASS_CHOICE_SLOT_OPTIONS.cause` (`planVM.ts:2105`) filtra `class-features-core` por tag `champion-cause`; **7 causas** existem no pack (Desecration, Grandeur, Iniquity, Justice, Liberation, Obedience, Redemption) e a reação de campeão vem embutida no grant-item da própria causa escolhida.

**Deity**: dado de divindade **NÃO EXISTE** no repo — não há pack `deities-core` nem nenhum documento `type: "deity"` em nenhum pack lido. O próprio código do builder documenta o gap explicitamente: `choiceSetInventory.ts:110-111` — `"class-features-core/Deity (Champion)/deity": "pendente"` (mesma lacuna, mesma linha de raciocínio, para Cleric). Sanctification (holy/unholy) também é um `ChoiceSet` `unsupported` dependente da divindade, então cai junto.

Talentos de classe nível 1-2 (trait `champion`): **23** total, **9** com `prerequisites` não-vazio (a maior taxa das três classes).

**Cascata de escolha**: 2 eixos independentes no nível 1 — (a) Deity → Sanctification (bloqueado, sem dado) e (b) Cause (funcional, 1 nível de profundidade, 7 opções). Divindade é pré-requisito narrativo/RAW da Cause mas o builder não amarra os dois; sem a divindade, dá para escolher Cause e seguir jogável, mas a ficha fica sem o campo Deity preenchido/validado.

## 3. Exemplar

Features nível 1-3: 4 no total — **Shield Block** (compartilhada), **Humble Strikes** (n1), **Divine Spark and Ikons** (n1, 4 rules grant-item, incl. 3 placeholders `firstIkon/secondIkon/thirdIkon`), **Root Epithet** (n3, 1 rule grant-item placeholder `rootEpithet`). 4/4 com rule preenchida.

**Ikon**: é um **ITEM** (não feature) — tag `exemplar-ikon` em `class-features-core`, com **21 itens reais** no pack (confirmado após correção de busca — a checagem inicial em `feats-core`/`equipment-core` deu 0, mas os ikons vivem em `class-features-core`). "Additional Ikon" existe como feat separado (nível 2+) para pegar ikons extras.

**Root Epithet**: tag `exemplar-root-epithet`, **6 opções** no pack.

Porém — diferente de Cause — **nem "ikon" nem "epíteto" aparecem em `CLASS_CHOICE_SLOT_OPTIONS` nem em nenhum lugar do builder** (`grep -i ikon` no `sheets/pf2e/src` inteiro: 0 resultados). O dado existe no pack mas o builder não tem slot/picker algum para ele — mecanismo AUSENTE no lado da ficha, apesar do lado do pack estar pronto.

Talentos de classe nível 1-2 (trait `exemplar`): **8** total, **1** com `prerequisites` não-vazio.

**Cascata de escolha**: 2 níveis — (1) Ikon inicial [21 opções, tag `exemplar-ikon`] → (2) Root Epithet no nível 3 [6 opções, tag `exemplar-root-epithet`]. Estruturalmente IDÊNTICA ao padrão genérico já usado por Cause/Bloodline/Doctrine (tag → lista filtrada), só falta a entrada em `CLASS_CHOICE_SLOT_OPTIONS` + wiring no `PlanColumn.svelte` — não é um `ChoiceSet` unsupported nem falta de dado, é lacuna de implementação de baixo esforço relativo.

## Classificação

- **Kineticist — AMARELO** — mecanismo faltante: nenhum (gate/elemento tem dialog próprio funcional); risco residual é a interação impulso-elemento não validada automaticamente (picker genérico de classFeat não filtra por elemento escolhido).
- **Champion — VERMELHO** — 2 mecanismos: (1) dado de divindade totalmente ausente do repo (sem pack, sem tipo `deity`), (2) Sanctification dependente de (1), ambos `pendente` documentado no próprio código.
- **Exemplar — VERMELHO** — 2 mecanismos: (1) picker de Ikon ausente no builder apesar de dado pronto (21 opções), (2) picker de Root Epithet ausente no builder apesar de dado pronto (6 opções) — mesmo padrão genérico de Cause, só não foi cabeado.

Arquivo completo: `C:\Users\xansd\pessoal\fusion\.fusion-build\ficha-nivel3\classes\subsistema-proprio.md`
