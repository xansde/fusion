# O6 — Re-verificação adversarial, rodada 1

Alvo: commits do fixer em `wt-o0` — satélite `78d959d`, `61d04cb`; core `c3354f4d`, `1d98e0b2`, `837682ff`, `ed775b43`.
Verificação rodada: `build-validation.test.ts` 23/23 verde, `player-character-create.test.ts` 12/12 verde.
Sonda contra o `dist` compilado do validador: `probe-r1/probe.mjs` (saída abaixo). Nada foi editado.

## Veredito por achado

| id | estado | evidência |
|---|---|---|
| C1 | FECHADO | O marco aceita `level === 1`, e o teto de 4 continua valendo. É o formato que o `planVM.ts:5296` grava (`levelledBoosts[String(level)]`, grupo "levelled" no nível 1, `:5237`). Teste "accepts levelledBoosts[\"1\"]" + P5 da sonda. |
| C2 | FECHADO | As três checagens `*_EXCEEDS_CHARACTER_LEVEL` foram removidas. O validador não lê mais `system.level`, então nenhuma op do `levelSet` (`characterSheetVM.ts:2537` → `planVM.ts:5574`) é recusada, e o lote não se desencontra. Smoke: print 33 (descida pelo campo Nível, que chama `updateLevel` → `levelSet`) e print 36 (o Mestre sobe de novo e a escolha dormente volta). **Efeito colateral: ver N1.** |
| C3 | FECHADO (resíduo menor, N2) | `rejectIllegalCharacterBuild(merged, existing)` só recusa issue nova. Mas a chave `code|path` usa o índice da choice (ver N2). |
| C4 | **ABERTO** | Ver abaixo. |
| C5 | FECHADO | A exceção de `doc:create` de character para PLAYER foi removida por inteiro (`c3354f4d`), então `items[]` arbitrário não chega mais ao store por esse caminho. Teste "DENIES a plain player creating their OWN character". |
| C6 | FECHADO | Remoção + decisão registrada (commit e `fix-r1.md`): o REQ-USR-025 (spec 05) é o único endereço, e o jogador cria o personagem ao construir o ator em branco que nasce com a conta. Pela spec 05, a decisão está certa e não corta a T6.1, porque a edição do próprio ator continua funcionando pelo check de OWNER. |
| C7 | FECHADO | Smoke refeito pelo builder: jogador (classe, aumentos do nível 1, subir, talento de classe, descer) e Mestre (subir de novo). Prints 21–36 em `prints-fix-r1/`, conferidos o 33 e o 36. |

## C4 — continua ABERTO (importante)

O conserto passou a resolver o item pelo `flags.fusion.build.slot`, mas o validador **continua iterando as choices**
(`checkChoices`), e não os itens. Só que o slot na ficha é preenchido **pelo item**, não pela choice:
`planVM.resolveSlot` (`planVM.ts:1972-1995`) marca o slot de talento como `filled` quando existe um item embutido
com `flags.fusion.build = {level, slot}`, com choice ou sem.

- Cenário 1 (bypass em 1 op): o jogador faz `doc:create` embutido de um talento de ancestralidade com
  `flags.fusion.build = {level:2, slot:"classFeat-2"}` e não escreve choice nenhuma. O validador retorna `ok:true`
  (P2 da sonda), e o talento aparece no slot "Talento de Classe" do nível 2.
- Cenário 2 (o próprio fluxo do client): o `chooseFeat` (`planVM.ts:4400-4420`) manda PRIMEIRO o `doc:create` do
  item e DEPOIS o `doc:update` das choices. O create passa, porque a choice ainda não existe, e o item
  persiste. O update das choices é recusado, mas o talento ilegal já ocupa o slot. O próprio teste do servidor
  "DENIES a skill-category feat filed into the ancestryFeat slot" mostra isso: o `embedAck` é `ok:true`, e só
  a choice é recusada. A recusa não impede o estado ilegal. Ela só deixa item e choice dessincronizados.
