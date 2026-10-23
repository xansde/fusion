# O2 — Revisão adversarial, rodada 3

Alvo: satélite `f3d810d..e05a362` (5ef4cb8 N1, e05a362 N2) + core `bea5bc49` (pin = e05a362, confirmado via `git ls-tree`; e05a362 está em `origin/ficha3/o2`). Árvores limpas (exceto `tools/importer-pf2e/` não rastreado, pré-existente).

## N1 (bloqueante) — FECHADO
- `characterSheetVM.ts` agora agrupa por `bucketRank = (spellSystemIsCantrip(spSys) || spLevel===0) ? 0 : spLevel`. `spSys` vem de `_healSpellSystem`, então o traço é recuperado mesmo com cópia embutida magra.
- Sem o conserto, o código antigo fazia `spellsByRank.get(spLevel)` com `spLevel=1` para o Daze real; o slot "0" existe em `slotsRaw` com `spells: []`, logo `expect(rank0...).toContain("Daze")` falha. O teste lê o doc REAL do `spells-core` (não circular) e cobre a guarda de duplicata (`spells ∩ spellsKnown`) e a presença do heightening.
- Heightening: `_heighteningView(spSys, spLevel=1, "cantrip")` usa base 1, que é o modelo do pack (truque ranqueado 1, eleva por intervalo a partir do 1) — correto.
- Efeito colateral positivo: `prepareMenuSpells`/`grimoireSpells` pulam `isCantrip`, então um truque no grimório do Mago deixa de ser oferecido para espaço de 1º círculo pelo menu "Preparar do grimório" (o mesmo defeito do N2 pelo outro caminho).
- Rodado: `characterSheetVM.test.ts -t "Daze|resolveSpellPickerCantripOnly|spellcastingEntries"` → 16 passed / 0 falhas.

## N2 (importante) — FECHADO
- `SpellsTab.svelte:1333` passa `resolveSpellPickerCantripOnly(pickerMode, pickerIsCantripPick)`, e "prepare" devolve `false`. O teste sobre o `index.json` real mostra que `filterSpellPicker({maxRank:1, cantripOnly:false})` não traz truque nenhum e ainda traz magias de 1º círculo.
- Ligação no componente: conferida lendo o código (sem teste de componente, mesma lacuna declarada nas rodadas anteriores). `openPreparePicker` só é chamado a partir do laço de espaços ranqueados.

## Ataque ao diff — nada bloqueante ou importante
- Magias de foco usam o caminho `focusSpells` próprio (heightening "focus"), que o novo agrupamento não toca.
- Nenhum consumidor de `spellsKnown` no servidor ou no core (grep): não há validação no servidor que conflite com o truque de nível 1 em `slots.0`.
- O ramo `|| spLevel===0` é aditivo e mantém os dados/fixtures antigos com nível 0.

## Observação (fora do diff, não é achado da rodada)
- No preparado, a seção Truques lista como lançáveis TODOS os truques do grimório: não existe "preparar 5 truques do dia". O comportamento já existia com dados de nível 0, e a T2.3 não o nomeia no escopo. Agora ficou mais visível, porque os truques reais saíram do grimório de 1º círculo. Candidato a issue para a Onda de preparo, não para esta rodada.

Veredito: APROVADA.
