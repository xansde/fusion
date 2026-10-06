# O6 — Fixer, rodada 1

Worktree: `wt-o0` (core `ficha3/o6`, satelite `external/fusion-systems-2e` branch `ficha3/o6`).
Todos os 7 achados confirmados da revisão adversarial (`revisao-adversarial.md`) foram
consertados: 2 bloqueantes (C1, C2) e 5 importantes (C3, C4, C5, C6, C7).

## Tabela achado → commit → teste

| Achado | Severidade | Commit(s) | Teste que prova |
|---|---|---|---|
| **C1** — `levelledBoosts["1"]` recusado (BOOST_LEVEL_NOT_MILESTONE) | bloqueante | satélite `78d959d` (fix) + `61d04cb` (test) | `build-validation.test.ts` — "aceita levelledBoosts['1']" e "caps level-1 boosts at 4"; live: `prints-fix-r1/24-pos-concluido.png` + DB (`levelledBoosts.1 = [dex,con,wis,cha]`) |
| **C2** — descer de nível corrompe a ficha (choice/boost/feat acima do nível tratados como ilegais) | bloqueante | satélite `78d959d` (validador) + core `1d98e0b2` (existing/C3 propagado) + core `837682ff` (test) | `build-validation.test.ts` — descrição "leveling DOWN"; `player-character-create.test.ts` — "ALLOWS leveling down past a recorded choice/boost"; live: `prints-fix-r1/33-pos-descer-nivel.png` + DB (`level.value=1`, `build.choices` com `classFeat-2`@nível 2 dormente, item `Raging Thrower` ainda embutido) |
| **C3** — validar doc inteiro a cada update trava ator já ilegal | importante | core `1d98e0b2` | `player-character-create.test.ts` (indireto: a suite inteira depende do `existing` não travar edições subsequentes); ver docstring de `rejectIllegalCharacterBuild` |
| **C4** — checagem talento×slot inerte (`itemId` que o client nunca escreve); `system.build:null` desliga tudo | importante | satélite `78d959d` (resolução por `flags.fusion.build.slot`) + core `1d98e0b2` (embedded create/update + reject null) | `build-validation.test.ts` — seção "feat slot/category eligibility"; `player-character-create.test.ts` — "DENIES a skill-category feat...", "ALLOWS a skill-category feat...", "DENIES nulling out system.build"; live: `prints-fix-r1/30-classfeat2-confirmado.png` + DB (`flags.fusion.build` no item embutido) |
| **C5** — `doc:create` do player persiste `items[]` sem validar | importante | core `c3354f4d` (remove o caminho inteiro) | `player-character-create.test.ts` — "DENIES a plain player creating their OWN character via doc:create" |
| **C6** — exceção sem emissor no client, contradiz spec 05 (único endereço), sem teto | importante | core `c3354f4d` | idem C5; `user-character-creation.test.ts` (já existente, roda verde) prova que REQ-USR-025 continua a única porta |
| **C7** — gate não exercitou o builder | importante (processo) | n/a (evidência, não código) | Smoke ao vivo pelos DOIS papéis, servidor real (`data-o6`, porta 33062, build pós-fix): ver seção "C7 — smoke refeito" abaixo |

Commit de pin do submodule: core `ed775b43` (`external/fusion-systems-2e` → `61d04cb`).

## Detalhe por achado

### C1 — bloqueante
`build-validation.ts:257` só aceitava marcos múltiplos de 5. O Remaster PF2e dá 4 aumentos
livres em nível 1 (independente de ancestria/antecedente/classe — `planVM.
abilityBoostsSlotContext`, grupo `"levelled"` keyed `"1"`), e TODA ficha real grava
`levelledBoosts["1"]` ao concluir o diálogo de dádivas do nível 1. Fix: milestone válido é
`level === 1 || level % 5 === 0`.

### C2 — bloqueante
`levelSet` (planVM.ts) nunca podou `system.build.choices`/`levelledBoosts` acima do novo
nível ao descer (só retrai grants de classFeature via `flags.fusion.grantedSlot`) — desenho
deliberado do fixer r3/r4 da O0 para permitir subir de novo sem re-escolher. O validador
tratava esse estado dormente como ILEGAL (`CHOICE_LEVEL_EXCEEDS_CHARACTER_LEVEL`,
`BOOST_LEVEL_EXCEEDS_CHARACTER_LEVEL`, `FEAT_LEVEL_EXCEEDS_CHARACTER_LEVEL`), e como o
`updateScheduler` manda os ops do lote sem esperar o ack do primeiro, a ficha ficava com o
nível ANTIGO e os grants do nível NOVO já apagados. Fix: as três checagens "excede o nível
atual" foram removidas (choice, feat, boost) — o resto (DUPLICATE_SLOT, FEAT_SLOT_MISMATCH,
formato de milestone) continua de pé.

