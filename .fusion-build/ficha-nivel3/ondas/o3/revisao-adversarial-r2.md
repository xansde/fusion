# Re-verificação adversarial o3 — rodada 2

Veredito: REPROVADA (B1 bloqueante continua aberto; N1 fechado; nenhum achado novo bloqueante/importante).

## Status por achado

| Id | Status | Prova |
|---|---|---|
| N1 | FECHADO | petsVM.ts:504-518: `oldKind = autoCompanionKindForClass(old)`, retorna null se `!oldKind || oldKind === newKind`, flaga só `c.companionKind === oldKind` (sem normalizar pet). PlanColumn.svelte:986-995: `checkStaleAutoCompanion(doc2)` roda ANTES de `sendAll(applyClass(...))`, e `abcCurrentSourceId("class")` lê o item de classe atual do `doc`, ou seja, a classe antiga. Testes novos (Wizard+talento re-escolhendo Wizard; Summoner+talento re-escolhendo Summoner; pet em troca real; eidolon+pet; sem classe antiga) falhariam no código antigo: com o código antigo, re-escolher Wizard dava newKind=null e o familiar (!== null) era marcado. petsVM.test.ts 51/51 rodado aqui. |
| B1 | ABERTO | `prints/` só tem `01-summoner-plano-eidolon-slot.png`: não há print do ator criado, nem da aba Pets, nem smoke GM+player. O fixer abriu a issue #241, mas não rodou nada. A evidência continua faltando. |

## Ataque ao diff do conserto (sem achado novo)

- Witch com `pet` (talento Pet) trocando para Wizard: o pet não é marcado. Está correto: pet e familiar dividem o mesmo slot (`companionGroupOf`, spec 29 §1.3), então o auto-create da Witch foi pulado e o pet é do jogador.
- Witch cujo familiar veio de um talento Familiar tomado antes, trocando para Wizard: o familiar é marcado. Isso é falso positivo de borda, mas o aviso é dispensável e nunca apaga sozinho. Menor, não registro.
- Variante multiclasse (`classLevelsOn`): a troca não passa pelo card de Classe, então não há aviso. Isso já existia antes e é falso negativo, não regressão.
- Comentário de `buildAutoCompanionOp` (petsVM.ts:533-535) diz "no pet normalization needed", mas o código normaliza. É incoerência cosmética e já existia; menor.

## Fora da onda

O feedback do Alexandre sobre o Animista (selecionar espírito não muda lista de magias/filtro/aba) não pertence à o3. O fixer registrou como issue #242.

Não editei nada. Não rodei a suíte inteira.
