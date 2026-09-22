# Evidência viva (FINAL) — Onda 2 (níveis "vivo" e "olhado")

Segunda rodada da lane de evidência viva da Onda 2 (Conjuração), rodada **depois** das 3
rodadas de fixer (`fix-r1.md`, `fix-r2.md`, `fix-r3.md`) que consertaram os achados
bloqueantes (C1/C2) registrados pela 1ª rodada (`evidencia-viva.md`) e os achados N1/N2 da
revisão adversarial subsequente. Esta lane **não editou código de produção** — só rebuild,
subiu servidor, dirigiu a UI de verdade e conferiu o `world.db`.

## Estado verificado

- Worktree: `wt-o0-grants`, branch `ficha3/o2`, core HEAD `bea5bc49` (repin final pós fix-r3),
  satélite `fusion-systems-2e` HEAD `e05a362` (`v0.2.1-16-ge05a362`) — inclui C1–C9 (fix-r1),
  C3/C5 refinados (fix-r2) e N1/N2 (fix-r3).
- `pnpm build` rodado do zero nesta lane (dist na worktree estava ~8min mais velho que o
  commit `bea5bc49`) — verde, sem erro.
- Data-dir isolado novo: `scratchpad/data-o2f` (mundo `teste_xande` recopiado de
  `~/.fusion/worlds/teste_xande`; `~/.fusion` real não tocado).
- Servidor: porta `33013` (33012 da 1ª rodada estava livre, mas usei 33013 para não colidir
  com resíduo de outras ondas). Boot saudável confirmado (`World opened`, `Auth routes
  registered`, `Server listening`, `Fusion server ready`). Setup wizard percorrido (Admin Key
  `AdminSenha33013`), usuários `GM_o2f`/`Player_o2f` criados via CLI.
- Browser: Playwright (`playwright-cli`, sessão `-s=o2f`) — **Claude in Chrome não foi usado**.
- Três atores `character` semeados limpos no `world.db` via script (reaproveitado
  `seed-o2-actors.js` da 1ª rodada, mesmo padrão): `Bard_o2`, `Wizard_o2`, `Sorcerer_o2`, sem
  classe, nível 1, sem `spellcastingEntry`/`spell` pré-existente.
- Console do navegador: **1 erro em toda a sessão** — o mesmo 401 benigno de
  `auth/refresh` pré-login presente em todo boot; nenhum erro novo em nenhum passo (classe,
  musa/escola/linhagem, subida de nível, adicionar magia, preparar magia).

## O que foi provado — nível Vivo (ator real, servidor real) + Olhado (print)

