# Revisão adversarial — Onda 5 — lente COSTURA + CI + SEGURANÇA + UI

Satélite `origin/main...ficha3/o5` (86bbe99) · core `origin/alfa/app...ficha3/o5` (88e1f8a0, só o pin).
Somente leitura. Rodei isolado só `grantMaterializer.test.ts` e consultei os runs de CI no GitHub.

## O que confere (não é achado)

- **Costura das lanes**: T5.0/T5.1 (pack + importer) e T5.3 (planVM/PlanColumn) não se sobrepõem. Core = só o bump do
  submodule, e o pin aponta para o HEAD do satélite (86bbe99).
- **Base atualizada**: `origin/main` do satélite andou (#128, ficha3/o2 mexe em `planVM.ts`/`planVM.test.ts`).
  `git merge-tree origin/main ficha3/o5` fica limpo, sem conflito. `alfa/app` não andou.
- **Higiene**: 12 arquivos, nenhum com data-dir, auth_secret, `.env`, node_modules, `vendor/`, `out/`, junction ou binário.
  `vendor/` continua gitignorado. O `feats-core/documents.json` foi de 6,0 para 6,7 MB, bem abaixo do teto de release.
  `pack.json` mantém `"audience": "all"`.
- **Segurança/servidor**: nada em `packages/server`. Redação e permissão não foram tocadas. `checkVendorPin` usa
  `execSync('git rev-parse HEAD')` com cwd fixo, sem entrada externa, e só avisa (não quebra o CI sem vendor).
- **spec:report / lockfile**: gate reporta piso 710 sem diff; nenhuma dependência nova, lockfile intacto.
- **Troca de dedicação no slot do nível 2**: slot de talento preenchido não reabre o picker (sem `onEdit`, só remover
  e escolher de novo). Por isso a dedicação do próprio slot nunca bloqueia a troca. Conferi em `PlanSlot`/`LevelCard`.

## Achados

### C1 — BLOQUEANTE — o CI está VERMELHO nos dois repos, e o gate classificou a falha como "pré-existente" sem ser

- **Evidência**:
  - satélite `ficha3/o5`: run 35638099655 falhou, assim como **todos** os 4 commits da onda.
  - core `ficha3/o5`: run 35638614538 falhou, com "1 failed | 8078 passed".
  - Nos dois, a única falha é `grantMaterializer.test.ts:1745`, no teste "regression guard … target-not-found is
    exactly the documented pre-existing gap".
  - Base verde: satélite `main` (run 35640191888 ✓, e o #117 também ✓) e core `alfa/app` (run 35622688534 ✓).
  - A falha também não aparece no baseline `o0/baseline.md`.
- **Por que o gate errou**: a lane T5.2-T5.3 "confirmou pré-existente" fazendo `git stash` só do próprio diff. A falha
  vem dos commits da T5.1, que estão na MESMA onda. O `gate.md` repetiu a conclusão. Reproduzi isolado:
  sobram Harrowing, Razmiri Mask e Storied Skin; faltam Munitions Master, Palatine Detective e Spellshot Dedication.
- **Produção**: um personagem nível 2 com Arquétipo Livre escolhe `Harrower Dedication`, `Razmiran Priest Dedication`
  ou `Tattooed Historian Dedication`. O item concedido (Harrowing / Razmiri Mask / Storied Skin) não é criado, e o
  único sinal é um `console.warn` (`PlanColumn.svelte:~356`). O jogador não vê nada.
- **Correção**: atualizar `expectedRemainingGap` para refletir a lista nova, com os 3 declarados como dívida e issue
  no satélite (curar os itens ou registrá-los como lacuna). Depois, confirmar os 2 CIs verdes antes do merge.

### C2 — IMPORTANTE — a regra T5.3 está errada pelo RAW: libera nova dedicação com 1 talento de seguimento, e o PF2e exige 2

- `planVM.ts` (`getIncompleteDedications`, ~3413) considera a dedicação "completa" com **um** talento que tenha a
  dedicação como pré-requisito. O docstring diz: "2 feats total — the dedication plus one follow-up".
- O RAW, no texto do próprio pack (8 docs de `feats-core`), diz: *"You can't select another dedication feat until
  you've gained **two other feats** from the … archetype"*. É o mesmo texto do Player Core.
- Cenário: mundo com Arquétipo Livre, Alquimista-não, nível 6. `archetypeFeat-2` = Alchemist Dedication,
  `archetypeFeat-4` = Basic Concoction. Ao abrir `archetypeFeat-6`, `getIncompleteDedications` devolve `[]` e o
  picker oferece qualquer dedicação nova (Acrobat, Archaeologist…). Pelo RAW, isso só é permitido depois de um
  segundo talento de Alquimista.
- O teste congela o erro: `planVM.test.ts:5258` ("returns [] once a follow-up feat … is also picked") valida
  justamente a contagem de 1.
- Detalhe do conserto: com a contagem certa (≥2), o reconhecimento só por "pré-requisito cita o nome exato da
  dedicação" deixa de fora seguimentos em cadeia. Advanced Concoction, por exemplo, cita Basic Concoction e não a
  dedicação. A dedicação ficaria incompleta para sempre. É preciso aceitar o fecho transitivo do pré-requisito
  dentro do grupo de slots de arquétipo.
- Não dispara em 1-3, mas a T5.3 pede a regra "correta com teste cobrindo nível 4+". Do jeito que está, ela corta o
  escopo da tarefa.

### C3 — MENOR (issue) — o bloqueio da T5.3 some com as dedicações sem mostrar motivo

- `PlanColumn.svelte:1100` repassa `incompleteDedications` ao `filterFn`, e as dedicações simplesmente saem da lista.
  Não há aviso, ao contrário do padrão do teto de repetição (`showRepeatCapNotice`, issue #57, que existe para "motivo
  visível em vez de no-op silencioso").
- Cenário (nível 4+): o jogador abre o 2º slot de arquétipo querendo outra dedicação, não encontra nenhuma e não sabe
  por quê. Também não há print nem roteiro `tutorial-e2e` desse estado; a lane declarou "sem UI a fotografar".
  Fora do recorte 1-3, por isso fica como issue.

## Não verificado

- Não rodei a suíte inteira nem subi servidor (regra da revisão). O CI do GitHub fez a suíte completa: 1 falha, a do C1.
- A lente de dados (drift do `feats-core`, Sanguimancer, multiclasse no slot) é da `revisao-dado-importer.md` e não
  foi repetida aqui.
