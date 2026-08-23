# DEC-MC-01 — O Elfo Ancião não concede dedicação de multiclasse

**Data:** 2026-08-23 · **Decisor:** Alexandre · **Status:** vigente
**Escopo:** conteúdo PF2e (`heritages-core`), builder de personagem do client

## O que foi decidido

A herança **Ancient Elf / Elfo Ancião** **deixa de conceder** o talento de dedicação
de multiclasse que as regras do PF2e lhe dão. A concessão fica **desativada, não
apagada**: o documento continua no banco de conteúdo, com a regra guardada e a
justificativa junto, pronta para voltar.

> "Não faz sentido, se vamos refazer a multiclasse."

A multiclasse do Fusion vai ser redesenhada do zero. Ligar agora uma porta de entrada
para ela — ainda por cima uma que nunca funcionou — seria construir em cima do desenho
que vai cair.

## O que a herança fazia (e por que não funcionava)

Pelas regras: *"Escolha uma classe diferente da sua. Você ganha o talento de dedicação
de multiclasse daquela classe, mesmo sem cumprir o pré-requisito de nível."*

O vendor modela isso como um par de rule elements:

| Rule element | Papel | Estado no Fusion |
| --- | --- | --- |
| `ChoiceSet` (flag `ancientElf`) | pergunta ao jogador **qual** dedicação | **nunca convertido** — a escolha jamais chegou a aparecer na ficha |
| `GrantItem` → `{item\|flags.system.rulesSelections.ancientElf}` | concede **o que foi escolhido** | ativo, apontando para uma escolha que ninguém faz |

O resultado prático: a concessão apontava para um placeholder que nunca era resolvido.
Toda vez que a herança entrava numa ficha, o `grantMaterializer` do client registrava a
regra como `unresolved-placeholder`. Ou seja — o jogador **nunca** ganhou a dedicação;
o que existia era o ruído de tentar concedê-la.

Desativar não tira nada do jogador. Tira o ruído.

## Como ficou no dado

A desativação é **declarativa e reprodutível**, não um patch à mão no
`documents.json` (que a próxima execução do importer reverteria em silêncio — a mesma
armadilha que `prerequisiteFixes` já resolvia para texto de pré-requisito):

- **`tools/importer-pf2e/src/curation/disabled-rules.mjs`** — a decisão como dado:
  qual pack, qual documento, qual regra, qual decisão, qual motivo. Aplicada dentro de
  `writePack()`, então vale para qualquer pack (pf2e e sf2e) sem depender de alguém
  lembrar de chamá-la num bloco novo.
- **Efeito no documento**: a regra sai de `system.rules[]` e entra em
  `flags.fusion.disabledRules[]` como `{ decision, decidedOn, reason, rule }` — inteira,
  não resumida.
- **`flags.fusion.unconvertedRules` fica intacto**: o `ChoiceSet` continua ali porque é
  o registro do que o vendor manda, e é dele que o inventário de escolhas do client se
  alimenta.
- **Mundos já existentes**: a herança é copiada para dentro do ator quando entra na
  ficha, então a cópia embutida carrega a regra antiga. Os mundos em uso são migrados
  com o mesmo formato (`flags.fusion.disabledRules`) — ver "Migração" abaixo.

No client, `choiceSetInventory.ts` ganhou o estado **`desativado`**: a escolha sai da
fila de dívida (`pendente`, trabalho a fazer) e passa a escopo fechado (decisão tomada).
A distinção importa — `pendente` é uma promessa ao jogador que ainda não foi cumprida;
`desativado` é uma promessa que decidimos não fazer por enquanto.

## O alarme continua ligado

Três testes guardam a decisão contra uma regeneração de pack feita sem a curadoria:

- `tools/importer-pf2e/src/__tests__/disabled-rules.test.mjs` — o mecanismo (desativar
  move, não apaga; declaração cuja regra sumiu do vendor **lança** em vez de virar
  no-op) e o pack commitado.
- `packages/client/src/lib/sheets/pf2e/__tests__/choice-sets.test.ts` — a classificação
  no inventário e a ausência de concessão ativa no pack.
- O portão que já existia: escolha nova nos packs sem entrada no inventário reprova a
  suíte.

## Como reverter

Quando a multiclasse for refeita: apagar a entrada `Ancient Elf` de
`curation/disabled-rules.mjs` e regerar o pack. Nada mais — não há patch à mão para
desfazer em lugar nenhum. Os testes acima vão reprovar até serem atualizados junto,
o que é o comportamento desejado: a volta da concessão tem de ser deliberada.

E aí vale reabrir a pergunta que ficou de fora daqui: o `ChoiceSet` do Elfo Ancião
("qual dedicação você ganha") continua sem ser oferecido no builder. Reativar a
concessão sem oferecer a escolha reproduziria exatamente o defeito que esta decisão
fechou.

## Migração dos mundos existentes

**Migration 010** (`packages/server/src/db/migrations/010_dec_mc_01_ancient_elf.ts`)
faz nas cópias embutidas o mesmo que a curadoria faz na fonte: encontra a herança pelo
`flags.fusion.sourceId` (identidade de documento no Fusion — nome é homônimo em
potencial no PF2e) e move a concessão para `flags.fusion.disabledRules`. Roda sozinha na
próxima abertura do mundo, com o backup pré-migração que o framework de migrações já
faz. Um documento migrado e um recém-importado ficam indistinguíveis.

Cobre `actors` (itens embutidos) e `items` (documentos soltos), e é idempotente: o que
já foi movido não tem como ser movido de novo.

## Relacionados

- `tools/importer-pf2e/src/curation/disabled-rules.mjs` — a decisão como dado
- `packages/client/src/lib/sheets/pf2e/choiceSetInventory.ts` — estado `desativado`
- `packages/client/src/lib/sheets/pf2e/grantMaterializer.ts` — quem reportava o
  `unresolved-placeholder`
- `packages/server/src/db/migrations/010_dec_mc_01_ancient_elf.ts` — a migração dos
  mundos já criados
