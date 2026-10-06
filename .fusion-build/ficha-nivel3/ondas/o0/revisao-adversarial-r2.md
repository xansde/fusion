# Revisão adversarial O0 — rodada 2

Alvo: satélite `ficha3/onda0` `88488c0` (N1) + `6bb0893` (C6); core `63cacfed` (re-pin).
Sem edição; testes rodados só nos arquivos afetados.

## Achados da r1

### N1 — FECHADO
- `modifiersFromItem` agora passa `predicate` por `evaluatePredicate` contra `computeKnownRollOptions` (só `self:armored`). Na leitura: antes do conserto não havia nenhum filtro de predicate, então o Monk de armadura recebia os +10 de Incredible Movement. Os casos novos de `derivations-speed.test.ts` (armado → 25, Swashbuckler sem panache → 25) falhariam sem o conserto. Rodei: 15/15 verdes.
- Varri os packs (todas as regras `flat-modifier` com seletor hp/land-speed/speed que têm predicate, 13 no total). Com o conserto:
  - Vivacious Speed fora de panache dá +5 (`not self:effect:panache`, metade arredondada). Isso é **correto pelo RAW**.
  - Stylish Combatant sem panache: 0.
  - Furious Footfalls, Laughing Shadow, Ligneous, Thousand-League Sandals, Rapid Response e Sanguine Tenacity ficam desligados. É a postura conservadora.
  - Desert Rat (`hands-free:2`) era aplicado incondicionalmente e agora fica desligado. É conservador, não é regressão contra o RAW.

### C6 — FECHADO (retração); a subida sem materialização está registrada
- `updateLevel` agora delega para `planVM.levelSet`, que retrai `grantedSlot classFeature:N` com N acima do novo nível. O teste novo (Monk 3→2 apaga o grant de nível 3) falharia com o código antigo, que devolvia um único `doc:update` sem delete. Rodei: 3/3 verdes.
- Ciclo de import: `planVM` importa `characterSheetVM` só como tipo. Não há ciclo em runtime.
- O gap de subir de nível pelo campo sem materializar os grants está na issue xansde/fusion-systems-2e#93 (confirmei que está OPEN). O heal-on-open fecha esse gap.

## Achados novos

### R1 — importante — digitar no campo de nível dispara retração e sincronia de slots destrutivas
- `CharacterSheet.svelte:820` usa `oninput={handleLevelInput}` com debounce de 400 ms. Antes, um valor intermediário só gravava o nível, sem efeito colateral. Agora cada valor intermediário vira o conjunto completo de ops do `levelSet`.
- Cenário: um Mago de nível 12 edita o nível para 10. O jogador apaga o "2", o campo fica em "1", e ele leva mais de 400 ms para digitar o "0". Nesse intervalo o conjunto de ops do nível 1 é enviado:
  - apaga todo `classFeature` concedido acima do nível 1. Só volta no próximo open da ficha;
  - `syncSlotMaxOp` põe o posto 1 no max do nível 1 e corta o array `prepared`. A magia preparada no slot excedente e o `expended` se perdem de vez, porque o heal não repõe preparo.
- O mesmo acontece com "12" → selecionar tudo → digitar "1", pausar, digitar "5".
- Conserto: trocar para `onchange` (commit no blur/Enter) no input de nível, ou só aplicar retração e sincronia de slots no commit. Teste: dois valores digitados em sequência com pausa maior que o debounce não podem emitir `doc:delete` nem truncar o `prepared` para o valor intermediário.

### R2 — menor — `self:armored` fica verdadeiro com armadura de categoria `unarmored`
- `computeKnownRollOptions` marca `self:armored` para qualquer item `armor` equipado. No PF2e, roupa de explorador (categoria `unarmored`) não conta como estar de armadura. `toEquippedArmor` ainda usa `unarmored` como categoria default.
- Cenário: um Monk que veste um item `armor` com `category: "unarmored"` perde Incredible Movement e fica em 25 em vez de 35. Hoje os packs não têm nenhuma armadura `unarmored` (só Elven Chain, light), então o caso só aparece com item criado à mão ou num import futuro.
- Conserto: exigir `category` diferente de `unarmored` para marcar `self:armored`.
