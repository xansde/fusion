# Revisão adversarial o3: veredito do juiz

Branches: core `ficha3/o3` (d6bc3ec4) e satélite `ficha3/o3` (2f1d895), na worktree `wt-o0`. Eu só li código. A única execução foi uma sonda node (`probe.mjs`, no scratchpad desta sessão) contra `systems/pf2e/dist` e os packs reais.

## Veredito: REPROVADA

Motivos:
- Um bloqueante de processo: a evidência viva não rodou.
- Quatro achados importantes, todos da própria onda.

A parte de servidor e de segurança está limpa: as quatro lentes concordam, e eu conferi.

## Confirmados

### B1. Bloqueante de processo: a evidência viva não rodou
- A evidência viva chegou como `null`. Não há arquivo `evidencia-viva*.md`.
- Em `prints/` existe só `01-summoner-plano-eidolon-slot.png`.
- Nenhum print mostra:
  - o eidolon ou o familiar criados como ator;
  - a aba Pets;
  - o smoke como GM e como player, que o PROCESSO-UI exige.
- O I2 abaixo aparece no primeiro print da aba Pets de um Summoner.
- **Dono:** o processo da onda (fecho). **Conserto:** rodar o roteiro tutorial-e2e para Summoner e Witch no nível 1, com prints do ator criado e da aba Pets, como GM e como player.

### I1. Importante: a aba Pets trata o eidolon como familiar
Confirmei no código:
- O eidolon é `type:"familiar"` com `companionKind:"eidolon"`, então `linkedFamiliars` o inclui.
- `FUSION.Sheet.Pets.Kind.eidolon` não existe em `en.json` nem em `pt-BR.json` (0 ocorrências). O card mostra a chave crua.
- `buildMasterRefreshOp` (`petsVM.ts:528`) não filtra por tipo:
  - O `hp.max` do eidolon é 0, porque `mirrorsMaster` dá false para eidolon e o valor gravado é 0.
  - Esse 0 é comparado com 5×nível, a comparação nunca bate, e o op grava `abilitiesBudget {2,2}` e `master` no eidolon.
  - A escrita acontece na primeira abertura da aba (`PetsTab.svelte:86`).
- O `PetCard` passa então a oferecer o `FamiliarAbilityPicker`. Pela regra do PF2e, o eidolon não tem habilidade de familiar.

**Dono:** satélite:
- `sheets/pf2e/src/lib/sheets/pf2e/petsVM.ts` (`buildMasterRefreshOp`);
- `PetCard.svelte` (picker só para familiar/pet);
- core `packages/client/src/lib/i18n/{en,pt-BR}.json`.

**Conserto:** retornar null quando o tipo não é familiar/pet, esconder o picker nesse caso e criar as chaves `Pets.Kind.eidolon`.

### I2. Importante: o auto-create do familiar da Witch depende da classFeature, e o retry não espera por ela
- Sonda com os packs reais:
  - `companionGrantAllows("familiar", [Witch])` retorna **false**;
  - com `Familiar (Witch)` embutido, retorna **true**.
- O item de classe da Witch tem `rules: []`. A feature só chega por `materializeClassGrants`, que:
  - roda em paralelo, com `void`;
  - resolve primeiro `Witch Spellcasting` pelo socket;
  - envia fire-and-forget.
- O retry de `sendAutoCompanionOp` cobre uns 2 s.
- O heal roda uma vez por abertura, antes da escolha da classe.
- Cenário: um jogador remoto com o índice de pack frio acaba sem familiar, e só vê um `console.warn`.
- A premissa da DEC-PET-04 / REQ-PET-096 ("espera o item de classe") é falsa para a Witch.

**Dono:** satélite `sheets/pf2e/src/components/sheets/pf2e/plan/PlanColumn.svelte` (`case "class"`) e core `specs/29-pets-companions-familiars.md`.

**Conserto:**
- Encadear `autoCreateClassCompanion` depois de `await materializeClassGrants`, ou autorizar a Witch pelo sourceId da classe.
- Corrigir o REQ/DEC.
- Criar um teste de servidor com mestre só-Witch.

### I3. Importante: trocar de classe deixa o companheiro da classe anterior
- `handleAbcSelect` `case "class"` só cria, nunca remove.
- O servidor só checa o grant no `doc:create`.
- Cenário: o jogador escolhe Summoner, depois Wizard, depois Witch. O Wizard fica com um eidolon, e a Witch fica com eidolon + familiar.
- A criação automática introduzida nesta onda torna a limpeza simétrica responsabilidade da onda.

