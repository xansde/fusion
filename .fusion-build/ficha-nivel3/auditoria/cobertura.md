# Auditoria adversarial — cobertura do escopo (Fatia 1: ficha nível 1-3)

Fontes lidas: `docs/design/ficha-nivel3/{plano,tasks,execucao}.md` +
`external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts`,
`.../plan/*.svelte`, `systems/pf2e/src/schemas/actor-character.ts` vs `actor-npc.ts`,
`packages/server/src/documents/ownership.ts` + testes de versão (`expected-version.test.ts`,
`documents-concurrency.test.ts`).

## 1. Etapas da criação ausentes do plano

| Etapa PF2e | Existe no código? | Tem tarefa? |
|---|---|---|
| Ancestralidade, herança, antecedente, classe | Sim (`ABCCard.svelte`) | — |
| Boosts de atributo (+ método alternativo) | Sim (`AbilityBoostsDialog.svelte`) | — |
| Perícias treinadas + aumento de perícia | Sim (`skillTraining`/`skillIncrease` slots) | — |
| Talentos ancestralidade/classe/perícia/geral | Sim (`ancestryFeat`, `classFeat`, `skillFeat`, `generalFeat` slots, `planVM.ts:422-425`) | — |
| HP, CA, salvaguardas, velocidade, sentidos | Derivação (`derivations/build`), fora do escopo desta auditoria mas presente | — |
| **Idiomas conhecidos** (ancestralidade + INT) | **NÃO.** `actor-character.ts` não tem campo `languages` nenhum — só `actor-npc.ts` tem. Nenhum slot, nenhum picker, nenhuma menção em `plano.md`/`tasks.md`. | **NÃO** |
| Detalhes (nome/divindade/alinhamento-crença/idade) | Nome = campo trivial do documento; divindade coberta por T4.1 (Onda 4); alinhamento/crença/idade não aparecem em código nem no plano | Parcial (só divindade) |

## 2. Classes sem tarefa nominal em NENHUM gate

Das 29, todas têm caminho técnico (o fix genérico T0.3 do `GrantItem` + os pickers já
cabeados cobrem qualquer classe). Mas **Ranger e Guardian nunca aparecem como "destrava"**
em nenhum gate de onda (Onda 0, 1, 2 ou 4) — dependem só do conserto genérico e não têm
nenhuma verificação nomeada em lugar nenhum antes da Onda 7. Guardian é citado apenas como
*exemplo* do bug do grant morto (plano.md linha ~51), nunca listado num "Destrava:".
Todas as outras 27 aparecem em pelo menos um "Destrava:" de alguma onda.

## 3. Subida de nível

`levelSet`/`levelUp` (`planVM.ts:5187-5224`) só faz dois writes: bump de
`system.level.value/details.level` e resync do `max` dos slots de magia já preparados.
Os slots de talento (`ancestryFeat`/`classFeat`/`generalFeat`/`skillFeat`/`skillIncrease`)
são **derivados ao vivo** a cada render, iterando `for (let lvl = 1; lvl <= level; lvl++)`
(`planVM.ts:1131,4986`) — então "criação = level-up" procede: não falta tarefa aí.
O que falta mesmo (aumento de proficiência de conjuração, alimentação do pool de foco) já
está nomeado em T2.4/T2.5.

## 4. Nível 2 e 3

Nível 2 (talento de classe) e nível 3 (talento geral + aumento de proficiência) têm slot
próprio no código (`generalFeat-3`, `classFeat-2`) — cobertos. Aumento de proficiência
GERAL (não só conjuração) do nível 3 não foi auditado a fundo aqui; fora do orçamento desta
rodada.

## 5. Onda 6 — jogador cria

- Criação pelo Hub, ownership e validação no servidor têm tarefa (T6.1-T6.3).
- **Edição concorrente Mestre×jogador do mesmo ator não é mencionada** em T6.1-T6.3, apesar
  de pedida explicitamente no brief. Existe infra genérica de versão otimista no server
  (`expected-version.test.ts`, `documents-concurrency.test.ts`, `documents/store.ts`) que
  provavelmente já resolve o caso, mas o plano não cita reaproveitá-la nem testa o cenário
  de dois editores simultâneos.

## 6. Escopo sem tarefa nenhuma

- Idiomas conhecidos (item 1).
- Alinhamento/crença/idade como campos de personagem (item 1) — provavelmente não-bloqueante
  por serem texto livre, mas o brief pediu para verificar e não têm menção nenhuma.

## Retorno resumido

BLOQUEANTE — idiomas conhecidos (schema não tem campo, nenhum slot/picker) — tem tarefa? NÃO
IMPORTANTE — Ranger e Guardian nunca aparecem em "Destrava" de gate nenhum — tem tarefa? implícita, não nomeada
IMPORTANTE — edição concorrente Mestre×jogador (pedida no brief) não endereçada em T6.1-T6.3 — tem tarefa? NÃO
IMPORTANTE — Onda 7 não dimensiona quantas/quais das 29 classes recebem ficha-molde de referência — tem tarefa? parcial (T7.1/T7.4 sem escopo numérico)
MENOR — alinhamento/crença/idade do personagem sem menção — tem tarefa? NÃO (provável não-bloqueante)
MENOR — Guardian citado só como exemplo de bug, nunca listado como "destravado" nominalmente — tem tarefa? sim (implícita via T0.3), rastreio ruim

Classes sem caminho algum: 0 de 29 (todas alcançáveis pelo fix genérico + pickers), mas 2
(Ranger, Guardian) sem qualquer verificação nomeada antes da Onda 7.