### C3 — importante
`rejectIllegalCharacterBuild` agora recebe o documento `existing` (antes do diff) e só recusa
issues que o diff introduz (`issues(merged) \ issues(existing)`, por `code|path`). Fecha o
cenário "ator já ilegal (import legado, edição manual) trava para sempre, até para o GM".

### C4 — importante
`chooseFeat` (planVM.ts) nunca escreve `itemId` na choice — só `{level, slot, type}`. O
vínculo real choice↔item vive no `flags.fusion.build` do PRÓPRIO ITEM. A checagem antiga
(`itemId === undefined → return`) era morta contra o client real. Resolvido por
`findItemByBuildSlot` (casa `item.flags.fusion.build.slot === choice.slot`). Como isso torna
`FEAT_SLOT_MISMATCH` vivo pela primeira vez, duas regras erradas (herdadas do client,
inofensivas enquanto mortas) foram corrigidas no mesmo commit para não virarem regressão nova
(companion necessário do C4, não scope creep): `classFeat` passa a aceitar traço `archetype`
(RAW: sem Arquétipo Livre, dedicação só cabe em slot de classe) e `generalFeat` aceita
`category: "skill"` (talento de perícia é subconjunto de talento geral). A checagem agora
roda também no caminho embutido (`handleEmbeddedCreate`/`handleEmbeddedUpdate`), a ÚNICA
porta real que autora item de personagem. `{"system.build": null}` (A6) também passa a ser
recusado quando o personagem já tinha build — fechava um bypass de duas escritas.

### C5/C6 — importantes
A exceção `O6/T6.1` que deixava um PLAYER criar o próprio Actor `character` via `doc:create`
foi REMOVIDA por inteiro (`isOwnCharacterDoc`, `authorizePlayerCharacterCreate`, o branch no
loop de create). Motivo: REQ-USR-025 (spec 05, emenda de 2026-08-16) já cria o personagem em
branco NA MESMA TRANSAÇÃO da conta, e a própria spec diz que esse é "o único endereço da
criação de personagem" — a exceção era redundante, inalcançável do client (nenhuma tela emite
esse `doc:create`) e, por nunca ser exercitada, deixava `items[]` arbitrário do payload
persistir sem NENHUMA das validações que o caminho embutido aplica (C5). Editar o próprio
personagem continua funcionando sem exceção nenhuma (OWNER check genérico + ownership forçada
pelo REQ-USR-025a).

### C7 — importante (processo)
Refeito ao vivo, servidor real, build pós-fix, pelos dois papéis — ver seção abaixo.

## C7 — smoke refeito (servidor real, build pós-fix, dois papéis)

Setup: `packages/server` buildado (`pnpm --filter @fusion/server build`, incluso no `pnpm
build` completo já rodado), servidor subido com `fusion serve --port 33062 --data-dir
scratchpad/data-o6 --world teste_xande` (cópia do `teste_xande`, já usada pela evidência da
lane original). Dois usuários novos criados PELA UI real de administração (Configurações →
Usuários, não CLI — a criação por CLI `fusion user add` usa `UserStore.create` direto e NÃO
passa pelo `AuthService.createUser`/REQ-USR-025, então não teria auto-criado o personagem;
achado à parte, fora do escopo C1-C7, não registrado como issue nova por não fazer parte da
fatia O6): `GmC7` (GAMEMASTER) e, pelo próprio GmC7 na tela de Usuários, `JogadorC7Fixer`
(PLAYER) — confirmado no banco que REQ-USR-025 criou o Actor automaticamente
(`flags.fusion.playerId`).

Passos exercitados, ambos os papéis, prints em `scratchpad/ficha3-reports/o6/prints-fix-r1/`:

1. **Como jogador** (`JogadorC7Fixer`): abre a própria ficha pela aba Contatos → builder
   mostra "Escolha uma classe" → escolhe Bárbaro → nível 1 mostra "Dádivas de Atributo" →
   abre o diálogo, escolhe 1 dádiva de classe (Força) + 4 dádivas livres de nível
   (Destreza/Constituição/Sabedoria/Carisma) → "Concluído" → **aceito, sem erro** (prints
   `21` a `24`). Confirmado no `world.db`: `abilities.levelledBoosts["1"] =
   ["dex","con","wis","cha"]`, `abilities.classBoost = ["str"]` — exatamente o payload que
   travava tudo antes do C1.
2. Sobe para nível 2 ("Subir de nível → 2"), escolhe "Talento de Classe" → "Arremessador
   Enfurecido" (feat nível 1, categoria class) → confirma → **aceito** (prints `26` a `30`).
   Confirmado no banco: `build.choices` ganha `{level:2, slot:"classFeat-2",
   type:"classFeat"}` e o item embutido carrega `flags.fusion.build = {level:2,
   slot:"classFeat-2"}` — prova que C4 valida (e aceita) o caminho embutido de verdade.
