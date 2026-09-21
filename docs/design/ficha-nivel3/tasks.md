# Fatia 1 — Tarefas por onda

Plano e estado verificado: [`plano.md`](./plano.md). Sondas: `.fusion-build/ficha-nivel3/`.
Branch de integração: **`alfa/app`**. Toda branch de trabalho parte de `origin/alfa/app` com
`git fetch origin` antes — nunca do checkout local.

**Escopo:** criar qualquer uma das 29 classes PF2e, nível 1 a 3, conjuradores incluídos, com a
variante **Arquétipo Livre** ligada e arquétipos **padrão** (multiclasse fora). Equipamento inicial
fora (anotado no papel). Nada de combate, dano ou efeito em alvo.

**Legenda de dependência:** `⇠ T0.3` = depende da T0.3.

---

## Onda 0 — Dado das 29 classes

Sem esta onda nada mais funciona: com o grant morto, nem classe sem escolha monta.
Repo: satélite `xansde/fusion-systems-2e` (+ pin no core).

| id        | tarefa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | onde                                                                                                                                                                                                                                                                                                                                                                                                     | dep          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **T0.0**  | ⚠️ **`git fetch --unshallow` no submodule ANTES da T0.1.** O clone de `external/fusion-systems-2e` é **shallow**: `git merge-base origin/main origin/feat/classes-necromancer-runesmith` volta **vazio**, e o merge morre com `fatal: refusing to merge unrelated histories`. **NUNCA usar `--allow-unrelated-histories` para contornar** — as branches têm ancestral comum real (`073fb5e`), só não fetchado; forçar costura duas árvores como estranhas em cima do pacote de dados das 29 classes.                                                                                                                        | submodule                                                                                                                                                                                                                                                                                                                                                                                                | —            |
| **T0.1**  | Mergear `feat/classes-necromancer-runesmith` (29 classes) no `main` do satélite, **por PR** (a disciplina "PR por onda" vale também para o satélite)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | satélite                                                                                                                                                                                                                                                                                                                                                                                                 | ⇠ T0.0       |
| **T0.2**  | Re-aplicar o guard `KNOWN_CLASS_TRAITS` para as classes novas + teste que falha se um talento de Psychic/Animist aparecer no picker de outra classe                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `planVM.ts` (`KNOWN_CLASS_TRAITS`)                                                                                                                                                                                                                                                                                                                                                                       | ⇠ T0.1       |
| **T0.3**  | ~~Converter o namespace das 350 regras `GrantItem`~~ — **fechada sem conversão**: `materializeGrants` já resolve os grants por NOME (`mapVendorToFusionPack` + match local), 314/349 sem mudança nenhuma no importer. Os 35 restantes são gap real, tratado no allowlist (T0.4).                                                                                                                                                                                                                                                                                                                                            | código do importador: **`external/fusion-systems-2e/tools/importer-pf2e/src/`** (o `tools/importer-pf2e/` da raiz do core é **outro diretório**, untracked, só com dado — ver T5.0); packs `{class-features,feats}-core`                                                                                                                                                                                 | ⇠ T0.1       |
| **T0.3b** | Registrar como **issue separada** os ~5.805 links `@UUID` apontando para `Compendium.pf2e.*` na **prosa das descrições** — link quebrado no texto, não concessão morta. Fora do escopo desta fatia. ✅ issue #90.                                                                                                                                                                                                                                                                                                                                                                                                           | satélite                                                                                                                                                                                                                                                                                                                                                                                                 | ⇠ T0.3       |
| **T0.4**  | Validador de integridade: falhar o build do pack se sobrar `GrantItem` apontando para UUID não resolvível. Categorias: `equipment-out-of-scope`, `archetype-not-imported`, `class-archetype-gap` (issue #92), `blocked-by-issue` (issue obrigatória por entrada — Battle Creed #88, Undead Creator #89).                                                                                                                                                                                                                                                                                                                    | `tools/importer-pf2e/`                                                                                                                                                                                                                                                                                                                                                                                   | ⇠ T0.3       |
| **T0.5**  | Novo pin do submodule no core + `pnpm build` topológico verde                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | core, `external/fusion-systems-2e`                                                                                                                                                                                                                                                                                                                                                                       | ⇠ T0.2, T0.3 |
| **T0.6**  | **Embutir a própria `featuresByLevel` no ator** (buraco 13 do plano, achado na revisão adversarial de 2026-09-21) — não estava no plano original. `applyClass` só criava o item de classe; as features não-escolha (Powerful Fist, Incredible Movement, Mystic Strikes, ...) nunca eram embutidas, só o que ELAS concediam via GrantItem. Toda derivação que lê `doc.items` (speed/itemAlterations/embeddedModifiers/actionsVM) nunca via a regra delas. Embutir na aplicação da classe e no subir/descer de nível, com a mesma identidade `grantedSlot=classFeature:<nível>:<nome>` já usada para o que a feature concede. | satélite: `planVM.ts` (`applyClass`, `levelSet`), `PlanColumn.svelte` (`runClassGrantRefs`, `materializeClassGrantsAtLevel`), `grantMaterializer.ts` (`alreadyGranted`/`itemSourceId` exportados); corolário em `systems/pf2e/src/derivations/embeddedModifiers.ts` (fórmula `5*floor((@actor.level+5)/4)` de Incredible Movement precisava de um avaliador aritmético — valor formula degradava para 0) | ⇠ T0.2, T0.3 |

**Gate da onda:** num mundo real, criar um **Monk** e subir até o 3 — as features de nível 1, 2 e 3
são concedidas de fato (não só listadas). Conferir também **Ranger** e **Guardian**, que dependem
só deste conserto genérico e de pickers já cabeados, e que de outra forma não seriam verificados por
gate nenhum até a Onda 7. Sem isso, não passa.

> ⚠️ **O caminho operacional do gate não está documentado.** Não existe comando de "importar mundo"
> no repo. Antes de rodar a onda, escrever o passo a passo real (subir `fusion serve` num mundo de
> `~/.fusion/worlds/`, porta 33001+) — senão o gate é objetivo mas inalcançável por quem não
> participou do planejamento. Data-dir de teste **fora da worktree**, no scratchpad.
>
> **Automatizado, ainda não ao vivo (2026-09-21):** a fixer round da revisão adversarial provou por
> teste, contra os packs REAIS e pela mesma lógica de produção (`grantMaterializer-realPacks.test.ts`)
> — Monk nível 1 (Powerful Fist + Flurry of Blows embutidos), Monk nível 3 (+ Incredible
> Movement/Mystic Strikes, com a velocidade derivada 25+10=35 rodando o pipeline real) e Guardian
> nível 1-3 (5 features nominadas), tudo idempotente. **O runbook AO VIVO com prints (servidor +
> browser) segue pendente** — é o passo que só falta para fechar o gate por completo.

**Destrava:** Monk, Fighter, Barbarian, Rogue, Magus, Runesmith, Kineticist, **Ranger**, **Guardian**.

---

## Onda 1 — Cabear as 15 escolhas de classe restantes

Padrão já provado (r21-W1). O mecanismo existe: `CLASS_CHOICE_SLOT_OPTIONS` (`planVM.ts:2094`),
que resolve a escolha por `system.traits.otherTags`, ignorando o `ChoiceSet` do vendor (que veio
todo marcado `unsupported`). Já cobre 12 escolhas; faltam 15.

| id       | tarefa                                                                                                                                                                                                                          | nota                                                                                                                                                         | dep         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| **T1.1** | Exemplar: `ikon` + `rootEpithet`                                                                                                                                                                                                | **dados já tagueados** (21 ikons, 6 epítetos) — é literalmente estender a tabela                                                                             | ⇠ T0.5      |
| **T1.2** | Swashbuckler `style`, Gunslinger `way`, Investigator `methodology`                                                                                                                                                              |                                                                                                                                                              | ⇠ T0.5      |
| **T1.3** | Witch `patron`, Druid `order`, Oracle `mystery`, Psychic `consciousMind`, Animist `practice`                                                                                                                                    |                                                                                                                                                              | ⇠ T0.5      |
| **T1.4** | Alchemist `researchField`, Inventor `innovation`, Summoner `eidolon`, Thaumaturge `implement`                                                                                                                                   |                                                                                                                                                              | ⇠ T0.5      |
| **T1.5** | Necromancer `fatalMethod`                                                                                                                                                                                                       | ⚠️ a sonda não achou os documentos-opção — pode ser dado ausente; se for, cai para a T4.3                                                                    | ⇠ T0.5      |
| **T1.7** | Commander: fólio de táticas (quais o Commander conhece no nível 1) — as 37 táticas já existem em `actions-core` como `type: "action"`                                                                                           | fonte: `vendor/.../actions/class/commander/`                                                                                                                 | ⇠ T0.5      |
| **T1.8** | **IDIOMAS** — campo `languages` no schema do personagem (existe em `actor-npc.ts`, **não existe** em `actor-character.ts`), slot de escolha na criação (idiomas da ancestralidade + bônus por Inteligência) e exibição na ficha | **buraco achado na auditoria**: não havia tarefa nenhuma, e é etapa obrigatória da criação em PF2e. Fica **nesta lane** porque o slot passa pelo `planVM.ts` | ⇠ T0.5      |
| **T1.6** | Taguear com `otherTags` os documentos-opção que ainda não têm, na curadoria do importer                                                                                                                                         |                                                                                                                                                              | ⇠ T1.1–T1.5 |

**Gate:** para cada uma das 15, a escolha aparece no picker, é selecionável e **grava no ator**.
**Destrava:** Swashbuckler, Gunslinger, Investigator, Exemplar, Witch, Druid, Oracle, Psychic,
Animist, Thaumaturge e Alchemist (parcialmente — item inicial fora do escopo).

---

## Onda 2 — Conjuração

O caminho crítico da fatia, por decisão do Alexandre (conjurador entra junto, não depois).

| id       | tarefa                                                                                                                                                                                             | onde                                                            | dep    |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| **T2.1** | **Repertório espontâneo**: `spellsKnown` por círculo no schema                                                                                                                                     | `systems/pf2e/src/schema-primitives.ts:223` (`SpellSlotSchema`) | ⇠ T0.5 |
| **T2.2** | Modo "magias conhecidas" no picker (hoje só existe modo "preparar slot")                                                                                                                           | `SpellPickerDialog.svelte`                                      | ⇠ T2.1 |
| **T2.3** | **Lista preparada do dia**: motor sobre os slots que **já estão estruturados** no pack (`system.spellcasting.slots[]`, corretos nos níveis 1-3)                                                    | server + sheet                                                  | ⇠ T0.5 |
| **T2.4** | **Progressão de proficiência de conjuração**: consumir `proficiencyUpgrades[]` — o dado existe, não há **nenhum** consumidor no código                                                             | derivação                                                       | ⇠ T0.5 |
| **T2.5** | **Alimentar o pool de foco**: escrever as `rules` de Composition Spells (Bard), Bloodline Spells (Sorcerer) e Revelation Spells (Oracle), hoje `rules: []` — o pool já existe e já é clampado em 3 | `class-features-core` + curadoria                               | ⇠ T0.5 |

**Gate:** um Bard e um Cleric de nível 3, cada um com os slots e magias corretos, foco em 1 e
proficiência de conjuração no rank certo.
**Destrava:** Bard, Sorcerer, Wizard, Druid, Witch, Oracle, Psychic, Animist (Cleric depende da
onda 4).

---

## Onda 3 — Ator companheiro (Summoner entra, por decisão)

| id       | tarefa                                                                                                             | nota                                                                                                          | dep          |
| -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------ |
| **T3.1** | Modelo de **ator companheiro** no repo (não existe nada: `document.ts` só tem `type` como string livre)            | decide se é ator separado com vínculo ou faceta — ver spec 45 (facetas) e spec 29 (pets/companions/familiars) | ⇠ T0.5       |
| **T3.2** | Eidolon criado junto com o Summoner (a criação passa a gerar **dois** documentos)                                  |                                                                                                               | ⇠ T3.1, T1.4 |
| **T3.3** | Familiar da Witch na criação (obrigatório no nível 1; `familiar-abilities-core` existe e não é usado pelo builder) |                                                                                                               | ⇠ T3.1       |

**Gate:** criar um Summoner nível 1 e o eidolon existir como documento próprio, com ownership certo.

---

## Onda 4 — Dados ausentes

| id       | tarefa                                                                                                                               | nota                                                                                                                                                                                                                                                                                                                                                                 | dep    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **T4.1** | **Pack de divindades** (decisão: puxar) — não existe `deities-*` no repo; já registrado como pendente em `choiceSetInventory.ts:110` | destrava Champion (Sanctification) e Cleric (divindade é escolha obrigatória de nível 1)                                                                                                                                                                                                                                                                             | ⇠ T0.5 |
| **T4.2** | `rules` das **17 de 23** features de nível 1-3 do **Animist** (pior cobertura de todas as 29)                                        |                                                                                                                                                                                                                                                                                                                                                                      | ⇠ T0.5 |
| **T4.3** | Documentos-opção do Fatal Method (Necromancer), se a T1.5 confirmar ausência                                                         |                                                                                                                                                                                                                                                                                                                                                                      | ⇠ T1.5 |
| ~~T4.4~~ | ~~Itens com traço `tactic` (Commander)~~                                                                                             | ✅ **DISSOLVIDA (2026-09-20).** Tática **não é item**: são documentos `type: "action"`, e as **37 já estão no nosso `actions-core`** (a sonda procurou em `equipment-core` e concluiu ausência). O corte de equipamento não atinge o Commander. O que falta é o fólio (quais táticas o Commander conhece) — vira entrada de escolha na **Onda 1**, não dado ausente. | —      |

**Destrava:** Champion, Cleric, Animist, Necromancer.

---

## Onda 5 — Arquétipos padrão (variante Arquétipo Livre ligada)

No recorte 1-3 existe **um único slot de arquétipo, o do nível 2**, e ele **só pode receber uma
dedicação** (todo talento de seguimento exige a própria dedicação; 16/16 no pack têm pré-requisito).
Logo: só as dedicações importam nesta fatia.

| id       | tarefa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | nota | dep |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| **T5.0** | **Pinar a versão do vendor.** O código do importador vive no satélite (`external/fusion-systems-2e/tools/importer-pf2e/src/`, movido na F4) e **já documenta** o procedimento: `git clone --depth 1 https://github.com/foundryvtt/pf2e vendor/pf2e`. O `vendor/` é gitignorado **de propósito** ("Paizo art/proprietary data") — commitar violaria a regra de arte da Paizo. O que falta é só **pinar**: `--depth 1` traz o HEAD do dia. O clone atual está no commit `98cb84fa`, registrado em lugar nenhum. **DECIDIDO (A): pinar.** Registrar a versão no README do importador + aviso do pipeline quando o clone divergir. Secundário (faxina, não bloqueia): a data (`vendor/` 610 MB em disco + `out/` 362 MB derivado) mora no **core**, untracked, enquanto o código mora no satélite — resquício da F4. | —    |

### Pin do vendor (registrado aqui porque só existia num clone gitignorado)

|                |                                                                          |
| -------------- | ------------------------------------------------------------------------ |
| Repositório    | `https://github.com/foundryvtt/pf2e`                                     |
| **Commit**     | `98cb84fa48c8de2048c0b62456e4604bd836bd1a`                               |
| Data do commit | 2026-08-23                                                               |
| Assunto        | ``Make `_validateType` throw errors instead of returning them (#23041)`` |
| Clone atual    | shallow (`--depth 1`)                                                    |

É desta versão que saíram as 29 classes, as 129 dedicações padrão e as 37 táticas do Commander —
ou seja, é a versão que este plano inteiro pressupõe. Reclonar com:

```bash
git clone https://github.com/foundryvtt/pf2e vendor/pf2e
cd vendor/pf2e && git checkout 98cb84fa48c8de2048c0b62456e4604bd836bd1a
```

(sem `--depth 1`, que não permite checkout de um commit arbitrário)
| **T5.1** | Importar as **167 dedicações padrão de nível 2** de `vendor/pf2e/packs/pf2e/feats/archetype/` (das 203 padrão; o resto é nível 4+) | excluir as **29 de multiclasse** (números corrigidos pela auditoria; ver `plano.md`) | ⇠ T5.0, T0.3 |
| **T5.2** | Garantir que a variante Arquétipo Livre seja ligável como **setting de mundo** e que o slot `archetypeFeat` (`planVM.ts:1442`) apareça no nível 2 | o comportamento "dedicação não cabe em slot de classe" **já existe** (`planVM.ts:2008`) — não reimplementar | ⇠ T0.5 |
| **T5.3** | Regra "uma dedicação por vez até pegar 2 talentos dela" | **nunca dispara em 1-3**; implementar com teste cobrindo nível 4+ | ⇠ T5.1 |

**Gate:** criar um personagem nível 2 com Arquétipo Livre ligado e escolher uma dedicação padrão
entre as **167**, sem que nenhuma das **29** de multiclasse apareça na lista.

---

## Onda 6 — O jogador cria (decisão 2)

Independente das ondas 1-5; pode correr em paralelo depois da 0.

| id       | tarefa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | nota                                                                                                                                                                                        | dep          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **T6.1** | O jogador cria e edita o **próprio** ator pelo Hub (spec 28)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | o Mestre também pode criar; o jogador tem autonomia sobre o próprio ator                                                                                                                    | ⇠ T0.5       |
| **T6.2** | **Validação de criação no servidor** — o client não decide sozinho o que é build legal (regra do projeto: toda validação de permissão é no servidor)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |                                                                                                                                                                                             | ⇠ T6.1       |
| **T6.3** | Ownership do ator (e do companheiro, se a onda 3 tiver passado)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | usar `documents/ownership.ts` e a redação existente; nunca duplicar predicado                                                                                                               | ⇠ T6.1       |
| **T6.4** | **Edição concorrente Mestre × jogador do mesmo ator** — cenário de rotina, já que o Mestre também pode criar/editar. Existe infra de versão otimista no servidor (`expected-version.test.ts`, `documents-concurrency.test.ts`); esta tarefa é ligar o fluxo de criação nela e **testar o cenário**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **buraco achado na auditoria**: eu levantei o cenário ao descrever a onda e nunca virou tarefa                                                                                              | ⇠ T6.1       |
| **T6.5** | **Gatilho de UI para criar personagem — auditado, sem código de UI novo.** Investigação (lane `ficha3/o6b`, 2026-09-21): a resposta a "onde o jogador cria a ficha" **já está fechada por três specs entrelaçadas** — `37` §5.6 (REQ-CFG-050/051/051a) diz que criar um usuário PLAYER/TRUSTED já nasce com um personagem em branco, do qual ele é `OWNER`; `42` DEC-NPC-01/02 diz que a aba NPCs e a aba Contatos NÃO oferecem criar personagem, e que criar um **segundo** personagem é [V2] (REQ-NPC-055a); `39` REQ-CTT-014/020/022/027 diz que TODO personagem de jogador aparece na seção "Na mesa" de Contatos, marcado "você" quando é o do próprio viewer, com duplo-clique abrindo a ficha. Um botão novo de "Criar personagem" violaria REQ-CFG-051a e REQ-NPC-055a diretamente — e o próprio O6 fixer r1 (C5/C6) já REMOVEU um `doc:create` redundante pelo mesmo motivo (ver `doc-handlers.ts`, comentário "Player-created OWN character — REMOVED", e o cabeçalho de `player-character-create.test.ts`). A cadeia (REQ-USR-025 → snapshot de entrada do socket → card "Na mesa" → duplo-clique → `CharacterSheet` com a coluna Plano visível por padrão, `planVisible = $state(true)`, DEC-R10-05) já existia e já foi provada AO VIVO no smoke C7 do fixer r1 (`ficha3-reports/o6/fix-r1.md`, prints `prints-fix-r1/21-24`) — mas nunca tinha virado teste automatizado, nem componente nem fluxo real. Esta tarefa fecha essa lacuna de PROVA (não de produto): teste de componente (`ContactsPanel.test.ts`, card sem `system` nenhum, shape exata do `createUser`) + teste de fluxo real via socket (`player-character-create.test.ts`, `resync:full` do dono carrega o próprio personagem; do GM também; de um terceiro jogador, não — **essa negativa vale só para o snapshot de join; broadcast ao vivo, replay de delta e eco do ack ainda divergem, issue `xansde/fusion#240`, achado C1 do fixer r1 da o6b**). | **achado da auditoria da o6b**: o pedido original pressupunha um gatilho ausente; a investigação achou que ele já existe e que construir um novo contradiria decisão fechada (`DEC-NPC-02`) | ⇠ T6.1, T6.3 |

**Gate:** smoke como GM e como player, conforme `docs/design/PROCESSO-UI.md` (T6.1-T6.4, já feito
ao vivo no fixer r1/C7). **T6.5 acrescenta a prova automatizada** da mesma cadeia até o card/o
duplo-clique/a ficha (`ContactsPanel.test.ts` + `player-character-create.test.ts`, ambos verdes) —
a asserção negativa de "outro jogador não vê" prova **só o snapshot de join**, não os outros três
caminhos de emissão do REQ-NET-096 (broadcast, replay, eco), que hoje divergem do snapshot
(`xansde/fusion#240`, achado C1 do fixer r1).

---

## Onda 7 — Aceite não-circular

A lição #48: conferir a derivação contra a tabela do próprio pack é teste circular — 80 testes
verdes conviveram com 60 defeitos. A fonte da verdade tem que ser **externa ao pack**.

| id       | tarefa                                                                                                                                                    | dono          | dep         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------- |
| **T7.1** | Arquivo-molde de ficha de referência: HP, CA, três salvaguardas, proficiências, perícias treinadas, talentos concedidos, slots e magias por círculo, foco | time          | —           |
| **T7.2** | Teste comparador: cria a personagem pelo builder e confronta com o molde preenchido                                                                       | time          | ⇠ T7.1      |
| **T7.3** | Roteiro `tutorial-e2e` da criação, com prints (obrigatório por `PROCESSO-UI.md`)                                                                          | time          | ⇠ ondas 0-6 |
| **T7.4** | **Preencher os moldes à mão, lendo o livro, e executar o e2e**                                                                                            | **Alexandre** | ⇠ T7.1      |

### Escopo do aceite — DECIDIDO: **as 29 classes**

O Alexandre decidiu (2026-09-20) montar ficha de referência à mão para **todas as 29 classes**, não
uma amostra. É o aceite mais forte possível: cada classe passa a ter uma fonte de verdade externa
ao pack.

**Ordem de execução das 29** — primeiro um representante de cada família, para que defeito de
**mecanismo** apareça cedo e seja consertado antes de contaminar as outras 21; depois o resto, que
vira cobertura de **dado** por classe:

| Lote       | Classes                                                               | Por quê primeiro             |
| ---------- | --------------------------------------------------------------------- | ---------------------------- |
| **1 (8)**  | Fighter, Ranger, Cleric, Bard, Magus, Alchemist, Summoner, Kineticist | um por família de mecanismo  |
| **2 (21)** | as demais                                                             | cobertura de dado por classe |

**Chassi comum.** Para baratear o trabalho manual e tornar as divergências atribuíveis, as 29 fichas
usam a **mesma ancestralidade, mesmo antecedente e mesma distribuição de atributos**, variando só a
classe. Assim, se um número diverge, a causa está na classe — não na combinação.

> ⚠️ **O molde NÃO pode vir pré-preenchido a partir dos nossos packs.** Isso reintroduziria
> exatamente a circularidade da #48. O que o molde traz pronto: os campos a preencher e o chassi
> comum (escolhas do Alexandre). O que fica **em branco, sempre**: tudo que o sistema deriva — HP,
> CA, as três salvaguardas, ranks de proficiência, talentos concedidos, slots e magias por círculo,
> pontos de foco, idiomas.

---

## Ordem de execução

**Corrigida em 2026-09-20 pela auditoria de orquestração.** A versão anterior punha O1, O2, O4, O5 e
O6 em paralelo — errado por dois motivos: colisão de arquivo e estouro do teto de worktrees.

```
O0 ──► O1 ──┬── O2 ──┐
            ├── O4 ──┤
            ├── O3 ──┼── O7
            ├── O5 ──┤
            └── O6 ──┘
```

- **O0 é serial e bloqueia tudo.**
- **O1 fecha ANTES de O2 e O4 começarem.** A curadoria é **um arquivo por classe**, não um arquivo
  por assunto: a T1.6 tagueia `curation/classes/oracle.json` e `animist.json`, os mesmos arquivos
  que a T2.5 (rules de Revelation Spells) e a T4.2 (rules do Animist) editam. Em paralelo isso não
  dá conflito de merge — dá **reversão silenciosa**. Serializar a O1 é barato: ela é a onda mais
  leve (cabeamento, esforço baixo, uma lane).
- Depois da O1: O2, O3, O4, O5 e O6 podem correr em paralelo **até o teto de 3 worktrees**
  simultâneas — são 5 ondas para 3 vagas, então rodam em dois lotes. O3 depende também da T1.4;
  a T4.3 depende da T1.5 (ambas dentro da O1, já fechada neste ponto).
- **O7 fecha.**

## Como rodar (disciplina acordada)

- **Uma lane por tarefa**: implementar → verificar → corrigir → re-verificar acontece **dentro** do
  subagente dono da tarefa, que devolve só o veredito final. Nada de pingue-pongue pelo orquestrador.
- **Sem verificador dedicado por lane** — foi caro demais na onda 5 do Alquimista (6 lanes, 6
  verificadores, 6 aprovações, nenhuma correção). A verificação é do dono da tarefa.
- **Revisão adversarial do diff integrado por onda**, não por lane: nas ondas 2 e 3 do Alquimista,
  todas as lanes verdes e o gate verde conviveram com 5 bloqueantes.
- **Retorno de ~15 linhas** por subagente; relatório completo em arquivo.
- **Toda pendência vira issue registrada** no repo certo antes da onda seguinte — nada fica só no
  relatório.
- **PR por onda** contra `alfa/app`, revisável. Merge é sempre ato humano.
