# r25 — handoff: a ficha-alvo do Pathbuilder, e como paralelizar o resto

> Escrito em 2026-08-08 para sobreviver a um `/compact` e servir de briefing a
> agentes em paralelo. **É auto-contido de propósito**: os relatórios de r21–r24
> (`.fusion-build/r2*/`) NÃO são versionados, então uma worktree nova não os vê.
> Tudo que um agente precisa saber está aqui.

---

## 1. O objetivo, em uma frase

O dono quer **cadastrar uma ficha inteira** no Fusion. A ficha é um export real do
Pathbuilder 2e: **Fofurinha, Elfo (Ancient Elf) Gunslinger do Way of the Spellshot,
nível 1, com Psychic Dedication concedida pela herança**. Ela está commitada em
`packages/client/src/lib/sheets/pf2e/__tests__/fixtures/pathbuilder-fofurinha.json`.

Não é uma ficha qualquer: ela usa quase tudo que o Fusion ainda não modela — classe
fora das 12 curadas, arquétipo no nível 1, conjuração vinda de arquétipo e arma de
fogo. É por isso que ela vale como alvo.

## 2. Onde o trabalho está

| | |
|---|---|
| worktree | `.../8b1b0fd2-.../scratchpad/wt-ficha-fofurinha` |
| branch | `feat/ficha-alvo-fofurinha` |
| base | **`origin/build/app`** (HEAD `2947afb`) |
| commits | `f933c48` catraca · `4cc46fd` Smuggler autoral |

**Não baseie em `main`.** A `main` não tem o `helpers/classBuildHarness.ts` nem a
`pregen-parity.test.ts` — o B0 não chegou lá. `build/app` está 52 commits à frente.

### Reproduzir o ambiente numa worktree nova (4 passos, nenhum óbvio)

```bash
git fetch origin
git worktree add <path> -b <branch> origin/build/app
cd <path> && pnpm install --prefer-offline
# OBRIGATÓRIO: o harness de teste alcança systems/pf2e/src/index.ts, que importa
# @fusion/system-api por dist/. Worktree nova não tem dist/ — sem isto o teste
# morre com "Failed to resolve entry for package @fusion/system-api".
pnpm --filter @fusion/shared --filter @fusion/system-api --filter @fusion/engine-2e build
```

Para rodar o importer de packs (`tools/importer-pf2e`), `out/` e `vendor/` são
gitignored e não vêm na worktree. **Não reclone os 615 MB do Foundry** — ligue por
junction à árvore principal (PowerShell):

```powershell
New-Item -ItemType Junction -Path <wt>\tools\importer-pf2e\out    -Target C:\Users\xansd\pessoal\fusion\tools\importer-pf2e\out
New-Item -ItemType Junction -Path <wt>\tools\importer-pf2e\vendor -Target C:\Users\xansd\pessoal\fusion\tools\importer-pf2e\vendor
```

`tools/translate-packs/out/` também não existe na worktree: `mkdir -p` antes de
rodar `node src/qa.mjs`, ou ele varre tudo certo e só explode ao gravar o relatório.

## 3. O portão: a catraca da ficha-alvo

`packages/client/src/lib/sheets/pf2e/__tests__/pathbuilder-fofurinha.test.ts`

```bash
cd packages/client && pnpm vitest run src/lib/sheets/pf2e/__tests__/pathbuilder-fofurinha.test.ts
```

