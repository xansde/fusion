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

## Menores abertos (revisão da onda 9)

- **Apoio repetido (M-2)**: um replay de "Rolar dano" (ou "Dano" e "Crítico" no mesmo card) soma o 1d8 do Apoio de novo.
- **Prévia do crítico das runas (M-8)**: a prévia não ajusta `deadly`/`fatal` no crítico.
- **Runas além dos espaços (M-8)**: runas de propriedade gravadas acima dos espaços, depois de baixar a potência, ficam invisíveis no editor.
- **`masterActor` (M-12)**: é re-derivado a cada rolagem do companheiro, mesmo sem Presa (custo, não erro).
- **Agarrado/contido (M-6)**: a expiração "até o fim do seu próximo turno" fica só no texto, sem expiração no motor.
- **Carteira (F7-03)**: o "Ajustar carteira" do Mestre não tem campo "motivo" nem registro do ajuste (quem, quando, motivo), que o protótipo T6 mostra.
- **Alcance de golpe (F5-06)**: o Fusion não checa alcance de golpe em lugar nenhum; `isWithinStrikeReach`/`strikeDistance` (alcance a partir de qualquer célula da montaria) estão prontos e testados, sem consumidor. **Decidido (2026-10-06)**: o Fusion não bloqueia nem avisa golpe fora de alcance; o cálculo (inclusive a partir da montaria, F5-06) existe e fica sem uso por decisão do Alexandre (ver decisoes.md).
- **Exceções de elegibilidade (F7-04)**: P1 T1 sem card "Exceções de elegibilidade", sem motivo da exceção e sem "Pedir liberação ao Mestre"; o `system.access` do Noble Bloom foi curado à mão (o importer o apagaria se regenerar o feats-core). O mecanismo de curadoria (`rule-fixes.mjs`, `prerequisiteFixes`) só cobre regras e texto de pré-requisito, não um campo de `system`; por ora um teste de pack (`curated-access-field.test.mjs`) trava o campo.

## Menores abertos (revisão da onda 10)

- **Gate do Apoio lido da cópia embutida (M-10)**: o `requiresMounted` (e o dado) do Apoio é lido da cópia do efeito no ator, que o dono pode editar; ler pela origem (`origin.itemSourceId` -> pack) se o Alexandre quiser anti-cheat. **Decidido (2026-10-06): não fazer** — o Alexandre confia nos jogadores (D-B20); fica como está.
- **Limite de tamanho da manobra sem orador (M-1)**: o servidor só julga o limite quando o payload nomeia `speakerActorId` (e, nesse caso, exige OWNER dele, só nas manobras); sem orador o tamanho de quem rola é desconhecido e a regra não opina. Fechar isso depende da tarefa "Chat não confere a posse do ator que fala".

## Registrados pela correção do L3 (onda 11)

- **Dano persistente do Apoio do antílope (D9)**: o Fusion tem a condição `persistent-damage` (definição) e o `actor:applyCondition` aceita `data`, mas nada aplica o dano no fim do turno, nem faz o teste simples de recuperação, nem funde instâncias do mesmo tipo (a F5-03 do plano de condições não foi construída). O sangramento fica só como anotação no card ("não entra na rolagem"). Ligar exige construir esse ciclo, fora do escopo do Bhrotto.
- **Plano do Bhrotto em inglês na visão do Mestre (D11)**: não é o mecanismo do snapshot (`flags.fusion.i18n`): o Plano traduz nomes por um tradutor que carrega os índices dos packs pelo socket uma vez (`PlanColumn.loadContentTranslator`) e, se o socket ainda não está conectado ou a busca falha, deixa o tradutor nulo para sempre, sem nova tentativa. Hipótese não verificada ao vivo; correção provável: tentar de novo quando a conexão subir.
- **Cosméticos do D10 que ficaram**: rastreador do Mestre sem nome nas linhas, marcador de turno fora do centro do token empilhado, e motivo sobreposto ao título na linha "Chamar Companheiro" desabilitada (aba Ações). Exigem olhar a tela; não foram mexidos às cegas.
- **Pergunta de produto (D7)**: o jogador vê o alvo de um card de dano como "criatura desconhecida" quando o espelho dele não tem o nome (token sem nome próprio e ator oculto). O Mestre vê "Ogro". Se o jogador deve ver o nome de um token visível no mapa, o servidor precisa expor o nome pela redação (hoje só some o alvo oculto); a regra de visibilidade de nome de token (REQ-TOK-060/063) é decisão do Alexandre.
- **Apoio: "Comandado" é estado local da ficha**: o botão Apoio libera depois do Comandar clicado naquela ficha aberta; não há registro por turno no servidor (fechar a janela zera). Se o Alexandre quiser exigir o Comandar do turno (Apoio uma vez por Comandar), é preciso gravar o comando no combate.
- **Linha `support` da aba Ações**: continua no registro (depende de uma ação "support" que nenhum pack tem, nunca aparece); o gatilho real passou a ser o botão da ficha do companheiro. Pode ser removida numa limpeza.
