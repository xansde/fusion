# Revisão adversarial — Onda 0 — lente TESTE NÃO-CIRCULAR + CONTRATOS

Data: 2026-09-21. Worktree lida (somente leitura): `scratchpad/wt-o0`.
Diffs: core `origin/alfa/app..ficha3/onda0` (docs + pin `77a31bc`); satélite
`origin/feat/classes-necromancer-runesmith..ficha3/onda0` (3 testes + allowlist + export) e
`origin/main..origin/feat/classes-necromancer-runesmith` (PRs #57/#65).

## Veredito

**NÃO MERGEAR como está.** Dois bloqueantes objetivos (CI vermelho nos dois repos com este pin)
e um importante que esconde, na allowlist, exatamente o tipo de buraco que a fatia existe para
fechar.

---

## B1 — BLOQUEANTE: CI do satélite vermelho por construção (validador T0.4)

- Arquivo: `sheets/pf2e/src/lib/sheets/pf2e/__tests__/grant-resolution-validator.test.ts:105-143`.
- Cenário: push de `77a31bc` em `ficha3/onda0` → run `35557899943` do satélite = **failure**,
  step "Test sheets/pf2e" (não é `continue-on-error`): "8 grant(s) do not resolve locally and are
  NOT on the allowlist" (7× Battle Creed → *Creed, Undead Creator → Create Undead). O commit
  anterior `bb167c1` (só T0.2) estava **success**. A regra de merge da sessão é "CI verde" →
  a onda não pode mergear.
- Efeito secundário (pior que o vermelho): com o teste permanentemente vermelho por motivo
  conhecido, uma 9ª regressão de grant entra sem ninguém notar — o validador vira ruído.
- Correção sugerida: decidir entre (a) resolver #88/#89 nesta onda, ou (b) registrar os 8 numa
  categoria explícita `blocked-by-issue` com o nº da issue (que o teste de sanidade aceita e que
  falha quando a issue fecha/resolve), mantendo o teste verde e sensível a qualquer grant novo.
  Não é para `skip` nem `it.fails` no teste todo.

## B2 — BLOQUEANTE: CI do core vermelho com o novo pin (contrato glossário satélite → client do core)

- Arquivo: `packages/client/src/lib/compendium/__tests__/traitNames.sync.test.ts` (core) ×
  `tools/translate-packs/glossary.pt-BR.json` (satélite, +13 linhas no PR #65).
- Cenário: `alfa/app` pina `e0597c9` (main do satélite); o pin novo `77a31bc` traz 11 traits
  novos no glossário (necromancer, runesmith, ikon, additive, additive2, apparition, wandering,
  modification, mindshift, amp, evolution) sem regenerar `TRAIT_NAMES_PT` no core. O core roda
  `pnpm test` no CI (ci.yml:82), que alcança o client → 2 testes vermelhos (T0.5-test.log:1612,
  1631), mais o validador B1 (o workspace do core inclui `sheets/pf2e`). Na tela: chip de traço
  dessas classes aparece com o slug cru em inglês no pt-BR.
- A T0.5 contou isso como "dívida do baseline", mas o baseline foi medido já com o satélite novo;
  **em `alfa/app` hoje esse teste está verde** — a onda é quem o torna vermelho no alvo do merge.
  Run do core `35558489316` (e8460b3f) ainda em andamento no momento desta revisão.
- Correção: regenerar `traitNames.ts` no core no mesmo PR do pin.

## I1 — IMPORTANTE: allowlist esconde 4 escolhas de subclasse de nível 1 como "bônus"

- Arquivo: `tools/importer-pf2e/src/curation/grant-resolution-allowlist.mjs`, categoria
  `archetype-not-imported` (4 entradas).
- Os granters são **todos nível 1, `otherTags: class-archetype/<eixo-de-subclasse>`**:
  Light Mortar Innovation (inventor-innovation) → Munitions Master Dedication; Way of the Spellshot
  (gunslinger-way) → Spellshot Dedication; Palatine Detective (investigator-methodology) →
  Palatine Detective Dedication; Battle Creed (cleric-doctrine) → Battle Harbinger Dedication.
- Cenário: jogador cria Gunslinger nível 1 e escolhe Way of the Spellshot → a dedicação que É a
  subclasse (conjuração do Spellshot) não materializa; o validador fica verde porque a entrada
  está "permitida". O próprio cabeçalho da allowlist proíbe isso ("No entry here may cover a
  reference a level 1-3 creation path … ACTUALLY NEEDS"), e o T0.3.md chama essas dedicações de
  "BÔNUS" — é falso, são o eixo de escolha nível 1. E a T5.1 importa só as "dedicações padrão"
  (tasks.md:140) — dedicação de arquétipo de CLASSE não está garantida lá, então a entrada pode
  nunca ficar stale e o buraco some para sempre.
- Correção: tirar as 4 da allowlist → BLOQUEADO + issue (ou incluir explicitamente na T5.1 as
  dedicações de class-archetype), igual ao tratamento dado às Creeds.

## I2 — IMPORTANTE: teste do Monk é vácuo; a prova de entrega da Onda 0 não existe

- Arquivo: `grantMaterializer-realPacks.test.ts:134-155`.
- O nome promete "class features grant what their rules declare"; as asserções são
  `after >= before` (sempre verdade: `materializeGrants` só emite `doc:create`) e idempotência.
  Nenhum item concedido é nomeado, nenhum "grant não resolvido" é checado (o comentário diz que
  checa, o código não). Cenário: se o Mystic Strikes/Flurry perdesse todos os grants amanhã, o
  teste continua verde.
- Somado a: `execucao.md:115` define a prova da Onda 0 como "script que conta GrantItem não
  resolvível: **tem que dar 0**" + "Monk criado num mundo e subido a 3 … print da aba Plano nos
  três níveis". Hoje: contagem = 8 (+27 allowlisted), `ficha3-reports/o0/prints/` **vazio**.
- Os dois testes do Ranger constroem até o nível **20** (`buildCharacterToLevel20`) antes do heal:
  provam "Hunt Prey existe no nível 20", não o caminho de criação nível 1
  (`classGrantRefsFromClassDoc` filtra `f.level > charLevel`). Menor, mas o título mente.
- Correção: asserções nomeadas no Monk (o que cada feature de 1-3 concede, ou "zero grants
  não resolvidos" via `onGrantFailure`), construir até 1/3 e não 20, e a prova viva com prints.

## I3 — IMPORTANTE: pin do core aponta para commit de branch de feature do satélite

- `e8460b3f` pina `77a31bc`, alcançável só por `origin/ficha3/onda0` (`git branch -r --contains`).
  PR #57 → PR #65 → onda estão empilhados. Cenário: merge squash (ou deleção da branch após o
  merge) → o SHA pinado some da main do satélite → `git submodule update --init` num clone novo
  falha. CLAUDE.md pede pin "por tag".
- Correção: mergear o satélite primeiro, re-pinar o core no SHA/tag da `main` do satélite antes
  de mergear o core.

## M1 — MENOR: (e) do guard é tautologia

- `classFeatLeakGuard.test.ts:171-182`: pega um feat cujo único traço é "psychic", constrói um
  Set sem "psychic" e afirma que o feat não está nele. É verdadeiro por construção, não depende de
  `isFeatEligible`. A mutação real foi feita à mão pela lane (e é o que vale); (b) já cobre a
  propriedade. Remover ou transformar em mutação real (vi.mock do módulo).

## M2 — MENOR (pré-existente, fora do guard testado): multi-classe quebra em `checkSlotRequirement`

- `planVM.ts:2241` (`traits.find((tr) => KNOWN_CLASS_TRAITS.has(tr))` + `!== planCtx.classSlug`).
- Cenário: Wizard nível 1 escolhe **Reach Spell** (traits `bard/cleric/concentrate/druid/…/wizard`)
  → o picker aceita (`isFeatEligible` usa `traits.includes`), mas o slot preenchido é marcado
  "WrongClass: Bard" porque o primeiro traço de classe é `bard`. Idem Widen Spell (druid primeiro)
  para Sorcerer/Witch/Wizard/Oracle; Familiar (magus primeiro) para Sorcerer/Thaumaturge/Wizard.
- O teste (d) da T0.2 só exercita `isFeatEligible`, então o segundo consumidor de
  `KNOWN_CLASS_TRAITS` ficou descoberto. Existe em `origin/main` (não foi introduzido pela onda),
  mas afeta metade dos conjuradores nível 1 da fatia. Confirmado por leitura (lógica
  determinística), não executado. Vira issue; correção é `traits.filter(...)` + `includes`.

## M3 — MENOR: pregen-parity (HP errado de Alchemist/Gunslinger/Commander) é invisível no CI

- `pregen-parity.test.ts:67,198,283…` usa `describe.skipIf(!VENDOR_AVAILABLE)`; no CI o vendor
  é gitignored → 31 skipped (log do run 35557899943). Localmente 22 vermelhos, incluindo HP de
  Commander L3/L5. O "CI verde" dos PRs #57/#65 não cobre isso. Registrado em #91; só sinalizo
  que CI verde ≠ HP certo para a ficha.

## (c) Asserções enfraquecidas — o que conferi

- Onda 0 (satélite): diff só adiciona 3 testes + allowlist + `export`. Nenhum expect removido.
- PRs #57/#65: `it.fails` para Summoner/Witch spellcasting (nomeado, #59 — ok, mas `it.fails`
  também fica verde se o teste quebrar por outro motivo); `PENDING_UNGROUPED_TRAITS_ISSUE_59`
  tira 28 traits do orçamento de 10% do bucket "Other" — inclui traits antigos e genéricos
  (`flourish`, `press`, `rage`, `finisher`, `magical`, `unstable`, `class`), não só vocabulário
  das classes novas; se algum desses já estava no "Other", a exclusão afrouxa o teto em silêncio.
  Contagens de importer (`totalAmbiguas` 61→118, actions 521→538) vêm com justificativa
  numérica. Nenhum `expectedRemainingGap` tocado.

## (d) Contratos

- `export const KNOWN_CLASS_TRAITS` exporta um `Set` mutável; nenhum consumidor fora do teste
  hoje (grep). Sem risco imediato.
- Contrato real quebrado: glossário do satélite × `TRAIT_NAMES_PT` do core (B2).
- Caminho de produção do resolvedor por nome conferido: `resolvePackIndex` usa `searchPack` sem
  limite (`shared/compendium.ts:675`), e o overlay pt-BR é anexado em `i18n`, o `name` fica EN →
  a conclusão da T0.3 (314/349 resolvem por nome) vale em produção.
