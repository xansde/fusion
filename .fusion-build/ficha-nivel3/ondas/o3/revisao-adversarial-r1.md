# Re-verificação adversarial o3 — rodada 1

Veredito: **REPROVADA** (B1 segue aberto; 1 importante novo no diff do conserto).

## Achados da rodada anterior

| id | estado | prova |
|---|---|---|
| B1 | ABERTO | `prints/` tem só `01-summoner-plano-eidolon-slot.png` (16:53, antes dos fixes). Nenhum print do ator criado, da aba Pets nem smoke GM+player para Summoner/Witch. O fixer não rodou e deixou só um rascunho de issue. |
| I1 | FECHADO (na aba Pets) | `buildMasterRefreshOp` retorna null quando `!hasDailyAbilities` (petsVM.ts:582); `PetCard.svelte` põe o bloco inteiro atrás de `{#if showAbilities}` e o `loadRows` também é guardado; `FUSION.Sheet.Pets.Kind.eidolon` existe em en/pt-BR (pt-BR.json:245). Teste `never refreshes an eidolon`: sem a guarda, o op não sai nulo. petsVM.test.ts 46/46 rodado aqui. |
| I2 | FECHADO (no código) | `companionGrantAllows("familiar")` = `detectFamiliarGrant || detectWitchFamiliarGrant` (companion-grant.ts). Os casos novos de companion-grant.test.ts (23/23 rodado aqui) falham sem o OR. Teste de servidor real `companion-witch-familiar.test.ts` com mestre só-Witch (`rules: []`, sem a feature). Resta a spec desatualizada (N3). |
| I3 | FECHADO no formato pedido (aviso + remoção explícita), mas o predicado está errado (N1) |
| I4 | FECHADO | O matcher casa `already has a companion` e `has no grant for a companion` em minúsculas, que é o texto real de `doc-handlers.ts:576/585`. O teste usa o texto do servidor copiado à mão. Sem o fix, o teste cai em Permission/Generic. |

## Achados novos no diff do conserto

### N1 — importante: aviso de "companheiro obsoleto" dispara com falso positivo e oferece apagar companheiro legítimo
`staleAutoCompanionAfterClassChange` nunca olha a classe ANTERIOR. Marca como obsoleto QUALQUER familiar/pet/eidolon cujo tipo seja diferente do tipo automático da classe NOVA, e `checkStaleAutoCompanion` roda em TODA escolha no card de Classe (PlanColumn.svelte, `case "class"`), inclusive quando o jogador escolhe de novo a mesma classe.
Cenários concretos:
- Wizard com talento Familiar (familiar criado à mão na aba Pets) abre o card Classe e confirma Wizard de novo. Aparece o alerta "vinculado a um(a) Familiar da classe anterior" com o botão Remover, que apaga o ator do familiar.
- Summoner que pegou o talento Familiar. A DEC-PET-03 diz "um Summoner que tomou o talento Familiar tem os dois". Ao escolher Summoner de novo, o familiar é marcado como obsoleto. O teste 2 (`flags the Witch's familiar after swapping to the Summoner`) CODIFICA esse erro.
- Um `pet` (talento geral Pet) é tratado como familiar e também é marcado.
Conserto: receber `oldClassSourceId` (ler o item de classe atual ANTES de aplicar a nova) e marcar só quando `kind === autoCompanionKindForClass(old) && kind !== autoCompanionKindForClass(new)`; nunca marcar `pet`; re-escolher a mesma classe = null. Testes para Wizard+talento e Summoner+talento.

### N2 — menor: FamiliarSheet.svelte ainda mostra "Habilidades 0/0" para o eidolon
A ficha própria do companheiro (FamiliarSheet.svelte:179-191) não usa `hasDailyAbilities`. É só leitura: não tem seletor nem gravação.

### N3 — menor: spec 29 não acompanhou o I2
A tabela da DEC-PET-03 ainda diz que `familiar` exige "talento ou regra que concede familiar". A DEC-PET-04 ("Ordem obrigatória") só cita `detectEidolonGrant/detectFamiliarGrant`. Agora o código também autoriza pelo item de classe Witch (`detectWitchFamiliarGrant`). A regra do PF2e está certa; o que está errado é a spec, fonte de verdade. O conserto do I2 pedia corrigir o REQ/DEC.

### N4 — menor: remoção do obsoleto é fire-and-forget
Se o `doc:delete` falhar, o aviso some e só sobra um console.warn.

## Fora da onda 3, mas é o pedido do Alexandre
Ele relatou: no Animista, selecionar os espíritos não muda a lista de magias, nem o filtro, nem a aba. Isso não pertence à o3, e o fixer só redigiu o texto de uma issue, sem criar nada. Precisa virar issue registrada e frente própria (reproduzir + achar o VM da seleção de espírito) antes da próxima onda.

Não edito nada. Suíte inteira não rodada. Rodados: petsVM.test.ts 46/46, companion-grant.test.ts 23/23.