É a **terceira fonte externa de verdade** do projeto. A primeira (`varredura-classes`)
compara a derivação com a tabela do próprio pack — não pode falhar quando a tabela
está incompleta, e foi assim que 80 testes verdes conviveram com 60 defeitos
(issue #48). A segunda (`pregen-parity`) usa as pregens da Paizo. Esta usa a ficha
que a mesa quer jogar.

**Como a catraca funciona:** `LACUNAS` é a baseline medida. O teste calcula as lacunas
observadas e assere **igualdade de conjunto** — então reprova nas duas direções:

- lacuna nova aparece → vermelho (regressão)
- lacuna listada deixou de existir → vermelho (**apague a entrada**; a baseline só encolhe)

Ou seja: **quem fechar um bloco tem que editar `LACUNAS` no mesmo commit.** É o
contrato de coordenação entre agentes paralelos — o teste é o único lugar onde o
progresso de todos se encontra.

Hoje: **11 entradas** (eram 12; o Smuggler saiu em `4cc46fd`).

## 4. Os blocos, e a superfície de arquivo de cada um

### Bloco 1 — Gunslinger e Psychic nunca foram curadas
**Lacunas:** `classes-core/Gunslinger`, `class-features-core/{Gunslinger's Way,
Slinger's Precision, Way of the Spellshot, The Oscillating Wave}`,
`feats-core/{Munitions Crafter, Psychic Dedication}` — 7 das 11.

`classes-core` tem 12 classes; a curadoria vive em
`tools/importer-pf2e/src/curation/classes/*.json` (12 arquivos, 55–530 linhas).
As duas classes existem no vendor (`out/classes/normalized.json` tem 27).
A Psychic é necessária **só** pela cadeia do arquétipo (`Psychic Dedication`,
`Basic/Expert/Master Psychic Spellcasting`) — não pela classe em si.

**Superfície:** `curation/classes/{gunslinger,psychic}.json` + `build-mvp-subset.mjs`
+ rebuild de packs.

### Bloco 2 — a rota do arquétipo no nível 1 está fechada por DOIS portões independentes
**Lacunas:** `regra:dedicacao-nao-cabe-em-slot-de-classe`, `regra:ancient-elf-choiceset-inerte`.

1. `planVM.ts` — `isFeatEligible`, caso `classFeat`: `if (traits.includes("archetype")) return false`.
   Pela regra do PF2e **dedicação consome slot de talento de classe**. O slot de
   `archetypeFeat` só nasce em nível **par** e só com Free Archetype ligado, então
   hoje não existe rota nenhuma para uma dedicação no nível 1.
2. O `ChoiceSet` do `Ancient Elf` chegou marcado `_conversionState: "unsupported"`, e
   o `grant-item` dele aponta para `{item|flags.system.rulesSelections.ancientElf}` —
   flag que ninguém preenche. **A herança não concede nada.** Ela também precisa
   furar o pré-requisito de nível (`Psychic Dedication` é nível 2).

**Superfície:** `planVM.ts` + `grantMaterializer.ts`. **Contestada — ver §5.**

### Bloco 3 — conjuração vinda de arquétipo não existe
A `spellcastingEntry` só nasce de `classSystem.spellcasting`; os slots são cravados
como `class:spellcasting` e `class:focus` (`planVM.ts`, ~2846–2898 na base). Uma entry
occulta espontânea por Carisma, só com truques, vinda de uma dedicação, não tem de
onde nascer. Idem o pool de foco do truque `Ignition (Archetype)`.

**Superfície:** `planVM.ts` + `characterSheetVM.ts`. **Contestada — ver §5.**

### Bloco 4 — arma de fogo, e proficiência por arma
**Lacuna:** `conteudo:weapons-core/Slide Pistol`.

`weapons-core` tem 30 armas, todas corpo-a-corpo/arco; o vendor tem **106 firearms**.
E o "Expert só na Slide Pistol" não tem onde morar: a proficiência de arma é **só por
categoria** (`unarmed/simple/martial/advanced`) em
`systems/pf2e/src/schemas/actor-character.ts` — não há rank por arma nem por grupo.
`reload` já existe no schema de arma como string, sem mecânica.

**Superfície:** publicação em `weapons-core` (packs) + `actor-character.ts` +
`derivations/`. **Disjunta de `planVM.ts`.**

### Bloco 5 — Smuggler ✅ FECHADO (`4cc46fd`)
Primeiro **documento autoral** do projeto: não existe em nenhuma das três bases
canônicas (vendor Foundry, índice `aon` do AoN com seus 73 antecedentes de LO:WG,
Pf2eTools). Injetado por `SMUGGLER_AUTHORED_DOC` em `build-mvp-subset.mjs`, com
`conversion: "authored"` e `sourceId` sintético estável. É o **padrão a seguir** para
qualquer conteúdo que precise ser escrito à mão.

Não dava para substituir pelo vizinho `Black Market Smuggler`: mesmo livro, mesmas
perícias, mesmo talento, mas par de dádivas Carisma|Sabedoria em vez de
Destreza|Carisma — e a dádiva de Destreza do antecedente é o que produz **Dex 19** no
nível 1 (a quinta dádiva cai sobre um 18 e vale +1). Com o vizinho, a mesma build
para em Dex 17: outro personagem, em silêncio.

### Achado avulso — Low-Light Vision não existe em pack nenhum
**Lacuna:** `conteudo:ancestry-features-core/Low-Light Vision`.
O sentido próprio do Elfo não tem documento — nem em `ancestry-features-core` (55
docs), nem em lugar algum. Atinge **toda** ancestralidade com visão na penumbra, não
só essa ficha. Independente de todos os blocos.

## 5. Mapa de paralelização (leia antes de fanout)

**Duas lanes, e uma delas é serial.**

```
LANE A (paralela)          LANE B (SERIAL — mesma superfície)
Bloco 1 curadoria          Bloco 2  → planVM.ts + grantMaterializer
Bloco 4 schema/derivação   Bloco 3  → planVM.ts + characterSheetVM
Low-Light Vision           (Bloco 3 depende do Bloco 1: sem Psychic Dedication
Champion level:0                     no pack não há o que asserir)
```

Três regras que não são negociáveis:

1. **`planVM.ts` é o gargalo do repo** (~5.2k linhas na base, +227 em voo por outra
   sessão). Blocos 2 e 3 mexem nele de forma incompatível: **rodam em sequência,
   nunca em paralelo.** É a mesma disciplina do plano de batches da r24.
2. **Uma reconstrução de pack por vez.** `node tools/importer-pf2e/src/build-mvp-subset.mjs`
   regenera **todos** os 14 packs. Dois agentes rodando isso ao mesmo tempo (ou em
   worktrees diferentes, com merge depois) colidem em `documents.json`. O padrão certo
   para o fan-out de conteúdo: cada agente entrega **insumo de curadoria** (arquivo
   JSON de curadoria + código de injeção) e **um único integrador** roda o build.
3. **Não escreva no arquivo que outro agente está escrevendo.** Edição concorrente não
   faz merge, faz rollback silencioso — o `system-reminder` de "arquivo modificado"
   chega ao subagente como pedido de origem desconhecida e ele reverte a edição.

## 6. Armadilhas já pagas (não pague de novo)

- **Tem outra sessão viva na árvore principal.** Durante esta sessão ela trocou de
  branch duas vezes (`fix/portas-dinamicas-testes` → `build/app` → `fix/antecedente-pericias`)
  e está extraindo `loreSlug` de dentro do `planVM.ts` para um módulo próprio
  (`./loreSlug.ts`, "contrato C3"). Enquanto esse módulo não existir no disco,
  **toda suíte que importa `planVM.ts` está vermelha** na árvore principal. Trabalhe
  em worktree; não crie `loreSlug.ts` (é dela).
- **`packs-validation` JÁ está vermelho na `build/app`**, e não é de ninguém desta
  linha de trabalho: `Blessed Armament` e `Blessed Shield` (Champion) vêm com
  `system.level: 0` e o schema exige `>= 1`. 1 falha em 114. Provado com as mudanças
  de pack guardadas num stash: mesma falha no HEAD limpo. **Não confunda com dano
  próprio** — e vale uma issue.
- **O separador do `sourceHash` do overlay i18n é um NUL literal.** Ferramenta de texto
  exibe como espaço; copiar a olho produz **100% de falso "defasado"**. Sempre importe
  `i18nSourceHash` de `tools/translate-packs/src/hash.mjs` em vez de reimplementar.
- **`build-report.json` mentia**: declarava 259 class-features quando o pack tem 262.
  Corrigido em `4cc46fd`. Não decida escopo lendo esse arquivo sem conferir o
  `documents.json`.
- **O rebuild de packs é idempotente no conteúdo** (nenhum `documents.json` muda) mas
  suja 24 arquivos com `generatedAt` novo. **Não** briga com o Format check —
  `systems/pf2e/packs/**` está no `.prettierignore`. Restaure o que não for seu antes
  de commitar.
- **Schema do servidor apaga campo não declarado** (`.extend()` sem `.passthrough()`).
  Campo novo no `@fusion/shared` tem que ser declarado no schema do servidor também,
  **importando** o schema compartilhado, nunca uma segunda cópia.
- **Nunca hardcode porta em teste** — use `packages/server/src/__tests__/helpers/ports.ts`.
- **Testes do server**: pool `forks`/maxForks 4. "Timeout calling onTaskUpdate" sem
  teste falhando = flakiness de infra sob carga; re-rode o arquivo isolado.

## 7. O waybuilder do Igor — o que puxar de lá

`https://github.com/igoresramos/waybuilder` (Python + um porte TS). **O dono liberou
o uso** (2026-08-08, o Igor ofereceu o repo pessoalmente); o repo não tem `LICENSE`,
então vale pedir a ele que adicione uma para deixar registrado.

A base canônica dele (`pipeline/base/index.json`, **19.961 registros em 58 kinds**,
construída de foundryvtt/pf2e + Pf2eTools + AoN) tem **tudo** que essa ficha cita, e
resolve por design três dos nossos quatro problemas:

| Nosso bloco | O que existe lá |
|---|---|
| 1 | `wb:class/gunslinger` com `key_ability:["dex"]`, eixo `way` (6 opções, Way of the Spellshot entre elas) e `progressao` de 18 entradas. 27 classes, 1.032 armas, 6.011 equipamentos, 514 antecedentes, 326 heranças, 243 arquétipos |
| 2 | `wb:heritage/ancient-elf` com o ChoiceSet **já convertido**: `{choice:{flag:"ancientElf", filtro:["item:category:class","item:trait:dedication","item:trait:multiclass"], tipo:"feat"}}`. Mais `motor/testes/test_free_archetype.py` e 8 fixtures de dedicação |
| 3 | `specs/2026-07-29-spellcasting-de-arquetipo.md` (aprovada) + `wb:feat/psychic-dedication` **mecanizada**: `grant_spellcasting:{tradicao:"occult", tipo:"spontaneous", cadeia:"wb:archetype/psychic", degraus:{basic,expert,master}}` |
| 4 | `specs/2026-07-30-proficiencia-de-arma-nomeada.md` — remap de categoria com gramática medida (4 seletores cobrem 83,5% das 91 ocorrências). `wb:weapon/slide-pistol` completo: `group:"firearm"`, `reload:"1"`, d6 P, alcance 30 |
| — | Os **28 eixos de sub-escolha viraram kinds de primeira classe** (`way` 11, `conscious-mind` 6, `instinct` 10, `bloodline` 18, `doctrine` 3, `divine-font` 2, `cause` 7, `muse` 5…). É a nossa issue #59 |
| — | `validar_iconics.py`: **117/129 (91%)** contra as pregens da Paizo — a correção que a r22 recomendou para a #48, já implementada |
| — | `app/src/motor/personagem.ts` — **212 KB de TypeScript**, mesma linguagem que a nossa |
| — | `motor/comparar_pathbuilder.py` + `app/verificacao/sonda-pathbuilder.mjs` — interop com Pathbuilder já iniciada |

**O que NÃO copiar sem ler:** as 18 issues abertas dele avisam — **#3** 56% das
class-features com `grants` vazio; **#10** eixos de sub-escolha tortos em 11 das 27
classes; **#4** feats `universal-ancestry` sumidos do slot e heranças versáteis
ausentes; **#5** markup do Foundry vazando cru em 1.229 registros (aqui o Fusion está
na frente); **#15** **a base dele está em inglês** e o Fusion tem pt-BR 100%. Só 3.840
dos 19.961 registros (19%) são `mechanized`.

