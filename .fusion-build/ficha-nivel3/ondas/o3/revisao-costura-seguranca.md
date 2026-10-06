# Revisão adversarial o3 — lente costura + CI + segurança + UI

Branches: core `ficha3/o3` (d6bc3ec4) vs `origin/alfa/app`; satélite `ficha3/o3` (2f1d895) vs `origin/main`.
Somente leitura. Única execução: uma sonda node (`scratchpad/witchprobe.mjs`) contra o `dist/` e os packs reais.

## Veredito
O servidor e a segurança estão limpos. A costura entre o servidor e a ficha do satélite tem 3 regressões/erros de produção (importantes) e 3 pontos menores. Nenhum bloqueante.

## O que está OK
- Permissão: a porta do jogador continua em `authorizePlayerCompanionCreate`. O grant por tipo vem do documento mestre persistido (`companionGrantAllows`), o ownership é forçado no caminho do jogador, e `inheritMasterOwnershipOnCreate` só age quando nenhum ownership foi informado (e nunca no caminho do jogador). Nenhum predicado novo de papel. A redação continua lendo o próprio documento. O teste usa `redactActorDocsForViewer`.
- Nada de mount/animalCompanion para o jogador. Um tipo desconhecido é recusado.
- Higiene: o diff do core tem 9 arquivos, o do satélite 8. Não entrou data-dir, auth_secret, node_modules, vendor, out nem .env. O lockfile não mudou (nenhuma dependência nova).
- CI: o teste do servidor usa `reserveFreePort` (nada de porta fixa). O piso da COBERTURA-MINIMA (719) confere com o spec:report do gate. O CI do satélite roda os testes de `system-pf2e` e de `sheets-pf2e`. As falhas vermelhas pré-existentes (pregen-parity, actionCategories) não são desta onda.
- O pin do submodule aponta para o HEAD da branch do satélite (estado normal antes do fecho).

## Achados

### I1 (importante): mapeamento de erro da aba Pets quebrou porque as mensagens do servidor mudaram
- Servidor: `packages/server/src/net/handlers/doc-handlers.ts:576` e `:585`. As mensagens agora são `Master has no grant for a companion of kind "familiar"` e `Master already has a companion of kind "familiar"`.
- Cliente: `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/petsVM.ts:647` e `:653` ainda procuram `already has a familiar` e `no feat that grants a familiar`. O teste `petsVM.test.ts:525/534` confere as mensagens antigas, então é circular: continua verde.
- Cenário: uma Witch (que agora ganha o familiar automaticamente) abre a aba Pets. O CTA "criar familiar" aparece mesmo com um familiar já existente (`PetsTab.svelte:188` só olha `grant.canHaveFamiliar`). O jogador clica, recebe VALIDATION_FAILED e a tela mostra `FUSION.Sheet.Pets.Error.Generic` em vez de "Este personagem já tem um familiar". Numa corrida de grant, `PERMISSION_DENIED` mostra "Permission" em vez de "NoGrant".
- Conserto: casar com as mensagens novas (ou com o `code` + um sufixo estável) e trocar o teste para usar a mensagem real do servidor.

### I2 (importante): a aba Pets trata o eidolon como familiar (grava orçamento de habilidades e mostra chave crua)
- `PetCard.svelte:144` monta `t(\`FUSION.Sheet.Pets.Kind.${companionKind}\`)`. `FUSION.Sheet.Pets.Kind.eidolon` não existe em `packages/client/src/lib/i18n/{en,pt-BR}.json`: a lane só acrescentou `FUSION.Contacts.CompanionKind.eidolon`. O i18n cai na chave crua, e o card do eidolon mostra o texto "FUSION.Sheet.Pets.Kind.eidolon".
- `PetsTab.svelte:86-91` chama `buildMasterRefreshOp` (`petsVM.ts` ~l.530) para todo companheiro. Com o eidolon, `hp.max` (0) ≠ 5×nível e `ac` 10 ≠ a CA do Summoner, então o op nunca é nulo. Ele grava `abilitiesBudget {2,2}` no eidolon logo na primeira abertura da aba, desfazendo o "zero honesto" que a própria T3.2 decidiu. O `PetCard`/`FamiliarAbilityPicker` passa então a oferecer 2 habilidades de familiar ao eidolon. Isso é regra PF2e errada: eidolon não tem habilidades de familiar. Depois da primeira vez, cada nova execução do effect manda um doc:update que o servidor trata como no-op (REQ-DOC-038), o que é só desperdício.
- Cenário: um Summoner escolhe a classe, o eidolon nasce e o jogador abre a aba Pets. O eidolon recebe o orçamento 2/2, aparece o seletor de habilidades de familiar e o rótulo mostra a chave i18n crua.
- Conserto: `buildMasterRefreshOp` e o card precisam pular o bloco de familiar quando o tipo não é familiar/pet (mesmo corte de `mirrorsMaster`). E faltam as chaves `FUSION.Sheet.Pets.Kind.eidolon` em en e pt-BR.
- Relação com a issue #237: ela diz "nenhum caso concreto encontrado hoje (Pets tab já lê companionKind)". O caso concreto existe, e é exatamente a aba Pets.

