# Evidência viva — Onda 4b (Aparições do Animist fazem efeito)

Servidor: `data-o4b` (fora da worktree), mundo `teste_xande` (cópia), porta 33044.
Worktree: `wt-d` (branch `ficha3/o4b`, HEAD `bb7fe458`), já buildada — nada foi
alterado em código de produção nesta lane, só operação de servidor/browser.
Ator: `Fixer_o4b_r2` (`yxiqCQJpCfpCsX5Q`), Animist nv3, já existente no mundo copiado
(criado por uma rodada de fixer anterior). Login como GM (`Gamemaster`, sem senha).

## O que foi provado (nível Vivo + Olhado)

1. **Animist nv1 tinha só 1 das 2 Sintonias de Aparição escolhidas** (`Crafter in the
   Vault`) — o segundo slot "Sintonia de Aparição" (nv1) aparecia vazio na coluna Plano.
   Print `01-magias-antes-2a-aparicao.png` (aba Apparition Spells só com o repertório do
   Crafter: truque Sigilo, Patamar 1 Mending, Patamar 2 Knock) e
   `02-foco-vessel-crafter-in-the-vault.png` (Foco: vessel "Oficina Itinerante" / Traveling
   Workshop, 0/1 ponto).

2. **Picker da 2ª Sintonia de Aparição** — print `03-picker-2a-aparicao.png`: lista as 11
   aparições do vendor (Crafter, Custodian, Echo, Impostor, Lamentation, Lurker, Monarch,
   Reveler, Shepherd, Speaker, Witness), cada uma com nível, skills, lista de magias por
   patamar e vessel spell. Escolhido **Custodian of Groves and Gardens** e confirmado.

3. **Escolher a 2ª aparição muda a ficha de verdade** — print
   `04-magias-depois-2a-aparicao.png`: coluna Plano mostra as DUAS Sintonias com ✓
   (Crafter in the Vault + Custodian of Groves and Gardens); aba "Apparition Spells" passa
   a ter DOIS truques (Sigilo do Crafter + Videira Emaranhada/Tangle Vine do Custodian) —
   confirma que o repertório de truques soma as duas aparições automaticamente.

4. **Perícia/Lore das duas aparições visível** — print `06-pericias-lore-2-aparicoes.png`:
   aba Perícias lista Saber (Architecture)/Saber (Engineering) [Crafter] e Saber
   (Farming)/Saber (Herbalism) [Custodian], todas treinadas (T).

5. **Confirmado no DADO DO ATOR (servidor/banco, não só na UI)** — query direta em
   `world.db` (`packages/server`, `better-sqlite3`) no ator `yxiqCQJpCfpCsX5Q`:
   - `system.build.choices` tem `apparition-1-0` e `apparition-1-1` preenchidos, mais os 4
     `apparitionLore-*` (architecture/engineering/farming/herbalism).
   - Item `Apparition Spells` (spellcastingEntry, tradição divina, espontâneo) com slots
     `{0: max 2, 1: max 1, 2: max 1}` — bate com `ANIMIST_APPARITION_SLOTS_BY_LEVEL` no
     nível 3 (truques ilimitados/elevados, 1 de patamar 1, 1 de patamar 2).
   - Itens de magia no ator: `Sigil, Traveling Workshop, Knock, Tangle Vine, Mending` —
     união dos repertórios das duas aparições + a vessel spell do Crafter (primária).

6. **Trocar UMA aparição troca o repertório** — removida `Custodian of Groves and
   Gardens` e escolhida `Echo of Lost Moments` no lugar (prints
   `09-picker-troca-echo-of-lost-moments.png` e `10-magias-apos-troca-echo.png`):
   - Cantrip do Custodian (Videira Emaranhada) some, cantrip do Echo (Fantasma) aparece.
   - Lore skills trocam de Farming/Herbalism para **Fortune-Telling/Genealogy**
     (confirmado no `world.db`: `apparitionLore-2`/`apparitionLore-3` mudaram de skill).
   - Patamar 1 ganha "Déjà Vu" (rank1 do Echo) além do Mending que eu tinha re-adicionado
     manualmente — ver Pendência P1 abaixo (o slot deveria ter max 1, não 2).

7. **Nível 3 com slots/repertório de nível 3** — o próprio ator já estava em nível 3 no
   momento do teste (Plano mostra Nível 1/2/3 preenchidos); a aba Apparition Spells sempre
   mostrou Patamar 1 **e** Patamar 2 disponíveis (slots do nível 3), nunca só Patamar 1.
   Print `08-plano-2-aparicoes-nv3.png`.

8. **Reload mantém tudo** — `playwright-cli reload` no meio do teste (após confirmar a
   2ª aparição): sessão do GM permaneceu autenticada, ator reaberto mostra as mesmas duas
   Sintonias com ✓ e o mesmo repertório (Sigilo + Videira Emaranhada, Mending, Knock) sem
   nenhuma ação adicional. Print `07-magias-apos-reload.png`.