3. Entra em modo Editar, campo Nível: `2` → `1`, Tab (commit) → **aceito, sem toast de erro,
   sem travar** (print `33`). PV recalculado (26→13), nível do header vira "Nível 1".
   Confirmado no banco: `system.level.value = 1`, MAS `build.choices` ainda carrega o
   `classFeat-2` (nível 2) e o item "Raging Thrower" continua embutido — dormente, não
   apagado, exatamente o comportamento que C2 restaura (era essa mesma operação, com essa
   mesma choice em aberto, que travava tudo antes do fix).
4. **Como Mestre** (`GmC7`, papel privilegiado): abre a MESMA ficha pela aba Contatos →
   "Subir de nível → 2" → **aceito** (print `36`). O slot "Talento de Classe" do nível 2 já
   aparece PREENCHIDO com "Arremessador Enfurecido" sem nova escolha — o pick dormente
   sobreviveu à descida e voltou sozinho, confirmando que nada foi perdido (o mesmo tipo de
   perda de dado que o fixer r3/r4 da O0 já tinha fechado, e que C2 evita reabrir por outra
   via).

Nenhum erro de VALIDATION_FAILED, nenhum toast, nenhum congelamento em nenhum dos 4 passos —
o smoke que faltava no gate original agora cobre exatamente o cenário da regressão (subir,
escolher talento, descer, e o mesmo fluxo visto pelo Mestre).

Servidor encerrado ao final (`taskkill`, confirmado por `netstat` sem LISTENING). Sessões do
`playwright-cli` fechadas. Artefatos auto-nomeados que o `playwright-cli` grava por padrão em
`C:\Users\xansd\pessoal\fusion\.playwright-cli\` (árvore principal, fora do meu worktree) —
usados só como buffer intermediário — foram apagados ao final (removidos só os meus, por
timestamp; nada de outra sessão foi tocado). Os prints finais do relatório vivem só em
`scratchpad/ficha3-reports/o6/prints-fix-r1/`.

## Achados NÃO consertados (fora do escopo desta rodada, não confirmados)

C8 (menor) e C9 parte da "dedicação em slot de classe" já foram tratados como companion
necessário do C4 (ver acima) — não sobrou pendência aberta de C9. C8 (recusa no meio do lote
de `doc:create` deixa itens anteriores gravados sem broadcast) não estava na lista de achados
confirmados desta rodada (`C1`-`C7`) e não foi tocado.

## Pendências para issue

Nenhuma pendência nova gerada por este fixer. O único achado colateral (CLI `fusion user add`
não passa por `AuthService.createUser`, então não aciona REQ-USR-025) é preexistente, fora do
escopo da fatia O6 (ficha-nível-3) e não foi registrado como issue — citado aqui só para
constar por que a smoke da C7 optou por criar o usuário de teste pela UI, não pelo CLI.

## Verificação (rodada nesta ordem, todas verdes)

- `pnpm --filter @fusion/system-pf2e build` + `pnpm build` (core completo, inclui client) —
  exit 0.
- `pnpm typecheck` (14 projetos, incluindo `@fusion/server` e
  `external/fusion-systems-2e/systems/pf2e`) — 0 erros.
- `pnpm lint` (eslint .) — 0 erros (1 warning pré-existente, não relacionado).
- `pnpm lint:boundaries` (dependency-cruiser) — 0 violações, 5032 módulos.
- `pnpm format:check` (prettier) — todos os arquivos tocados formatados.
- `pnpm spec:report` — cobertura MVP com teste 710/710 (piso), sem regressão.
- Testes afetados:
  - `external/fusion-systems-2e/systems/pf2e/src/__tests__/build-validation.test.ts` — 23/23
    verdes.
  - `packages/server/src/__tests__/player-character-create.test.ts` — 12/12 verdes.
  - Varredura de regressão nos arquivos que tocam Actor/embedded/ownership (13 arquivos, 161
    testes): `actor-create-button`, `chat-generic-doc-path`,
    `compendium-import-to-actor(-server-rules)`, `doc-update-routing`,
    `documents(-concurrency)`, `embedded-item-actor`, `player-familiar-create`,
    `scene-tokens-embedded-create`, `token-actor-delta-hp-redaction-e2e`,
    `token-actor-validation`, `user-character-creation` — 161/161 verdes, nenhuma quebra.
  - Smoke vivo (C7) — ver seção acima.

## Commits

Satélite (`external/fusion-systems-2e`, branch `ficha3/o6`, pushado):
- `78d959d` — fix(system-pf2e): build só recusa boost/nível/slot reais (C1, C2, C4, C9)
- `61d04cb` — test(system-pf2e): reescreve build-validation para o formato real (C1, C2, C4, C9)

Core (`fusion`, branch `ficha3/o6`, pushado):
- `c3354f4d` — fix(server): remove doc:create do próprio personagem pelo jogador (C5, C6)
- `1d98e0b2` — fix(server): build só recusa issue nova, veda apagar system.build, valida
  embutido (C2, C3, C4)
- `837682ff` — test(server): player-character-create cobre C6 e C2/C3/C4
- `ed775b43` — chore(deps): atualiza pin do submodule (C1, C2, C4, C9)