**Estratégia recomendada:** puxar os **registros pontuais** desta ficha traduzindo
para pt-BR na entrada, e portar as **duas specs** como REQ do Fusion (é design — a
parte caríssima de refazer). Não importar a base em bloco: dá cobertura e regride
tradução.

Contrapartida já pedida por ele: a issue **#18** do waybuilder é reaproveitar a
tradução pt-BR do Fusion (2.311 docs + glossário).

## 8. Fora de escopo por decisão do dono (2026-08-08)

Moedas e XP (não há campo no ator de personagem), o item `Kit de Faca` (custom do
Pathbuilder, não é conteúdo publicado), as perícias só-de-SF2e que o export sempre
emite (`piloting`/`computers`) e `dualClass` (variante não implementada).

## 9. Ordem sugerida

1. **Bloco 1** — destrava classe, Way e a cadeia da dedicação de uma vez; é
   pré-requisito real do Bloco 3.
2. **Bloco 4** e **Low-Light Vision** e **Champion `level:0`** — em paralelo com o 1,
   superfícies disjuntas (mas veja a regra da reconstrução única de pack).
3. **Bloco 2**, depois **Bloco 3** — serial, no `planVM.ts`, só depois que a sessão
   do Lore assentar.

Cada bloco que fecha: apague a entrada de `LACUNAS`, rode a catraca, commite junto.