Todos os prints em
`C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-pessoal-fusion/00fac927-00b8-4b98-a337-d71694dff4dc/scratchpad/ficha3-reports/o4b/prints/`
(nomeados `01`…`10` desta lane; os arquivos `r2-*`/`00-`/`0X-*` sem esses nomes são de uma
rodada de fixer anterior, deixados no mesmo diretório).

## Pendências encontradas nesta lane (registrar como issue, não consertar)

### P1 — Slot de repertório excede o `max` quando magia manual convive com auto-materialização
**Cenário concreto:** ator nv3 com 2 aparições atuneadas, Patamar 1 com `max: 1`. Eu
removi manualmente a magia auto-gerada (Mending) e a readicionei pela lista completa
("+ Adicionar magia conhecida" → picker genérico, não filtrado — ver P2). Depois troquei
a 2ª aparição de Custodian para Echo of Lost Moments. O `materializeApparitionSpells`
auto-adicionou "Déjà Vu" (rank1 do Echo) ao slot, resultando em
`slots["1"] = {value: 1, max: 1, spellsKnown: ["Mending_id", "DéjàVu_id"]}` — **2 magias
conhecidas num slot de max 1**, confirmado direto no `world.db`. A UI reflete isso: aba
Apparition Spells mostra as duas com "Repertório completo neste patamar." mesmo estando
sobre a capacidade. Repo: `xansde/fusion-systems-2e`.
- Título sugerido: `fix(pf2e): Apparition Spells excede o max do slot quando magia manual sobrevive à troca de aparição`
- Corpo: descrever o cenário acima (ator `Fixer_o4b_r2` do mundo `teste_xande`, patamar 1
  ficou com Mending + Déjà Vu contra `max: 1`), apontar `materializeApparitionSpells` em
  `PlanColumn.svelte` como suspeito (não reconcilia contra `spellsKnown.length > max`
  quando o item já foi editado manualmente antes da troca).

### P2 — "+ Adicionar magia conhecida" não filtra pela lista de magias da(s) aparição(ões)
**Cenário concreto:** com Crafter in the Vault + Custodian of Groves and Gardens
atuneados, cliquei "+ Adicionar magia conhecida" no Patamar 1 da entrada Apparition
Spells — o diálogo (`Adicionar magia — Apparition Spells (Divina)`) lista **toda a lista
de magias divinas de patamar 1** (Admonishing Ray, Air Bubble, Alarm, Command, Create
Water, Fear, Harm, Heal, etc. — nada específico do Crafter/Custodian), não só as magias
da(s) aparição(ões) atuneada(s) (que seriam, por RAW, Mending para Crafter e Protector
Tree para Custodian). Print `05-adicionar-magia-lista-nao-filtrada.png`. Isso permite ao
jogador escolher magias fora da lista de aparição, o que é dado errado pela regra do
Animist remaster (repertório restrito à(s) aparição(ões)). Repo:
`xansde/fusion-systems-2e`.
- Título sugerido: `fix(pf2e): picker de "Adicionar magia conhecida" da Apparition Spells não filtra pela lista das aparições atuneadas`
- Corpo: citar o cenário acima e que a fonte de verdade da lista por aparição já existe
  (usada no preview do picker de Sintonia de Aparição, print `03-picker-2a-aparicao.png`)
  — o picker de "adicionar magia conhecida" deveria reusar essa mesma lista como filtro
  em vez do catálogo completo da tradição divina.

### P3 — Confirma issue #115 (16 magias de aparição faltando em spells-core) com caso concreto
Ao tentar (antes de descobrir P2) achar "Protector Tree" (rank1 do Custodian of Groves
and Gardens) no picker de adicionar magia, ela **não aparece em nenhuma página da lista**
(busquei também por "Árvore"/"Proteg" sem resultado). Isso é consistente com a issue
#115 já aberta (16 magias de aparição faltando em `spells-core`) — não abro issue nova,
só registro o caso concreto (`Protector Tree`, aparição Custodian of Groves and Gardens)
para quem for fechar a #115 ter mais um dado de teste.

## O que NÃO foi tocado / fora do escopo desta lane
- Reseleção da aparição primária, reescolha diária, issues #101/#110/#119 — inalterados,
  conforme já registrado em `tasks.md` (T4.4).
- Nenhum código de produção foi editado; nenhum commit feito nesta lane (só operação de
  servidor/browser/leitura de banco).
- `docs/design/ficha-nivel3/gate-runbook.md` não precisou de correção — o passo a passo
  funcionou como documentado (login sem senha para Gamemaster/Tobias, `--port` override
  funcionando mesmo com `fusion.json` tendo outro `port` gravado).

## Encerramento
Servidor parado (`taskkill //PID 9320 //F`, PID achado via `netstat -ano | grep ":33044"`
depois de fechar a sessão do playwright-cli); porta 33044 confirmada livre após o kill.
Nenhuma alteração no `~/.fusion` real; mundo copiado fica em
`.../scratchpad/data-o4b/worlds/teste_xande` (fora da worktree, conforme runbook).
