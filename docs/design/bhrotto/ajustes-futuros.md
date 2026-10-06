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
- **Apoio: "Comandado"**: resolvido na correção da revisão do L3 (abaixo): o servidor registra o Comandar no combate (`commandMark`).
- **Linha `support` da aba Ações**: continua no registro (depende de uma ação "support" que nenhum pack tem, nunca aparece); o gatilho real passou a ser o botão da ficha do companheiro. Pode ser removida numa limpeza.

## Registrados pela correção da revisão da onda 11 (gate BHR-F2-09)

O gate "nenhuma regra do Bhrotto inerte" passou a exigir também produtor para os termos de predicado (`action:*`, marcas) e consumidor para as roll options. Com isso a frase "nenhuma regra está inerte" deixou de valer sem ressalva: hoje há **duas** regras inertes conhecidas, listadas em `KNOWN_INERT` do `bhrotto-rules.test.ts` (o teste falha se a lista crescer ou se uma entrada deixar de ser inerte).

- **Buscar/Rastrear contra a presa (+2): LIGADO.** Faltava a rolagem. `seek` (Percepção) e `track` (Sobrevivência) viraram linhas rolaveis da aba Ações e a rolagem emite `action:seek` / `action:track`, levando o alvo mirado para o servidor resolver `target:mark:hunted-prey`. Sem alvo mirado a rolagem vale sem o bônus. Buscar tem o traço `secret`: a linha rola cega (resolvido na correção da revisão do L3, abaixo); Rastrear rola em público.
- **Ignorar a penalidade de alcance na presa (`ignore-range-penalty:2`): INERTE, fica como está.** O Fusion não aplica penalidade por incremento de distância em golpe à distância, então não há penalidade para ignorar. Ligar exige construir a penalidade (distância ao alvo por incremento), uma tarefa própria. É a única regra do Bhrotto com efeito de jogo que continua sem leitor.
- **Marcador `grants-hunt-prey` (classe Caçar Presa): INERTE, sem efeito de jogo.** Contador do vendor (quantas fontes concedem Caçar Presa); nenhuma regra do Bhrotto nem leitor do Fusion o cita, e a ação concedida não depende dele.

## Menores abertos (revisão da onda 11, gate BHR-F2-09)

- **Ramo morto `ANIMAL_COMPANION_GRANT_SOURCE_IDS` (M-2)**: Animal Companion (Ranger) tem 1 regra (alteração de descrição), então passa por `whyInert`, não por `whyDocInert`; o mecanismo real do companheiro (concessão por identidade) não é provado pelo gate.
- **Alteração de descrição conta como lida (M-3)**: as três item-alterations `description/add` (Outwit x2, Animal Companion) passam por constarem em `ITEM_ALTERATION_HANDLED_FORMS`; são texto de exibição por natureza. `item:tag:hunters-edge-sharing` (Outwit) não tem produtor, sem impacto.
- **API do gate exportada de um `.test.ts` (M-5)**, **`_env` sem uso em `whyDocInert` (M-6)** e **`sluggify` local duplicando o `sluggifyName` de produção (M-7)**: arrumar se o gate for reaproveitado em outra frente (o lugar certo é um helper).
- **Vermelho do gate era de compilação (M-8)**: a prova comportamental do "antes da frente" está nos negativos (handlers e forma desregistrados, marca sem produtor).

## Registrados pela correção da revisão do L3 (onda 11)

- **Vocabulário do tipo de dano**: o glossário compartilhado diz "corte" (`slashing`), o protótipo diz "cortante". O rótulo do Apoio usa o adjetivo do protótipo por um mapa local (`companionSupport.ts`: cortante, perfurante, contundente); o resto do app continua com o glossário. Unificar é decisão de vocabulário para o app todo.
- **Chat privado agora chega vazio ao jogador sem acesso**: o envelope mantém o seq contíguo (sem buraco, sem resync), mas revela que "algo foi dito"; o conteúdo não vaza. Mesma regra que o resto do servidor já seguia.
- **Comandar fora do turno do dono é recusado em combate** (`companion:command`, CONFLICT). Fora de combate, ou com o dono fora do encontro, vale o estado local da ficha como antes.
- **M3** (alvo com `actorId` nulo mas nome de token público vira "criatura desconhecida"), **M5** (sabor do dano de magia e `NpcSheet.svelte:303` ainda com o slug cru do tipo), **M7** (dois companheiros do mesmo tipo: o cliente não diz qual foi clicado) e **M8** (sem teste de componente do `damageRollFlavor` no `AbilityCard.svelte`): abertos, sem impacto hoje.
- **M2**: o botão Comandar/Apoio ainda não troca o texto para "Comandado (2 ações)" nem mostra o bloco "Apoio aplicado" do protótipo; é só UI, precisa de tela.
- **Sem teste de componente com DOM**: o satélite roda em ambiente `node` (sem jsdom). O fluxo do Apoio e do Comandar foi extraído para `companionSupportFlow.ts` e testado com socket falso e o `sendOp` real; o clique no botão em si segue coberto por SSR e por roteiro de tela.

## Registrado pela re-execução do L3 (onda 11)

