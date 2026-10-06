# Revisão adversarial o3: regra PF2e e caminho de produção

Escopo: satélite `ficha3/o3` (`2f1d895`) e core `ficha3/o3` (`d6bc3ec4`). Lente: regra do remaster nos níveis 1-3 e o caminho pack → mundo → ator → UI.

## Veredito

Pelo critério do plano, o gate da onda passa: o Summoner de nível 1 cria o eidolon como documento próprio, com ownership copiado. Mesmo assim, **não está pronto para jogar**:
- o familiar da Witch nasce com o orçamento de habilidades errado pela regra;
- a aba Pets trata o eidolon como familiar: mostra a chave i18n crua, abre o seletor de habilidades de familiar e sobrescreve o eidolon a cada abertura;
- trocar de classe deixa o companheiro da classe anterior.

Nenhum achado é bloqueante: todos têm conserto local. Os três importantes pertencem a esta onda.

## Achados

### A1 (importante): o familiar da Witch nasce com 2 habilidades, e a regra dá 4
- **Onde:** `external/fusion-systems-2e/systems/pf2e/src/familiar-grant.ts:114` e o espelho em `sheets/pf2e/src/lib/sheets/pf2e/petsVM.ts:260`. O valor é consumido em `petsVM.ts:433` (`buildCreateFamiliarOp`) e em `buildMasterRefreshOp` (~534).
- **Regra (Player Core, Familiar (Witch)):** "Your familiar gains two additional familiar abilities"; uma delas é a habilidade fixa do patrono. No pack, a regra da feature é `ActiveEffectLike add familiarAbilities.value = "2 + min(3,floor(@actor.level / 6))"`. Nos níveis 1-3, o total é 2 (base) + 2 = **4**.
- **Cenário (reproduzido com o `dist` e os documentos reais do pack):** `detectFamiliarGrant({items:[Witch, Familiar (Witch)]})` retorna `{ canHaveFamiliar: true, abilityBudget: 2 }`. O valor da regra é uma string de fórmula, e o `typeof v === "number"` descarta essa string.
- **Efeito:**
  - A Witch nova ganha um familiar `abilitiesBudget {2,2}`, e o card mostra "0/2".
  - O refresh da aba Pets recalcula o mesmo 2, então o número nunca se corrige.
  - A habilidade do patrono não é pré-selecionada.
- **Agravante:** o op é montado com `masterDoc: doc`, o documento **antes** da classe (`PlanColumn.svelte`, `autoCreateClassCompanion`). Mesmo com a fórmula avaliada, a feature ainda não estaria nele.
- **Relação com a tarefa:** a T3.3 cita justamente "familiar-abilities-core existe e não é usado pelo builder". Entregar o familiar da Witch com orçamento errado corta o escopo da própria tarefa.

### A2 (importante): na aba Pets, o eidolon aparece como familiar (chave i18n crua, seletor de habilidades de familiar, escrita espúria)
- **Onde:**
  - `sheets/pf2e/src/components/sheets/pf2e/pets/PetCard.svelte:144`: `t(\`FUSION.Sheet.Pets.Kind.${companionKind}\`)`;
  - `packages/client/src/lib/i18n/{pt-BR,en}.json:241-244`: só existem `familiar/pet/animalCompanion/mount`, e a onda adicionou apenas `FUSION.Contacts.CompanionKind.eidolon`;
  - `PetCard.svelte:108,239-262`: seletor de habilidades;
  - `petsVM.ts` `readFamiliar`: o default do orçamento é `FAMILIAR_ABILITY_BASE`;
  - `petsVM.ts:528-557`: `buildMasterRefreshOp`, sem filtro por kind;
  - `PetsTab.svelte:86-92`: o `$effect` que emite o refresh.
- **Cenário:** um jogador escolhe Summoner. O eidolon nasce, e a aba Pets aparece (`CharacterSheet.svelte:165`, porque `linkedFamiliars(...).length > 0`). No card:
  1. O rótulo mostra o texto literal `FUSION.Sheet.Pets.Kind.eidolon`: `i18n.t` cai no próprio key (`i18n.ts:98`).
  2. "Habilidades 0/2" e o botão "Escolher habilidades" deixam o jogador marcar habilidades de familiar (Flier, Manual Dexterity...) no eidolon. Isso não existe na regra: o eidolon evolui por evolution feats.
  3. Ao abrir a aba, `buildMasterRefreshOp` compara `hp.max` 0 (o eidolon não espelha o mestre) com `5×nível`. A comparação nunca bate, e o refresh grava `abilitiesBudget {2,2}` e `master` no eidolon. O servidor descarta o no-op só da segunda vez em diante (`doc-handlers.ts:1326`), mas o op volta a sair a cada mudança em qualquer Actor do mundo.
- **Contradiz o relatório da T3.2/T3.3,** que diz que "nenhum caso concreto encontrado hoje (Pets tab já lê companionKind)" e rebaixou o caso para a issue #237. O caso concreto é a leitura de `companionKind` sem chave i18n.

