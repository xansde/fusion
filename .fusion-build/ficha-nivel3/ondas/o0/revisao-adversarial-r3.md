# Revisão adversarial O0 — rodada 3

Alvo: satélite `4a41939` (fix R1) + core `b2bf41a1` (pin confere: `external/fusion-systems-2e` -> 4a41939).

## R1 — FECHADO (no seu escopo literal)
- `CharacterSheet.svelte:421`: `oninput` -> `vm.updateLevelDraft`, que só emite o dual-write `system.level.value`/`system.details.level` (sem `doc:delete`, sem sync de slot). Valor intermediário ("1" no caminho 12->10) não gera mais op destrutiva, com ou sem pausa.
- `onchange` (linha 841) -> `vm.updateLevel` -> `planVM.levelSet`. Lido `levelSet` (planVM.ts:5207): é absoluto (não compara com o nível atual), então o commit depois de um draft do mesmo valor ainda retrai e re-sincroniza. Sem guarda de no-op que anule o commit.
- Teste: `characterSheetVM.test.ts -t updateLevelDraft` -> 3/3 verdes (rodado). Vermelho antes por construção (método inexistente). A ligação oninput/onchange só foi verificada por leitura (sem harness de componente) — gap declarado pelo fixer, aceito.
- Nenhum `$effect` reage à mudança de nível com op destrutiva (heal do PlanColumn roda uma vez por ator, só materializa).

## N1 (novo, importante) — o commit de nível pode ser cancelado depois que o draft já gravou o nível: estado inconsistente (regressão do C6)
`scheduleUpdate` (CharacterSheet.svelte:202) é UM timer de debounce compartilhado por todos os campos; cada chamada faz `clearTimeout` da op pendente.
Cenário: Mago 12, modo edição. Digita "10" e pausa >400 ms -> `updateLevelDraft(10)` é ENVIADO (nível 10 persistido, sem retração/sync). Tab -> `change` -> `scheduleUpdate(updateLevel(10))` agendado. Digita a velocidade no campo seguinte (`edit-speed`, `oninput`, mesma linha) em <400 ms -> `clearTimeout` descarta o commit.
Resultado: ator no nível 10 com os `classFeature:11/12:*` ainda embutidos (bônus derivados, ex. velocidade, contando) e `slots.<rank>.max`/`prepared` do nível 12 — exatamente o defeito que o C6 (r2) fechou. Não se autocorrige: heal-on-open não retrai, e redigitar "10" não dispara `change` (valor igual). Antes do fix, o mesmo fluxo enviava o op completo na pausa, então era consistente.
Vale também na subida (3->12 via draft, commit cancelado): nível 12 com slots do nível 3.
Conserto sugerido: o commit de nível não pode passar pelo debounce compartilhado — em `handleLevelCommit`, limpar o timer pendente e enviar as ops de `updateLevel` imediatamente (ou timer por campo/chave, de modo que outro campo não cancele o commit do nível). Teste: helper de agendamento extraível (ou VM) provando que op de outro campo não descarta o commit de nível pendente.

## Observações menores (não bloqueiam)
- Fechar a janela/remover o input sem blur pode deixar só o draft gravado (mesma inconsistência, caminho mais raro).
- R2 da rodada 2 (`self:armored` em `unarmored`, menor) segue fora do escopo.