**Dono:** satélite `PlanColumn.svelte`, com `petsVM.ts` para o builder.

**Conserto:** ao aplicar uma classe, remover o companheiro auto-criado da classe anterior quando ele não tem tipo compatível com a classe nova, ou avisar e oferecer a remoção.

### I4. Importante: o mapeamento de erro da aba Pets quebrou (regressão desta onda)
- Esta onda trocou as mensagens do servidor (`doc-handlers.ts:576/585`) para:
  - `has no grant for a companion of kind`;
  - `already has a companion of kind`.
- `familiarCreateErrorKey` (`petsVM.ts:647/653`) ainda procura `already has a familiar` / `no feat that grants a familiar`.
- O teste (`petsVM.test.ts:525/534`) usa o texto antigo, então é circular e segue verde.
- Cenário:
  - A Witch agora sempre tem familiar, e o CTA aparece do mesmo jeito (`grant.canHaveFamiliar`).
  - Ao clicar, o jogador recebe `Pets.Error.Generic` em vez de `Duplicate`.
  - Na recusa por falta de grant, recebe `Permission` em vez de `NoGrant`.
- O contrato entre core e satélite é substring de mensagem, e nenhum teste liga as duas pontas.

**Dono:** satélite `petsVM.ts` (`familiarCreateErrorKey` e `sendAutoCompanionOp`) e o teste.

**Conserto:** casar pelas mensagens novas (ou por `code` + sufixo estável). O teste deve usar a string real do servidor.

### M1. Menor: o familiar da Witch nasce com orçamento 2 e o master snapshot antigo
- `autoCreateClassCompanion` passa `masterDoc: doc`, que é o documento de antes da classe. Por isso o budget sai 2 e o snapshot sai velho.
- Pela sonda:
  - Witch + Familiar (Witch) dá 2, porque a fórmula em string é descartada;
  - Witch + Familiar (Witch) + Pet dá **4**, que é o correto nos níveis 1-5. O Pet chega pelo `materializeGrants` aninhado.
- A afirmação das lentes de que o número "nunca se corrige" é **falsa**: o refresh da aba Pets corrige para 4 depois que o Pet é materializado.
- Sobra só a janela entre a criação e a primeira abertura da aba Pets, por exemplo com a mini-ficha aberta direto pela lista.
- Nos níveis 6 e acima, a fórmula em string fica subcontada, mas isso está fora do escopo 1-3.

**Dono:** satélite `PlanColumn.svelte` / `petsVM.ts`. **Conserto:** montar o op com o documento do mestre já com a classe e as features, o que cai junto com o conserto do I2. Avaliar a fórmula em `familiar-grant.ts` fica como issue.

### M2. Menor: as constantes de sourceId espelhadas no petsVM são testadas contra elas mesmas
- `petsVM.ts:98/101`; o teste está em `petsVM.test.ts:248-249`.
- Cenário: um reimport troca o id. O auto-create para de disparar, e a suíte continua verde.

**Dono:** satélite `petsVM.test.ts`. **Conserto:** ler `classes-core/documents.json`, como faz o `companion-grant.test.ts`.

## Refutados (5)
1. **"O budget da Witch nunca se corrige" (três lentes, como importante).** Refutado como importante: o refresh chega a 4 com o Pet materializado. O que sobra é o M1.
2. **Corrida do heal GM×player duplicando o eidolon no caminho privilegiado.** A janela é de um round-trip, não houve demonstração, e a spec limita REQ-PET-093 ao caminho do jogador.
3. **Tabela de permissões rebaixada que vaza ownership.** Exige que o GM rebaixe o piso e que o criador conheça o id. O desvio já existia antes da onda.
4. **CA 10 no card do eidolon.** A decisão registrada na T3.1 é deixar as estatísticas próprias do eidolon para uma issue existente. Não corta o escopo da onda.
5. **Pin do submodule em commit de feature.** É o estado normal.

## Fora do escopo desta onda (para o orquestrador)
O Alexandre testou o **Animista**: ao selecionar os espíritos, nada entrou na lista de magias, nem filtro, nem aba, nada mudou. Isso não pertence à o3 e precisa virar frente e issue própria antes de retomar.
