# Evidência viva — Onda 2 (níveis "vivo" e "olhado")

Lane de evidência viva sobre o trabalho já implementado e commitado da Onda 2 (T2.1–T2.5,
`docs/design/ficha-nivel3/execucao.md` seção 3, linha da Onda 2). Esta lane **não editou
código de produção** — só rodou o gate vivo e olhado contra o que já estava em
`ficha3/o2` (commits `7ab38a9b`, `e573ac4a`, `2a8013e3`, satélite pinado em
`v0.2.1-8-g37df631`).

## Setup

- Worktree: `wt-o0-grants` (buildada), branch `ficha3/o2`, satélite `fusion-systems-2e`
  pinado em `v0.2.1-8-g37df631` (inclui T2.1–T2.5).
- Data-dir isolado: `scratchpad/data-o2` (fora da worktree; nunca tocou `~/.fusion`
  real). Mundo `teste_xande` copiado de `~/.fusion/worlds/teste_xande`.
- Servidor: `node packages/server/dist/cli/index.js serve --port 33012 --data-dir
  <data-o2> --world teste_xande --no-open --log-level info`, `CI=1`. Boot saudável
  confirmado nos logs (`World opened`, `Auth routes registered`, `Server listening`,
  `Fusion server ready`).
- Browser: Playwright (`playwright-cli`, sessão `-s=o2`) — a extensão Claude in Chrome
  **não foi usada** em nenhum momento.
- Usuários criados: `GM_o2` (Mestre) / `Player_o2` (Player), senha `senha123`. Setup
  wizard do data-dir novo percorrido manualmente (Admin Key `AdminSenha33012`).
- Três atores `character` semeados limpos direto no `world.db` (script descartável,
  não commitado, mesmo padrão da Onda 1): `Bard_o2`, `Wizard_o2`, `Sorcerer_o2` —
  clonados de `Novo Ator` (Elfo/Elfo Ancestral, Advogado), sem classe, sem
  spellcastingEntry/spell pré-existente, nível 1.

## O que foi provado — nível Vivo (ator real, servidor real) + Olhado (print)

Cada família: classe escolhida pela UI → diálogos de escolha respondidos → **sem erro
novo no console do navegador** (só o 401 benigno de `auth/refresh` pré-login, presente
em toda sessão) → **verificado direto no `world.db` do ator** (não só na UI).

| Personagem | Ação na UI | Confirmado no `world.db` / UI | Print |
|---|---|---|---|
| **Bard_o2 nv3** (T2.1/T2.2/T2.5) | Classe → Bardo; Musa → Enigma; +magia conhecida → Agitar; subiu nv1→2→3 | `spellcastingEntry "occult Spells"` `prepared:"spontaneous"`, slots rank1 `3/3`, rank2 `2/2`, `spellsKnown` rank1 = `[Agitate]`; `proficiency.value: 1` (Treinado, correto para nv3 — upgrade só no 7) | `bard-nv1-repertorio-agitar.png`, `bard-nv3-magias-slots-1e2.png` |
| **Wizard_o2 nv3** (T2.3/T2.4) | Classe → Mago; Escola Arcana → School of Protean Form; Tese Arcana → Spell Blending; +magia no grimório → 500 Sapos; preparou no slot rank1; subiu nv1→2→3 | `spellcastingEntry "arcane Spells"` `prepared:"prepared"`, slot rank1 `[0].id` = id de "500 Toads" (`expended:false`), demais slots vazios (`id:""`); `proficiency.value: 1` (Treinado, correto p/ nv3) | `wizard-nv3-grimorio-preparado.png` |
| **Sorcerer_o2 nv1** (T2.1/T2.5, bloodline) | Classe → Feiticeiro; Linhagem → Dracônica; +magia conhecida → 500 Sapos | `spellcastingEntry "arcane Spells"` `prepared:"spontaneous"` slots rank1 `3/3`, `spellsKnown=[500 Toads]`; **segunda** entry `"Focus Spells"` `isFocusPool:true` criada corretamente; item `spell "Flurry of Claws"` (Saraivada de Garras) presente, `grantedSlot:"bloodline-1"` — a magia de linhagem foi concedida | `sorcerer-nv1-linhagem-draconica-repertorio.png`, `sorcerer-nv1-repertorio-500sapos.png` |

**T2.4 (proficiência):** confirmado indiretamente em Bard e Wizard nível 3 — ambos
mostram `Treinado` (rank 1), que é o valor RAW correto (Bard e Wizard só sobem para
Especialista no nível 7). Não foi possível, dentro do escopo/tempo desta lane, levar um
personagem até o nível de upgrade para confirmar o consumo de `proficiencyUpgrades[]`
subindo o rank — ficou como verificação parcial (não é um defeito: o teste mecânico da
T2.4, fora desta lane, já cobre isso com o motor de derivação isolado).

