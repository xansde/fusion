# Bhrotto — ajustes futuros

Consolidado no fechamento da frente, por tema. Cada linha diz o que falta e de onde veio (D/I/M = achado da onda ou
revisão; REQ = requisito). O comportamento de hoje continua até alguém pegar o item. Itens resolvidos ou decididos
saíram (ver [decisoes.md](decisoes.md)).

## Decididos pelo Alexandre em 2026-10-07 — feitos

- **Condições do monstro Conhecido**: o jogador vê as condições (REQ-CTT-086, PR #320).
- **Migração de regra nova do pack**: sync das regras dos itens embutidos no boot (REQ-CMP-056, PR #319).
- **Tipo de dano**: "cortante", "perfurante", "contundente" (PRs #318 e satélite #476). Texto corrido das descrições
  dos packs (~100 ocorrências de "dano de corte" etc.) ficou como está; o `fix-missing-accents.mjs` ainda reintroduz
  "concussão" se o pipeline de tradução rodar de novo.

## Combate e dano

- **Aplicar condição usa o alvo da rolagem**: hoje usa a mira no clique; RAW pede a foto da mensagem (`targetSnapshot`).
  Toca o contrato REQ-SYS-142 do Alquimista (I-5, onda 7).
- **Servidor não confere slug nem grau (M2, onda 12)**: `computeApplyCondition` aplica qualquer slug em qualquer alvo da
  foto; "oferecido, não aplicado" é garantia só do cliente.
- **Apply de dano não propaga o ator**: `computeApplyDamage` não emite `doc:update`; conferir se a barra de PV do token
  anda sozinha (onda 13).
- **Apoio repetido (M-2, onda 9)**: replay de "Rolar dano" (ou "Dano" e "Crítico" no mesmo card) soma o 1d8 de novo.
- **Dano persistente do Apoio do antílope (D9, onda 11)**: falta o ciclo da condição (dano no fim do turno, teste de
  recuperação, fusão de instâncias; F5-03 do plano de condições). Sangramento fica só como anotação no card.
- **Penalidade de alcance por incremento**: `ignore-range-penalty:2` da presa é inerte porque o Fusion não tem a
  penalidade; ligar exige construí-la (gate BHR-F2-09, onda 11).
- **Marcador `grants-hunt-prey`**: inerte, sem leitor nem efeito de jogo (gate BHR-F2-09).
- **Caçador de Monstros**: o hook do crítico não confere que a rolagem-pai é um card `hunt-prey` (onda 7).
- **"1×/dia por criatura" (DC-04)**: só exibido, não aplicado pelo servidor (onda 7).
- **Prévia do crítico das runas (M-8, onda 9)**: não ajusta `deadly`/`fatal`. Runas de propriedade acima dos espaços,
  depois de baixar a potência, ficam invisíveis no editor.
- **Agarrado/contido (M-6, onda 9)**: expiração "até o fim do seu próximo turno" só no texto, sem expiração no motor.
- **Persistente não dobra**: mantido como decisão da mesa, não conferido como RAW remaster (onda 13).
- **Cavaleiro não-combatente (F5-05, onda 8)**: atacando no turno da montaria combatente não conta.

## Condições e cards

- **Ícone de Caído (e de qualquer condição) no token**: `TokenSprite` só desenha barras, nome e selos; o ator já é
  propagado, falta o consumidor visual (D2 onda 12; onda 13).
- **Estado "aplicado" do card (I1, onda 12)**: depende do registro do servidor; alvo fora do espelho do jogador segue
  "aplicado ✓" depois que a condição sai; condição aplicada por outro caminho não aparece.
- **Recusa genérica por código (M5, onda 12)**: FORBIDDEN junta "alvo fora da foto", "card de outro dono" e "fora da
  mira viva"; separar pede código novo no protocolo.
- **Foto de alvo do card de manobra**: outras fontes que nomeiem a mensagem do botão sem foto própria seguem o mesmo
  caminho; sem caso conhecido (onda 12).
- **Condição em alvo de token oculto**: `broadcastChangedActors` leva o ator com a condição ao jogador mesmo com o token
  escondido (onda 13).
- **Botão Comandar/Apoio (M2, onda 11)**: não troca o texto para "Comandado (2 ações)" nem mostra o bloco "Apoio
  aplicado" do protótipo; é UI.
- **Card de Comandar (onda 8)**: artigo "o" fixo ("comanda o Luna", REQ-CHT-063); com companheiro presente usa sempre a
  variante automática, mesmo mirando outro animal.
- **Sabor do dano (M3, M5, M7, M8 da correção do L3)**: alvo com `actorId` nulo e token público vira "criatura
  desconhecida"; `NpcSheet.svelte:303` e sabor de magia com slug cru do tipo; dois companheiros do mesmo tipo (cliente
  não diz qual foi clicado); sem teste de componente do `damageRollFlavor`.

## Companheiros e montaria

- **Velocidade da montaria carregando cavaleiro**: metade "usa só a Velocidade terrestre" da REQ-BHR-178 sem fiação
  (`mountedMovementBlock`); o servidor já recusa mover o cavaleiro (onda 8).
- **Pack ausente**: sem o efeito "Montado" no compendium, Montar grava o par sem o −2, em silêncio; vale aviso no log.
- **Montado em ator vinculado presente em duas cenas**: perde o efeito nas duas ao desmontar uma só (flag é do ator).
  Raro (I-5, REQ-BHR-187).
- **`doc:update` do Mestre que liga `active`** (`doc-handlers.ts:987-1033`): não recusa com montaria nem troca o token;
  com dois "ligar" no lote vence o último. Edição livre do Mestre.
- **Flag velha no cliente**: `token-interaction.ts:60` bloqueia o arraste sem conferir reciprocidade.
- **Posição lógica ≠ desenhada**: cavaleiro gravado ao lado da montaria e desenhado por cima; medição e alcance usam a
  célula gravada (spec 07 e F5-06 precisam saber).
- **Empilhamento sem teste**: `TokenSprite.setMountStack` e `TokenLayer._stackRiders`; `scale.set(0.5)` encolhe barras,
  nameplate e selo de presa; `addChild` a cada render reordena o z.
- **Ordem do lote do Mestre**: só "montaria, depois cavaleiro" tem teste; "cavaleiro, depois montaria" desmonta.
- **Companheiro órfão**: `grantSlotId` continua o antigo no servidor depois de voltar ao sub-slot vazio (onda 7).
- **Troca de token do Chamar Companheiro**: token novo copia flags e disposição; mira/seleção para o `_id` apagado fica
  órfã; escrita não atômica (onda 8).
- **Chamar Companheiro montado sem resposta (N3)**: linha habilitada, clique sem efeito nem motivo; desabilitar com o
  motivo ou mostrar a recusa do servidor (onda 11).
- **`masterActor` (M-12, onda 9)**: re-derivado a cada rolagem do companheiro, mesmo sem Presa (custo, não erro).
- **Linha `support` da aba Ações**: depende de ação "support" que nenhum pack tem, nunca aparece; pode sair numa limpeza.
- **+1d8 do Apoio do urso no card de dano**: não verificado ao vivo (L3), coberto só por teste.
- **Ramo morto `ANIMAL_COMPANION_GRANT_SOURCE_IDS` (M-2, gate)**: a concessão real do companheiro não é provada pelo
  gate; item-alterations `description/add` contam como lidas (M-3).

## Ficha e Plano

- **Exceções de elegibilidade (F7-04)**: P1 T1 sem card "Exceções de elegibilidade", sem motivo nem "Pedir liberação ao
  Mestre"; `system.access` do Noble Bloom curado à mão (`rule-fixes.mjs`/`prerequisiteFixes` não cobrem campo de
  `system`; travado por `curated-access-field.test.mjs`).
- **Carteira (F7-03)**: "Ajustar carteira" do Mestre sem campo "motivo" nem registro (quem, quando, motivo), como o
  protótipo T6.
- **Slot "skillFeat" cru (D4, onda 12)**: escolha sem item (artefato de fixture) aparece com o tipo cru; robustez
  opcional.
- **Herança Crisântemo sem documento (D5)**: nome pt-BR vem de `SUPPLEMENTAL_NAME_ENTRIES` (`planVM.ts`); sai se o pack
  ganhar o documento. O suplemento pertence ao `translate-packs` (M8, onda 12).
- **Botão dentro de botão no `PlanSlot` (M7, onda 12)**: selo "Liberar exceção" dentro de `button.plan-slot__body`; tirar
  o selo do botão-corpo.
- **Snapshot filtra PC por ownership**: PC com `default:0` aparece ao vivo e some ao recarregar (onda 13).
- **Plano do Bhrotto em inglês na visão do Mestre (D11, onda 11)**: `PlanColumn.loadContentTranslator` deixa o tradutor
  nulo se o socket não conectou; tentar de novo quando a conexão subir (hipótese não verificada ao vivo).

## Mestre, contatos e visibilidade

- **Chat não confere a posse do ator que fala**: `chat-handler.ts:508-513` aceita `speaker.actorId` sem checar OWNER e
  `sanitizeAbilityCard` (`:2237-2241`) só confere `casterActorId === speakerActorId`; dá para forjar card em nome de ator
  alheio. Gravidade média-baixa; tarefa própria da faixa A (I-8, onda 8). Fecha também o limite de tamanho da manobra
  sem orador (M-1, onda 10).
- **`token:preview` sem checar oculto**: `ephemeral-handlers.ts` reenvia o preview de arraste do Mestre a toda a sala;
  quem desenhar o fantasma expõe token oculto (onda 13).
- **Token "?" do Ogro depois de recarregar (O4, onda 13)**: mesma causa do D1; não verificado ao vivo.
- **Presença (D2, onda 13)**: roster `presence:online` ouvido desde `SocketManager.connect`; não verificado em
  navegador. Teste não prova que `disconnect` desliga nem que reconectar não duplica.
- **Dois `attachPresenceSync` na convergência**: se `build/app` (TableScreen, d295c6fe) e esta linha convergirem, ping e
  cursor em dobro e `stop` da poda compartilhado.
- **Redação (F5-05)**: `byActor[partnerActorId]` expõe actorId e contagem de um parceiro oculto
  (`redaction.ts:1009-1016`).
- **Chat privado ao jogador sem acesso**: chega vazio, mas revela que "algo foi dito" (mesma regra do resto do servidor).
- **`_id` duplicado no lote**: dois tokens do mesmo ator no mesmo apply geram o mesmo `_id` em `documents`; ruído.

## i18n pt-BR

- **Rótulos de condição**: `SCAFFOLDING_CONDITION_CATALOG` (`characterSheetVM.ts`) e `systems/sf2e/src/conditions.ts`
  ainda em inglês; os 41 rótulos pt-BR seguem o glossário, não o livro ("Sentenciado", "Esgotado", "Estupidificado").
- **Glossário de "Seek"**: a aba Ações mostra "Investigar"; alinhar `glossary.pt-BR.json` com o livro e o app (L3).
- **Fim de efeito em inglês no chat (N2)**: "Efeito Effect: Antelope Support terminou em Bhrotto."; usar o nome do
  snapshot `flags.fusion.i18n["pt-BR"]` (L3).
- **Iniciativa por perícia alternativa**: tradução do "(Perception)" cobre só Perception (onda 13).
- **"contundente" × "concussão"** entre editor de runas e aba Ações (D6, onda 12).

## Cosméticos

- Rastreador do Mestre sem nome nas linhas; marcador de turno fora do centro do token empilhado (D10, onda 11).
- "Chamar Companheiro" desabilitado com o motivo sobreposto ao título; placeholder da busca da aba Ações cortado (D10,
  D6).
- Botão "Ajustar carteira" nativo sem estilo; editor de Runas fica aberto depois de Aplicar sem sinal de gravado (D6,
  onda 12).

## Testes e dívida técnica

- **Sem DOM no satélite**: só há `svelte/server`; testes da aba Ações, Pets, `LevelCard` e `companionPrey.names-pt`
  leem o fonte (frágeis a refatoração) e o clique (`useExecutable`) não tem prova executável. Saída: extrair o despacho
  para função pura ou adotar `jsdom` (onda 8, M4 e M3 da onda 12, I4 da onda 13).
- **Testes de socket ausentes**: `mount:mount`/`mount:dismount` → `onMountChanged` (desmonte grava a cena por SQL e chama
  `republishScene` à mão); teste de integração de `apply-condition` via `chat:send` com `flags.parentMessageId` (M3,
  onda 12).
- **Gate BHR-F2-09**: API exportada de um `.test.ts` (M-5), `_env` sem uso em `whyDocInert` (M-6), `sluggify` local
  duplicando `sluggifyName` (M-7); mover para helper se o gate for reaproveitado.
- **Processo**: `doc-handlers.ts` foi tocado por duas lanes na mesma onda (merge limpo, onda 8).