### I3 (importante): o familiar automático da Witch nasce com 2 habilidades em vez de 4 (regra remaster)
- A autorização e o orçamento vêm de `detectFamiliarGrant` (`systems/pf2e/src/familiar-grant.ts`). A feature "Familiar (Witch)" (class-features-core `YZuMJcbifuD0uTJb`) soma `"2 + min(3,floor(@actor.level / 6))"` a `familiarAbilities`. O valor é uma STRING, então o detector descarta o bump. A sonda confirmou: `detectFamiliarGrant(witch+feature) = { canHaveFamiliar: true, abilityBudget: 2 }`.
- Cenário: uma Witch de nível 1 escolhe a classe. O familiar nasce com `abilitiesBudget {2,2}`, quando pela regra deveria ter 4 (2 da base + 2 da Witch), subindo nos níveis 6, 12 e 18. O defeito do detector é anterior à onda, mas a T3.3 entrega o familiar da Witch justamente com esse orçamento. Nenhum teste cobre um mestre Witch real (classe + feature) em `companion-grant.test.ts`: o teste de familiar usa `wizardWithFamiliar`.
- Conserto: avaliar a fórmula (`@actor.level`) no detector, ou registrar como issue e tirar a promessa de "familiar da Witch correto" desta onda.

### M1 (menor): a autorização do familiar da Witch depende de uma SEGUNDA cadeia fire-and-forget
- A sonda confirmou que `companionGrantAllows("familiar", {class Witch só})` = false: é preciso a classFeature "Familiar (Witch)" embutida, que só chega via `materializeClassGrants` → `runClassGrantRefs`. Esse caminho busca no pack Witch Spellcasting e depois Familiar (Witch), mais o GrantItem Pet. O retry de `sendAutoCompanionOp` cobre só uns 2 s no total (200+400+600+800 ms). A DEC-PET-04 e o relatório falam apenas da corrida com o ITEM DE CLASSE.
- Cenário: um jogador remoto, via túnel e com latência, escolhe Witch. As 5 tentativas esgotam, aparece só um `console.warn` e nenhum familiar. Ele só nasce quando o Plano for reaberto (heal). É menor porque o heal cobre.

### M2 (menor): trocar de classe deixa o companheiro da classe anterior
- `PlanColumn.svelte` (`autoCreateClassCompanion`) só cria, nunca remove.
- Cenário: o jogador escolhe Summoner por engano e troca para Wizard. O eidolon continua vinculado e aparece na aba Pets/Contatos de um Wizard. Nada o remove, e o servidor não o recusa: o grant só é checado na criação.

### M3 (menor): não há prova de UI conforme PROCESSO-UI
- Os relatórios da T3.2/T3.3 não trazem roteiro tutorial-e2e com prints nem smoke como GM e como player. A prova do PlanColumn é grep de fonte (`planColumn-auto-companion.test.ts`). I2 (chave crua e seletor de habilidades no eidolon) aparece no primeiro print da aba Pets de um Summoner.

## Descartados (sem cenário concreto em produção)
- Caminho da tabela de permissões rebaixada (ACTOR_CREATE ≤ PLAYER): um criador não privilegiado que omite o ownership herda o ownership do mestre e recebe no ack o mapa de ownership desse mestre. Isso exige que o GM rebaixe o piso e que o criador conheça o id. O desvio da porta de grant nesse caminho já existia antes da onda.
- Criação privilegiada (GM) não aplica a regra de 1 por grupo (REQ-PET-093). A spec limita a regra ao caminho do jogador.