## Achados (defeitos — não consertados, registrados)

### Achado 1 (BLOQUEANTE do gate) — Pool de Ponto de Foco sempre `0/0`, mesmo quando a `spellcastingEntry` de foco existe

O gate da Onda 2 pede explicitamente "foco em 1" para Bard/Sorcerer nível 1-3. Em
**nenhum** dos dois personagens o Pontos de Foco aparece diferente de `0/0`.

Print definitivo: `sorcerer-nv1-foco-0de0-DEFEITO.png` — aba Magias → sub-aba "Foco" do
Sorcerer_o2 (Linhagem Dracônica), mostrando `Pontos de Foco 0 / máx 0`, apesar de:

- o `world.db` do ator ter um item `spellcastingEntry` `"Focus Spells"` com
  `system.isFocusPool: true` corretamente criado (confirma que a CRIAÇÃO do pool
  funciona para o Sorcerer, via `bloodlineSpellcastingOps`);
- a magia de linhagem (Saraivada de Garras / Flurry of Claws) ter sido concedida como
  item no ator (`grantedSlot: "bloodline-1"`).

`doc.system.derived` do ator (Bard nv3 e Sorcerer nv1, ambos verificados) **não contém
nenhuma chave `resources`** — sugere que `stepCharFocusClamp`
(`external/fusion-systems-2e/systems/pf2e/src/derivations/build.ts:706`, que lê
`doc.items` e escreve `sys.resources.focusPoints`) não está rodando no pipeline de
derivação ativo neste boot, ou seu resultado não está sendo mesclado de volta no
`system.derived` persistido — não investigado a fundo (fora do escopo desta lane, que
só verifica).

**Issue aberta:** https://github.com/xansde/fusion-systems-2e/issues/112

### Achado 2 (BLOQUEANTE do gate, Bard especificamente) — `applyClass` não cria a `spellcastingEntry` de foco para o Bard

Distinto do Achado 1: para o **Bard**, nem chega a existir a segunda `spellcastingEntry`
(`isFocusPool: true`). `doc.items.filter(i => i.type === 'spellcastingEntry')` no
`world.db` de `Bard_o2` retorna **só** `occult Spells` (`isFocusPool: false`).

Pelo código lido em `planVM.ts` (`sheets/pf2e`), a função `applyClass` deveria chamar
`buildFocusEntryOp` no branch `if (classSystem.spellcasting?.tradition)` — o Bard tem
`spellcasting.tradition === "occult"` (truthy) e `hasFocusFeature(classSystem)` deveria
retornar `true` (o pack `classes-core` confirma `featuresByLevel` nível 1 do Bard
inclui `"Composition Spells"`, que termina em `" Spells"`, batendo no predicado). Não
foi possível, sem instrumentar o código, confirmar se o op é gerado e descartado no
envio ao servidor ou nunca chega a ser gerado.

Repro: qualquer ator limpo → Classe → Bardo → Confirmar → Musa (qualquer) → conferir
`world.db`.

**Issue aberta:** https://github.com/xansde/fusion-systems-2e/issues/113

### Nota — não é achado novo, mas registrado por completude

O rótulo do botão de adicionar magia ao grimório do Bard (conjurador **espontâneo**,
repertório) mostra "Adicionar ao **grimório**" em vez de algo como "Adicionar ao
**repertório**" — cosmético, sem efeito funcional (a magia foi corretamente adicionada
a `spellsKnown`, não a um `prepared` slot). Não abri issue separada por ser puramente
textual e de prioridade baixa frente aos dois achados acima; mencionado aqui para quem
for aos textos da UI depois.

## Pendências para issue

1. **xansde/fusion-systems-2e#112** (aberta nesta lane) — "Foco (Focus Points) sempre
   0/0 mesmo com spellcastingEntry isFocusPool:true (Bard/Sorcerer nv1-3)".
2. **xansde/fusion-systems-2e#113** (aberta nesta lane) — "Bard: applyClass não cria a
   spellcastingEntry de foco (Composition Spells) apesar do branch correto no código".
3. Rótulo do botão "Adicionar ao grimório" no picker de repertório espontâneo (Bard) —
   sem issue aberta, prioridade cosmética; registrado acima para referência futura.

## Encerramento

Servidor (PID 9892) encerrado via `taskkill //PID 9892 //F`; `netstat` confirmou
liberação total da porta 33012 (sem `LISTENING` nem `ESTABLISHED` remanescente).
Nenhum arquivo do `~/.fusion` real foi tocado — todo o trabalho ficou em
`scratchpad/data-o2`.

## Nota sobre o runbook

`docs/design/ficha-nivel3/gate-runbook.md` estava correto e suficiente para subir o
servidor e logar; não precisou de correção nesta rodada — mesma conclusão da lane da
Onda 1.