- **Glossário pt-BR de "Seek"**: a aba Ações mostra a linha de Buscar como "Investigar" (busca por "Buscar" não acha). Conferir o glossário (`tools/translate-packs/glossary.pt-BR.json`) e alinhar com o termo usado pelo livro e pelo resto do app.
- **Fim de efeito em inglês no chat (N2)**: a mensagem do Sistema diz "Efeito Effect: Antelope Support terminou em Bhrotto."; deve usar o nome pt-BR do snapshot (`flags.fusion.i18n["pt-BR"]`), como a ficha já faz.
- **Chamar Companheiro montado sem resposta (N3)**: com o Bhrotto montado, a linha fica habilitada mas o clique não faz nada (sem card nem motivo); só troca depois de Desmontar. Ou a linha desabilita com o motivo, ou a recusa do servidor aparece na ficha.
- **+1d8 do Apoio do urso no card de dano**: não verificado ao vivo pelo roteiro do L3 (rolagem sem alvo; ogro fora do alcance do urso); coberto só por teste.

## Registrados pela correção do L4 (onda 12)

- **Ícone de Caído no token (D2)**: o mapa não tem mecanismo de ícone de condição em token (`TokenSprite` só desenha barras, nome e selos), então o Ogro com `condition:Prone` não mostra nada no mapa. Construir é feature nova (ícones de condição sobre o token, para todas as condições); fica como ajuste. O botão do card mostra "aplicado" (ver "Registrados pela revisão da onda 12", abaixo, para o limite do estado do jogador).
- **Slot "skillFeat" cru (D4)**: artefato da fixture, não rótulo faltando. O roteiro removeu o item Lutador de Titas direto do ator e deixou a escolha `skillFeat-2` em `system.build.choices` sem item; o slot aparece preenchido com o tipo cru. O rótulo "Talento de Perícia" existe (pt-BR e en). Pelo Plano, `removeChoice` apaga a escolha junto, então o caminho real não chega aí. Um slot com escolha sem item poderia aparecer vazio; fica como robustez opcional.
- **Herança Crisântemo sem documento (D5)**: o pack `heritages-core` tem as outras nove heranças Leshy e não tem a Leshy Crisântemo; o nome pt-BR vem de um suplemento fixo do tradutor (`SUPPLEMENTAL_NAME_ENTRIES`, `planVM.ts`). Se o pack ganhar o documento, o do pack vence e o suplemento sai.
- **Cosméticos do L4 (D6)**: botão "Ajustar carteira" nativo sem estilo; editor de Runas fica aberto depois de Aplicar sem sinal de gravado; "Chamar Companheiro" com o motivo sobreposto ao título na aba Ações; placeholder da busca da aba Ações cortado ("Buscar por nome (portug…"); "contundente" (editor de runas) x "concussão" (aba Ações).
- **Foto de alvo do card de manobra**: a recusa agora considera também a foto das rolagens aninhadas do mesmo falante (Derrubar/Empurrar/Agarrar). Outras fontes de card que nomeiem a mensagem do botão sem foto própria seguem o mesmo caminho; sem caso conhecido.

## Registrados pela revisão da onda 12

- **Estado "aplicado" depende do registro do servidor (I1)**: o servidor grava em `flags.fusion.appliedConditions` do card (por token, chave `modo:slug`) o que o botão aplicou, e propaga `doc:update`; jogador e Mestre leem isso, então o estado sobrevive ao recarregar e à re-execução. Limite: para um alvo fora do espelho do jogador, o botão só sabe o que o servidor registrou; se a condição sair depois (o Ogro se levanta), o jogador continua vendo "aplicado ✓" até o card ser reaberto por alguém que veja o ator. O Mestre vê o estado vivo e o botão reabilita. Condição aplicada por outro caminho (ficha do Mestre, sem o botão) não aparece no card do jogador. O token oculto some do registro para o jogador (mesma redação da foto de alvos).
- **Servidor não confere slug nem grau (M2)**: `computeApplyCondition` aplica qualquer `slug` em qualquer alvo da foto (ou da mira viva), sem olhar se o card ofereceu aquilo nem se o grau foi sucesso; "oferecido, não aplicado" segue garantia do cliente (D-G10). Lacuna antiga, junto da linha de "Aplicar condição usa o alvo da rolagem".
- **TDD do D3 (M4)**: o vermelho do `levelCard-gm-toggle` (satélite `ebc887c`) tinha uma regex cortada no `>` da arrow function e falhava com qualquer código; a versão que ficou verde nunca aparece vermelha no histórico. Histórico não se reescreve; fica o registro. O teste é por leitura de fonte: frágil a refatoração; um teste com `mount(LevelCard)` em jsdom exigiria `jsdom` como devDependency.
- **Botão dentro de botão no `PlanSlot` (M7)**: o selo "Liberar exceção" é um `<button>` renderizado dentro de `button.plan-slot__body` (que tem `aria-label`): HTML inválido, e o `aria-label` externo esconde o selo de leitor de tela. O `stopPropagation` do D3 resolve o clique, é um remendo. Anterior à onda 12; o certo é tirar o selo de dentro do botão-corpo.
- **Suplemento do tradutor em `planVM.ts` (M8)**: `SUPPLEMENTAL_NAME_ENTRIES` é dado de conteúdo fixo num VM de mais de 13 mil linhas, injetado em todo tradutor (feats, itens etc.). O lugar natural é o suplemento do `translate-packs`. Aceitável como está.
- **Teste do D1 com fixture sintética (M3)**: `apply-condition-handler.test.ts` cria card e rolagem aninhada com `store.create`, sem passar por `chat:send`/`sanitizeAbilityCard`. Um teste de integração via `chat:send` com `flags.parentMessageId` fecharia o formato real; hoje depende da re-execução do roteiro.
- **Recusa genérica por código (M5)**: o erro do botão agora é decidido pelo `code` do ack (FORBIDDEN, NOT_FOUND, NOT_SUPPORTED, TIMEOUT, resto genérico). FORBIDDEN junta "alvo fora da foto", "card de outro dono" e "fora da mira viva" numa frase só; separar pede um código novo no protocolo.
