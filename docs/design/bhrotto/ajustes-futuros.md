# Bhrotto — ajustes futuros

Ajustes já decididos pelo Alexandre, ou achados menores abertos, que ficam para depois. Cada entrada diz o que muda,
o que toca e de onde veio. O comportamento de hoje continua até alguém pegar o ajuste.

## Aplicar condição usa o alvo da rolagem

- **O que muda**: o botão "Aplicar condição" do card passa a usar o alvo da rolagem (a foto da mensagem,
  `targetSnapshot`) em vez da mira atual na hora do clique. É o que a regra pede (RAW).
- **Hoje**: sem `source.messageId`, `actor:applyCondition` aplica em quem está mirado no clique (decidido em
  2026-10-06: manter por enquanto).
- **Toca**: o contrato REQ-SYS-142 do Alquimista (ALQ-F1-09), de outra frente.
- **Origem**: I-5 da revisão da onda 7.

## Menores abertos (revisão da onda 7)

- **Caçador de Monstros**: o hook do crítico não confere que a rolagem-pai é um card `hunt-prey`.
- **"1×/dia por criatura" (DC-04)**: só exibido, não aplicado pelo servidor.
- **Companheiro órfão**: o `grantSlotId` continua o antigo no servidor depois de voltar ao sub-slot vazio.

## Chat não confere a posse do ator que fala (pré-existente)

- **O que muda**: o servidor passa a exigir OWNER do `speakerActorId` de quem não é privilegiado (ou descarta o
  `actorId` do speaker sem posse).
- **Hoje**: `chat-handler.ts:508-513` aceita o `speaker.actorId` do payload sem checar posse, e
  `sanitizeAbilityCard` (`:2237-2241`) só exige `casterActorId === speakerActorId`. Dá para forjar um card (ex.:
  "comanda o urso") em nome de ator alheio.
- **Gravidade**: média-baixa. O MAP, a CD e o dano já conferem posse (aplicar dano exige OWNER do ator que fala);
  sobram a personificação no chat e registros falsos.
- **Origem**: I-8 da revisão da onda 8. Tarefa própria da faixa A; fora do escopo da onda 8.

## Montado em token não vinculado: só o efeito (corrigido), não o resto

- O efeito "Montado" de token não vinculado vai para a `actorDelta.items` do token (I-5, REQ-BHR-187). Ao
  desmontar, `releaseDismountedRider` tira de lá. Um ator **vinculado** presente em duas cenas continua perdendo o
  efeito nas duas ao desmontar uma só (a flag é do ator). Raro; fica como está.

## Menores abertos (revisão da onda 8)

- **`doc:update` do Mestre que liga `active`** (`doc-handlers.ts:987-1033`): não recusa com montaria nem troca o
  token; com dois "ligar" no mesmo lote, vence o último. Nenhuma UI escreve esse caminho: é edição livre do Mestre.
- **Flag velha no cliente**: `token-interaction.ts:60` bloqueia o arraste de quem tem `mountTokenId` sem conferir a
  reciprocidade (o `TokenLayer._stackRiders` já confere). O jogador sai pelo Montar, então não fica preso.
- **Empilhamento sem teste**: `TokenSprite.setMountStack` e `TokenLayer._stackRiders`; `container.scale.set(0.5)`
  encolhe barras, nameplate e selo de presa; o `addChild` a cada render reordena o z. Prints do fechamento do lote.
- **Posição lógica ≠ desenhada**: o cavaleiro fica gravado ao lado da montaria e é desenhado por cima. Medição e
  alcance usam a célula gravada até a F5-06; a spec 07 e a F5-06 precisam saber disso.
- **Ordem do lote do Mestre**: o lote "cavaleiro, depois montaria" desmonta; só "montaria, depois cavaleiro" tem teste.
- **Velocidade da montaria carregando cavaleiro**: a metade "usa só a Velocidade terrestre" da REQ-BHR-178 não está
  implementada (`mountedMovementBlock` sem fiação); o servidor já recusa mover o cavaleiro.
- **Pack ausente**: sem o efeito "Montado" no compendium, Montar grava o par sem o −2, em silêncio. Hoje só há
  comentário; vale um aviso no log.
- **F5-05, testes e redação**: os testes de desmonte gravam a cena por SQL e chamam `republishScene` à mão (falta
  teste de socket de `mount:mount`/`mount:dismount` → `onMountChanged`); cavaleiro não-combatente atacando no turno
  da montaria combatente não conta; `byActor[partnerActorId]` expõe actorId e contagem de um parceiro oculto
  (`redaction.ts:1009-1016`).
- **Card de Comandar**: o artigo "o" é fixo ("comanda o Luna"; a REQ-CHT-063 não tem artigo) e, com companheiro
  presente, a linha usa sempre a variante automática, mesmo mirando outro animal (para outro animal vale Natureza
  contra Vontade).
- **Troca de token do Chamar Companheiro**: o token novo copia flags e disposição do antigo; mira ou seleção
  apontando para o `_id` apagado fica órfã; a escrita não é atômica (atores e depois cenas).
- **Testes da aba Ações e da aba Pets leem o fonte** (`commandAnAnimal.tab.test.ts`, `companionActive.render.test.ts`):
  o satélite só tem `svelte/server` (SSR, sem DOM nem `@testing-library`), então `ActionsTab` não monta em teste e o
  clique (`useExecutable`) não tem prova executável. Sair disso pede extrair o despacho para uma função pura ou
  adotar um ambiente de DOM.
- **Processo**: `doc-handlers.ts` (arquivo-gargalo da §3) foi tocado por duas lanes na mesma onda; o merge saiu limpo.