### A3 (importante): trocar de classe deixa o companheiro da classe anterior
- **Onde:** `sheets/pf2e/src/components/sheets/pf2e/plan/PlanColumn.svelte`, `handleAbcSelect` `case "class"` (~930-941). O código só cria, nunca remove nem avisa. No servidor, `companionGrantAllows` só vale no `doc:create` (`doc-handlers.ts:961`).
- **Cenário:** na criação, o jogador escolhe Summoner (o eidolon é criado) e depois troca para Wizard. O Wizard continua com o eidolon vinculado e com a aba Pets. Se ele trocar de novo para Witch, a ficha acaba com eidolon **e** familiar.
- **Regra:** o eidolon é vínculo da classe Summoner. Um não-Summoner não tem eidolon.
- **Por que é desta onda:** criar o companheiro automaticamente ao aplicar a classe torna a limpeza simétrica parte da mesma responsabilidade. Antes, o companheiro era sempre um ato manual e explícito.
- **Tratamento mínimo aceitável:** apagar o companheiro criado automaticamente (sem mudança autoral) ou avisar e oferecer a remoção.

### A4 (menor): o retry do familiar da Witch depende da feature de classe, não do item de classe
- **Onde:**
  - `systems/pf2e/src/companion-grant.ts:56-58`: `familiar` delega para `detectFamiliarGrant`;
  - `petsVM.ts` `sendAutoCompanionOp`: 5 tentativas, com esperas de 200/400/600/800 ms (~2 s);
  - `PlanColumn.svelte` `runClassGrantRefs`: resolução sequencial de pack com `await resolveGranterByName`, e `sendOpFn` fire-and-forget.
- **Cenário (reproduzido):** `companionGrantAllows("familiar", {items:[Witch]})` retorna `false`. A autorização da Witch só passa depois que a feature `Familiar (Witch)` é materializada. Antes dela vem `Witch Spellcasting`, com índice de pack e documento resolvidos por socket. Se o pack estiver frio ou a rede lenta (jogador via túnel) e isso passar de ~2 s, as 5 tentativas se esgotam: o console mostra `warn` e a Witch fica sem familiar até reabrir a ficha (a cura em `runHeal` resolve).
- **Registro:** a justificativa da DEC-PET-04 ("a espera real nunca passa do round-trip do item de classe") vale para o eidolon e é falsa para a Witch.

### A5 (menor): o caminho privilegiado não checa unicidade, e a cura concorrente pode duplicar
- **Onde:** `packages/server/src/net/handlers/doc-handlers.ts:973ff`. A checagem por grupo (`masterHasCompanionOfGroup`, :581) roda só no caminho do jogador. A cura `runHealAutoCompanion` roda para quem tem `editable`, o Mestre inclusive.
- **Cenário:** mundo existente, com um Summoner criado antes desta onda. O Mestre e o jogador abrem a ficha quase ao mesmo tempo (início de sessão). Os dois clientes checam `worldMirror`, não acham companheiro e emitem o create. Se o do jogador entrar primeiro, o do Mestre passa porque o caminho privilegiado não tem checagem de grupo, e o personagem fica com dois eidolons.
- **Probabilidade:** baixa, porque a janela é de um round-trip.

## Conferido e correto (não é achado)
- A identidade da classe usa `flags.fusion.sourceId`: Summoner é `YtOm245r8GFSFYeD` e Witch é `bYDXk9HUMKOuym9h`, os dois conferidos no `classes-core`. Um item só com o nome não concede nada.
- Pela regra, só Summoner e Witch ganham companheiro automático ao aplicar a classe no nível 1. O familiar do Druid da Leaf Order e o Improved Familiar Attunement do Wizard vêm por escolha de ordem/tese e continuam manuais, o que está coerente.
- Familiar e pet dividem um grupo de unicidade, e o eidolon fica em grupo próprio (DEC-PET-03), o que está correto.
- O HP do familiar é `5 × nível`, o que está correto.
- O ownership do eidolon no caminho do jogador é forçado do mestre. No caminho do Mestre, é herdado quando o create não traz ownership explícito. A redação usa `redaction.ts`.
- Mundo e ator existentes: `runHeal` materializa as features, passo (4), antes do companheiro, passo (5), e é idempotente por grupo. Uma Witch antiga que já tinha familiar manual não ganha um segundo.
- As estatísticas próprias do eidolon (PV compartilhado, CA/saves por tipo) ficam fora por decisão registrada na T3.1: `stepFamiliarDerived` mostra CA 10 e saves +0. Não reabri o ponto, mas a CA 10 **não** é um "zero honesto": está no card. Somar à issue existente.

## Não verificado
- Não rodei o fluxo no navegador; não há servidor meu, por regra da lane. A1 e A4 foram reproduzidos com `dist` e dados reais do pack. A2 e A3 vêm da leitura do código dos componentes montados em produção.