- Conserto: validar a partir dos itens embutidos que têm `flags.fusion.build.slot` e inferir o tipo pelo prefixo
  do slot (`<type>-<level>`, a convenção de `resolveSlot`/`axisChoiceNames`), com a choice como fonte
  secundária. Assim o `handleEmbeddedCreate` recusa o item no ato. Teste: create embutido do talento com o slot
  errado, sem choice, deve voltar `VALIDATION_FAILED` e não persistir nada.

## Achados novos no diff do conserto

### N1 — importante: o conserto do C2 tirou TODA a checagem de nível do talento (corte de escopo da T6.2)
- Onde: `build-validation.ts`, o bloco `FEAT_LEVEL_EXCEEDS_CHARACTER_LEVEL` foi removido e nada entrou no lugar.
- A T6.2, pela entrega registrada em `T6.1-T6.4.md:35`, checava "nível do talento/escolha". Comparar com o nível
  **atual** do personagem estava errado por causa da descida. A regra do PF2e é outra: um talento só cabe num slot
  do nível dele ou acima (`feat.level <= nível do slot`). Esse invariante não muda quando o personagem desce de
  nível, então não reabre o C2.
- Cenário (P3 da sonda): um personagem de nível 1 com um talento de classe de nível 20 em `classFeat-1` recebe
  `ok:true`. Uma op montada à mão persiste esse talento.
- Conserto: `itemSys.level <= flags.fusion.build.level` (ou `choice.level`), com um código novo, por exemplo
  `FEAT_LEVEL_EXCEEDS_SLOT_LEVEL`. Teste: talento de nível 4 em `classFeat-2` é recusado. Talento de nível 2 em
  `classFeat-2` de um personagem que desceu ao nível 1 é aceito.

### N2 — menor: a diferença "issue nova" do C3 usa o índice como chave
- A chave `code|system.build.choices[i]` muda quando a lista é reordenada. O `chooseFeat` sempre filtra o slot e
  **anexa no fim**, então re-escolher qualquer talento que esteja antes da choice ilegal desloca o índice dela.
- Cenário (P4 da sonda): uma issue preexistente em `choices[2]` passa para `choices[1]` depois de uma
  re-escolha anterior. O servidor a trata como nova e recusa o update das choices. Enquanto isso, o create e o
  delete do mesmo lote passam, o que desencontra de novo item e choice num ator que já era ilegal.
- Conserto: usar como chave `code|slot` (ou o conteúdo da choice), e não o índice.

### N3 — menor: `system.build` não nulo e não objeto continua desligando o validador
- O `rejectCharacterBuildDeletion` só recusa o `null`. Um diff `{"system.build": "x"}` (ou `0` ou `false`) passa, e
  depois disso o `validateCharacterBuild` é no-op (P6 da sonda). O efeito prático é pequeno enquanto o C4 estiver
  aberto, porque o bypass do cenário 1 já dispensa esse caminho.
- Conserto: recusar qualquer `system.build` que não seja objeto quando o existente é objeto.

## Saída da sonda (`probe-r1/probe.mjs`)
```
P1 with choice: ["FEAT_SLOT_MISMATCH"]
P2 no choice: {"ok":true,"issues":[]}
P3 lvl20 feat in lvl1 slot: {"ok":true,"issues":[]}
P4 before: [ 'FEAT_SLOT_MISMATCH|system.build.choices[2]' ] after: [ 'FEAT_SLOT_MISMATCH|system.build.choices[1]' ]
P5: []
P6 build string: {"ok":true,"issues":[]}
```

## Não achados (verificados)
- A regra do C9 (dedicação em `classFeat`, talento de perícia em `generalFeat`) está certa pelo Player Core e não
  deixa o servidor mais duro do que a regra.
- A validação no create e no update embutidos só roda quando o pai é `character`. NPC, hazard e loot não são afetados.
- `ed775b43` só move o pin do submódulo. É o estado normal antes do merge e não conta como achado.