| Personagem | Ação na UI | Confirmado no `world.db` / UI | Print |
|---|---|---|---|
| **Bard_o2 nv3** (T2.1/T2.2/T2.4/T2.5 + N1/N2) | Classe → Bardo; Musa → Enigma; subiu 1→2→3; aprendeu o truque "Aproximado" (repertório); aprendeu "Agitar" no Patamar 1 | `occult Spells` (`spontaneous`, slots 0/1/2 com `spellsKnown`), **`Focus Spells` (`isFocusPool:true`) agora existe** (achado #113 fechado), `derived.focusPoints = {value:0,max:1}` (achado #112 fechado); `proficiency.value:1` (Treinado, correto p/ nv3); truque "Aproximado" aparece corretamente na seção Truques (não mais invisível/duplicando — N1); picker de "conhecidas" no Patamar 1 não lista truques (N2 aplicado ao modo "known", que já valia desde fix-r2) | `bard-nv3-repertorio-foco-1de1.png` |
| **Wizard_o2 nv3** (T2.3/T2.4 + N2) | Classe → Mago; Escola → Protean Form; Tese → Fusão de Magias; subiu 1→2→3; +"500 Sapos" no grimório; preparou no Patamar 1 | `arcane Spells` (`prepared`), grimório com "500 Sapos", slot Patamar 1 preenchido (`Lançar`/`Trocar` na UI), demais slots vazios; `proficiency.value:1` (Treinado, correto p/ nv3); **picker de "Preparar do grimório…" no Patamar 1 listou só "500 Sapos"**, nenhum truque — prova direta e específica do N2 (picker `prepare` excluindo truques) | `wizard-nv3-grimorio-preparado-final.png` |
| **Sorcerer_o2 nv1** (T2.1/T2.5, bloodline) | Classe → Feiticeiro; Linhagem → Dracônica; +"500 Sapos" no repertório | `arcane Spells` (`spontaneous`) Patamar 1 com "500 Toads" em `spellsKnown`; `Focus Spells` (`isFocusPool:true`) presente; `derived.focusPoints={value:0,max:1}`; item `spell "Flurry of Claws"` com `grantedSlot:"bloodline-1"` (magia de linhagem concedida) | `sorcerer-nv1-linhagem-repertorio-final.png` |

## Achados da 1ª rodada — reverificados

### Achado 1 / issue `xansde/fusion-systems-2e#112` — **CONFIRMADO CORRIGIDO, issue fechada**

`derived.focusPoints` agora existe no `world.db` de Bard_o2 e Sorcerer_o2 com `{value:0,max:1}`
(coerente com 1 ponto de foco no nível 1-3 vindo de uma única fonte de pool — Enigma/Linhagem
Dracônica). A UI mostra "Pontos de Foco 0/1" com o pip 1 clicável e os pips 2/3 bloqueados.
Comentário com a evidência e fechamento registrados na issue nesta lane.

### Achado 2 / issue `xansde/fusion-systems-2e#113` — **CONFIRMADO CORRIGIDO, issue fechada**

`doc.items.filter(i=>i.type==='spellcastingEntry')` do Bard_o2 agora retorna a entry
`Focus Spells` (`isFocusPool:true`) além de `occult Spells`. A aba "Foco" aparece na UI ao lado
de "occult Spells". Comentário com a evidência e fechamento registrados na issue nesta lane.

### N1 (truque invisível) e N2 (picker "prepare" listava truques) — **confirmados corrigidos ao vivo**

Não tinham issue própria (foram consertados na mesma rodada de fixer em que foram achados,
`revisao-adversarial-r2.md` → `fix-r3.md`). Verificação ao vivo desta lane:

- **N1**: o truque "Aproximado" aprendido pelo Bard aparece corretamente na seção "Truques"
  (não no Patamar 1), com botão funcional — sem duplicar em clique repetido (não tentei
  clicar duas vezes nesta lane, mas o item aparece uma única vez após um clique, e o código
  consertado usa uma guarda de duplicata por id, já coberta por teste unitário no fix-r3).
- **N2**: confirmado no Wizard — o diálogo "Preparar do grimório — Patamar 1" listou **só**
  "500 Sapos" (a única magia do grimório), sem nenhum truque, mesmo com truques presentes no
  índice do pack (69 truques rank≥1 seriam candidatos errados sob o bug antigo).

## Achados NOVOS desta rodada

Nenhum achado bloqueante ou importante novo. Dois pontos cosméticos, já registrados na 1ª
rodada e não reconsertados (fora do escopo dos fixers atribuídos até agora — cosmético, não
bloqueante):

1. O botão do picker de repertório espontâneo continua rotulado "Adicionar ao grimório" em vez
   de algo como "Adicionar ao repertório", tanto para Bard quanto para Sorcerer (conjuradores
   espontâneos). Sem efeito funcional — a magia vai corretamente para `spellsKnown`, não para
   um slot `prepared`. Mesma nota já feita em `evidencia-viva.md`; ainda sem issue aberta
   (prioridade cosmética).
2. `xansde/fusion-systems-2e#111` ("focus points: value não enche para o novo max quando o
   pool é concedido pela primeira vez") segue **aberta e consistente com a evidência desta
   rodada**: tanto Bard_o2 quanto Sorcerer_o2, ao ganhar o pool de foco pela primeira vez,
   mostram `value:0` (não `value:max`). Não é um achado novo — é a mesma issue já registrada
   pelo gate anterior, reconfirmada, não fechada (não foi atribuída a nenhum fixer até agora e
   o RAW de "quando o pool enche" não foi verificado a fundo nesta lane).

## Pendências para issue

Nenhuma pendência nova nesta rodada. `#111` segue aberta (não é desta lane fechar — não foi
verificada/consertada aqui, só reconfirmada como presente). As pendências não atribuídas dos
fixers (Animist metade espontânea, `chooseClassLevel` multiclasse sem teste dedicado, `restAll`
sem teste unitário dedicado, rótulo cosmético do botão) seguem de pé, listadas em `fix-r1.md`/
`fix-r2.md`/`evidencia-viva.md`.

## Encerramento

Servidor (PID 2940) encerrado via `taskkill //PID 2940 //F`; `netstat` confirmou porta 33013
liberada (sem `LISTENING` remanescente). Nenhum arquivo do `~/.fusion` real foi tocado — todo
o trabalho ficou em `scratchpad/data-o2f`.

## Nota sobre o runbook

`docs/design/ficha-nivel3/gate-runbook.md` continuou correto e suficiente para subir o
servidor e logar nesta rodada — mesma conclusão das rodadas anteriores (O0/O1/O2-r1). Nenhuma
correção necessária.

## Veredito desta lane

Os dois achados bloqueantes da 1ª rodada (**#112**, **#113**) estão **confirmados corrigidos**
ao vivo, com evidência de servidor real + `world.db` real + print, e as issues foram
comentadas e fechadas. Os achados N1/N2 da revisão adversarial também foram confirmados
corrigidos ao vivo. Nenhum achado bloqueante novo. A pendência residual (`#111`, foco não
enche no primeiro grant) segue aberta e é consistente com o comportamento observado, mas não é
um bloqueante desta lane (fora do escopo — lane só verifica, não corrige nem julga prioridade
de reabertura de issue existente não atribuída).
