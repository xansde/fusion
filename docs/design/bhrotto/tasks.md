# Bhrotto Raiz-funda — plano de tarefas consolidado (B-F0 a B-F7)

> Origem: decisões do Alexandre em `docs/design/bhrotto/decisoes.md` (D-B01..D-B23), levantamento empírico
> `.fusion-build/bhrotto/L-ficha.md` (achados B1–B14), dependências em `docs/design/bhrotto/dependencias-importadas.md`
> (N1–N8, lacunas G1–G10) e regras curadas em `docs/design/bhrotto/dados/*.md`. Conferido contra o código em 2026-10-05
> (core `alfa/app` 2cd67095 + satélite `v0.3.20` 72c022e4).
> Linha: **pessoal alfa**. Toda branch parte de `alfa/app` (core, `git fetch origin` antes) e de `main` (satélite), volta por
> PR de lote; tarefa de satélite fecha com PR no `xansde/fusion-systems-2e`, tag nova e bump de pin no core.
> Processo: TDD não circular, rolagem e permissão no servidor, redação só via `packages/server/src/net/redaction.ts` +
> `isRolePrivileged` (`documents/ownership.ts`), UI por `docs/design/PROCESSO-UI.md` com o protótipo
> `docs/design/bhrotto/prototipo-bhrotto-fiel.html` (telas T1–T6) como lente obrigatória, porta de teste via
> `packages/server/src/__tests__/helpers/ports.ts`. Entregas pequenas: cada faixa verde vira commit na hora (verificação viva
> não segura commit).

**O que esta frente é**: tornar o Bhrotto Raiz-funda (Patrulheiro 3 Leshy Raiz, Astúcia, Animal de Companhia +
Dedicação de Domador de Bestas, campanha A Queda, jogador Flávio) **100% jogável** — ficha com os números do livro,
dois companheiros derivados com ficha própria, montaria, Presa marcada no token, rolagens que sabem o alvo, runa na arma.
O levantamento mostrou que os números de defesa e ataque já batem; o buraco é **mecanismo**: nenhum companheiro é
criável (B1), a Presa é texto cru (B8), o Alcance Prênsil não altera a arma (B7), a runa não tem tela (B6), e três dados
de pack estão errados ou faltando (B3, B4, B5).

**A diferença desta frente para Guerreiro e Alquimista**: quase tudo o que o Bhrotto precisa de motor (alvo, grau, MAP,
expiração, ganchos de turno, rule elements, condição em alvo) **já foi desenhado** nos planos do Alquimista e do
Guerreiro — e uma parte já existe em `origin/feat/alquimista` (ondas 1–5), **fora** de `alfa/app` e 213 commits atrás
dela. Pela D-B08 essas peças entram **neste** plano, com os contratos que os planos de origem fixaram. O que não tem
plano em lugar nenhum (lacunas G1–G8: marca no token, `removeAfterRoll`, efeito em outro ator, limite de tamanho,
companheiro, montaria) nasce aqui.

**O que este plano NÃO decide sozinho**: como a base do Alquimista chega a `alfa/app` (§1.2, DC-01) e a ordem em relação
à frente do Guerreiro (DC-02). Ambas mudam o que a D-G16/D-G18 fixaram, então ficam como **proposta** até o Alexandre
responder; as fichas abaixo estão escritas para a opção recomendada e dizem o que muda se a outra for escolhida.

## 1. Decisões

### 1.0 Respostas do Alexandre às DC (2026-10-05)

| DC                                | Resposta                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DC-01                             | **(A) Antecipar o merge** da `feat/alquimista` (ondas 1–5) em `alfa/app`, como primeira tarefa (BHR-F0-02).                                                                     |
| DC-02..DC-07, DC-09, DC-11, DC-12 | **Como recomendado** na tabela abaixo.                                                                                                                                          |
| DC-08                             | **O companheiro ativo** herda Caçar Presa e Astúcia, venha de qual talento vier.                                                                                                |
| DC-10                             | **Diferente da recomendação:** o jogador continua podendo editar a própria carteira. Sem chave `walletGmOnly`; o Mestre só ganha o "Ajustar carteira" (BHR-F7-02/03 ajustadas). |

### 1.1 Decisões do Alexandre (vinculantes)

| ID    | Tema                                | Decidido (resumo; texto integral em `decisoes.md`)                                                                                                                          | Tarefas                                |
| ----- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| D-B01 | Números do companheiro              | Derivados por tipo + estágio + nível do dono; pack homebrew de tipos (urso, antílope, extensível).                                                                          | BHR-F1-04, BHR-F4-01, BHR-F4-02        |
| D-B02 | Recálculo                           | No servidor: mudou o dono, re-deriva os companheiros ligados (fecha Q-PET-02).                                                                                              | BHR-F4-03                              |
| D-B03 | Montaria                            | Combate Montado completo: estado montado, cavaleiro anda com a montaria, penalidades, ações da montaria, Apoio montado.                                                     | BHR-F5-01..06                          |
| D-B04 | Tela do companheiro                 | Ficha própria (cabeçalho "pertence a …"); a ficha do Bhrotto só tem os vínculos; sem aba Pets para ele.                                                                     | BHR-F4-06                              |
| D-B05 | Presa                               | Marca real no token; Astúcia e Caçador de Monstros só valem contra ela; alvo persistente e ficha que sabe o alvo da rolagem.                                                | BHR-F3-06..10                          |
| D-B06 | Runas                               | Editor de runas na arma (potência, ataque, propriedade), genérico para qualquer arma.                                                                                       | BHR-F7-01                              |
| D-B07 | Wildborne                           | Curado do Lost Omens World Guide (OGL 1.0a), sem texto nem arte da Paizo, conferido pelo Alexandre. **Desbloqueado**: achado e curado em `dados/wildborne.md` (DEC-BHR-22). | BHR-F1-07                              |
| D-B08 | Dependências                        | Trazer para este plano as peças do Guerreiro e do Alquimista, seguindo os contratos de lá.                                                                                  | BHR-F0-02, F2-\*, F3-01..05, F6-01..03 |
| D-B09 | Criação dos companheiros            | Pelo Plano: Animal de Companhia abre sub-slot "escolher companheiro"; a Dedicação abre um segundo; o jogador faz sozinho.                                                   | BHR-F4-04, BHR-F4-05, BHR-F4-10        |
| D-B10 | Comandar e Apoio                    | Automático: Comandar posta card; Apoio aplica no dono o efeito do tipo, que expira no início do próximo turno do dono.                                                      | BHR-F4-07, BHR-F4-09, BHR-F5-06        |
| D-B11 | Limite de tamanho                   | Agarrar, Empurrar, Derrubar checam o tamanho do alvo (até 1 acima; Lutador de Titãs, até 2).                                                                                | BHR-F6-04                              |
| D-B12 | Floração Nobre                      | Pode, como exceção do Mestre: o Plano marca o talento como liberado pelo Mestre.                                                                                            | BHR-F7-02, BHR-F7-04                   |
| D-B13 | Riqueza do nível 3                  | O Mestre ajusta a carteira; sem regra automática de riqueza por nível.                                                                                                      | BHR-F7-02, BHR-F7-03                   |
| D-B14 | Picker de tipo                      | Mostra o que o companheiro ganha ao virar Maduro (e avanços seguintes), mesmo sem requisito.                                                                                | BHR-F1-04, BHR-F4-05                   |
| D-B15 | Tipo repetido                       | O mesmo tipo pode ser escolhido mais de uma vez.                                                                                                                            | BHR-F4-05                              |
| D-B16 | Estado não cita arma                | Texto de estado nunca preso ao nome de arma antiga; se seguir a arma for complexo, efeito genérico ("reduz um passo o dado da arma").                                       | BHR-F2-04                              |
| D-B17 | Manobras de Atletismo               | Fora da tela de combate do protótipo (ficam na aba Ações); a checagem de tamanho continua valendo.                                                                          | BHR-F6-03, BHR-F6-04                   |
| D-B18 | "Contra a presa"                    | Generalizar: "Contra a presa", nunca o nome do alvo.                                                                                                                        | BHR-F3-10                              |
| D-B19 | Editor de runas (ajustes)           | Rótulo do campo diz o que se escolhe; nível da runa não fica só dentro do selecionável; "Golpeadora" rejeitado.                                                             | BHR-F7-01                              |
| D-B20 | Validação de runas                  | Sem aviso nem bloqueio: editor livre.                                                                                                                                       | BHR-F7-01                              |
| D-B21 | Tradução de _striking_              | "Runa de ataque" (maior/suprema); o campo mostra o efeito em dados de dano.                                                                                                 | BHR-F7-01, BHR-F1-06                   |
| D-B22 | Picker sem nível de classe          | O seletor mostra os benefícios "a partir de Maduro" **sem citar nível de classe** (Mature Animal Companion é talento opcional).                                             | BHR-F1-04, BHR-F4-05                   |
| D-B23 | Faixa "Estados de combate" compacta | Cada estado mostra só o nome; clicar no nome revela o texto do efeito. Padrão reutilizável para todos os estados de combate, não só os do Bhrotto.                          | BHR-F2-10                              |

### 1.2 Decisões a confirmar (propostas — não decididas)

Escolhas de desenho que o plano precisou fazer para fechar as fichas. **Nenhuma está decidida**: a coluna "Proposta" é a
recomendação, com a alternativa e o que muda no plano se ela for escolhida.

| ID    | Tema                                             | Proposta (recomendada)                                                                                                                                                                                                                                                                                                                          | Alternativas e efeito no plano                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tarefas                                                                  |
| ----- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| DC-01 | Como a base do Alquimista chega a alfa           | **(A) Antecipar o merge da D-G16, cortado na onda 5**: sincronizar `feat/alquimista` com `alfa/app` (merge de alfa na branch, core e satélite), rodar a suíte inteira e abrir **um** PR `feat/alquimista → alfa/app` com as ondas 1–5 integradas (`estado.json`: 33 tarefas `integrada`). O Bhrotto parte de alfa depois desse merge.           | **(B) Transplante por tarefa**: para cada uma das 15 tarefas FA da lista 2.1 de `dependencias-importadas.md`, recortar os arquivos da tarefa de `feat/alquimista` com os testes dela como oráculo, numa branch a partir de alfa. Custo: ~6 tarefas F0 a mais, e a `feat/alquimista` fica com código duplicado que vai conflitar no merge final dela. **(C) Reimplementar** a partir das fichas ALQ: rejeitada — refaz código já testado e cria duas verdades. Com (B), BHR-F0-02 vira BHR-F0-02a..f (motor de RE, TurnHooks, TargetSelection, materializador+expiração, mecânica de ator e condição, GrantItem dinâmico). | BHR-F0-02, BHR-F0-03                                                     |
| DC-02 | Ordem em relação ao Guerreiro                    | **O Bhrotto implementa primeiro as fichas GUE que importa** (F1-01..05, F2-01, recorte de F2-02, F3-01, F5-01, F5-03, F5-05) e fixa os contratos `AttackCheckContext`, `TargetGesture`, `MapCounter`, `SkillCheckContext`, `PositionQuery`; o plano do Guerreiro, quando rodar, só confere o que existe (princípio da D-G18).                   | Esperar o Guerreiro (que pela D-G18 roda depois do Animista) bloquearia toda a B-F3/B-F6 por tempo indeterminado. Alternativa: o Bhrotto entrega só o recorte mínimo e o Guerreiro completa depois — é o que a proposta já faz para F2-02, F3-01, F5-01 e F5-03.                                                                                                                                                                                                                                                                                                                                                          | BHR-F3-01..05, BHR-F6-01..03, BHR-F5-01, BHR-F2-01, BHR-F2-02, BHR-F2-08 |
| DC-03 | Presa × mira (lacuna G2)                         | A mira continua **efêmera** (REQ-CBT-055: limpa no fim do turno do dono); a Presa é um **estado separado e persistente** (`TokenMark`), gravado no ator que caçou.                                                                                                                                                                              | Emendar a REQ-CBT-055 para mira persistente: mexe num comportamento testado e mistura "em quem estou mirando agora" com "quem é minha presa".                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | BHR-F3-06                                                                |
| DC-04 | Fim da Presa e frequência do Caçador de Monstros | Presa sai por **nova Caçar Presa** (substitui), por **remoção** (dono ou Mestre) ou quando o token alvo sai da cena/morre (Mestre remove). Sem `daily-prep` automático enquanto a preparação diária (ALQ-F3-05) não existir (D-05: sem relógio de mundo). O "1×/dia por criatura" do Caçador de Monstros fica **exibido, não imposto**.         | Importar ALQ-F3-02/F3-05 (ActorResource + DailyPrep) só para isso: arrasta a F3 inteira do Alquimista.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | BHR-F3-06, BHR-F3-09                                                     |
| DC-05 | `removeAfterRoll` (lacuna G3)                    | Estender `FusionExpiry.on` com **`"after-roll"`** + `rollPredicate` opcional; consumido por um ouvinte de `onRollResolved` que apaga o efeito embutido. Emenda da spec 17 (dona do `FusionExpiry` desde a ALQ-F2-01).                                                                                                                           | Campo à parte `system.fusion.consumeOnRoll`: segundo resolvedor de expiração, contra a DF-08 ("um só resolvedor").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | BHR-F2-06                                                                |
| DC-06 | Permissão de efeito em outro ator (G4)           | Op nova `effect:apply`: jogador aplica efeito **do próprio ator** em (a) si, (b) ator ligado por vínculo de companheiro (dono↔companheiro, nos dois sentidos) e (c) alvos da foto da mensagem, só com efeito marcado `allowOnTarget`. Mestre aplica em qualquer ator.                                                                           | Reusar `actor:applyCondition` (ALQ-F1-09): só serve para condição, não para EffectItem com regras (o Apoio do urso é dano extra, não condição).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | BHR-F4-08                                                                |
| DC-07 | Segundo companheiro e "ativo"                    | Emendar a REQ-PET-093: o limite por grupo `animalCompanion` passa a ser o **número de concessões** (Animal de Companhia = 1, Dedicação de Domador de Bestas = +1). Um só **ativo** (`system.companion.active`); o inativo continua ator, sem token em cena, com a ficha legível. Chamar Companheiro troca o ativo (sem cronômetro: exploração). | Contar o limite de 4 do Domador já agora: só faz sentido com os talentos de Domador de nível 4+ (fora do escopo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | BHR-F4-04, BHR-F4-10                                                     |
| DC-08 | Quem herda a Presa                               | O companheiro **ativo** herda Caçar Presa e Astúcia do dono, venha de qual talento vier.                                                                                                                                                                                                                                                        | RAW estrito (`dados/talentos.md`: "NÃO CONFIRMADO"): só o companheiro do talento Animal de Companhia; exige gravar no ator a concessão de origem e checar no predicado.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | BHR-F4-11                                                                |
| DC-09 | Patrulheiro sem Natureza (B4)                    | Corrigir pela causa: o espelho do Plano avalia o predicate `not feature:vindicator` da regra da classe (o livro treina Natureza e Sobrevivência). Personagens Patrulheiro existentes ganham **uma escolha livre aberta** na próxima abertura do Plano (mesmo mecanismo da colisão da regra 2 da casa).                                          | Manter o pack como o vendor e o Flávio gastar uma livre com Natureza: a conta de perícias do PDF não fecha (7 de 8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | BHR-F1-02                                                                |
| DC-10 | Carteira só do Mestre (D-B13)                    | Servidor recusa escrita de `system.currency` por jogador **em todo ator de jogador** (o Mestre ajusta; a carteira vira só-leitura na ficha do jogador). **Hoje o jogador edita a própria carteira** (`characterSheetVM.ts:1294-1296`, `setWalletAmountOp`). Chave por mundo `walletGmOnly`, padrão ligado.                                      | Só a UI de ajuste do Mestre, mantendo o jogador editando: a D-B13 fica cumprida na letra, mas nada impede o jogador de se creditar a riqueza de nível.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | BHR-F7-02, BHR-F7-03                                                     |
| DC-11 | Nomes pt-BR das runas                            | "Runa de potência +1/+2/+3"; "Runa de ataque", "Runa de ataque maior", "Runa de ataque suprema" (D-B21); campos "Potência (bônus de ataque)", "Runa de ataque (dados de dano)", "Runas de propriedade (N vagas)".                                                                                                                               | Outra família de nomes para potência; não muda tarefa, só i18n.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | BHR-F7-01, BHR-F1-06                                                     |
| DC-12 | Wildborne (B2, D-B07)                            | **Desbloqueada**: Wildborne curado do Lost Omens World Guide (OGL), ver `dados/wildborne.md` e DEC-BHR-22. Entra num pack próprio do mundo, com a origem declarada.                                                                                                                                                                             | Se for nome errado de um antecedente oficial, a tarefa vira só tradução/curadoria do pack existente.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | BHR-F1-07                                                                |

### 1.2.1 Questões abertas do Alexandre

- **Q-BHR-01 (fechada, 2026-10-05)**: "Reflexos −2" e "Montado" ficam **só** na faixa compacta da ficha (D-B23), sem selo no token — DEC-TOK-19 mantida (decisão do Alexandre: "pode manter como está").

### 1.3 Decisões herdadas (valem aqui, não se rediscutem)

| ID                           | Origem     | Decisão                                                                                                                       | Onde pesa no Bhrotto                                                          |
| ---------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| D-02 / DEC-CBT-10            | Alquimista | Foto dos alvos na mensagem (`flags.fusion.targetSnapshot`); o jogador aplica em todos os alvos da ação                        | golpe, Caçar Presa e manobras gravam o alvo na mensagem                       |
| DF-03                        | Alquimista | Montante e alvos vêm da mensagem gravada, nunca do cliente; valor manual só do Mestre                                         | anti-cheat do golpe e do Apoio                                                |
| D-05                         | Alquimista | Sem relógio de mundo: fora de combate nada expira sozinho                                                                     | Presa e Apoio fora de combate (DC-04)                                         |
| DF-06 / DF-07 / DF-08        | Alquimista | Efeito é cópia embutida com origem e início; duração conta pelo turno do ator de origem; um só resolvedor                     | Apoio usa `ownerActorId` = dono (BHR-F0-03); `after-roll` no mesmo resolvedor |
| D-10 / DF-15 (15/09)         | Alquimista | Scanners migram para o `RuleElementRegistry`; handler novo registra em **kebab-case** e passa no teste de escopo da ALQ-F4-03 | `item-alteration`, `fusion-skill-substitution`, `fusion-maneuver-size-limit`  |
| D-11                         | Alquimista | Toggle de roll option ligado pelo dono, sem aprovação                                                                         | Alcance Prênsil                                                               |
| D-13 / DF-04 / DEC-SYS-11/12 | Alquimista | Hooks de turno para PC e NPC, em série, depois de persistir e antes do broadcast, com id e prioridade                         | expiração do Apoio; reset do MAP compartilhado                                |
| D-15                         | Alquimista | Contador de ações do turno fora de escopo                                                                                     | Comandar, Apoio e ações da montaria não dependem de orçamento                 |
| D-16 / D-18                  | Alquimista | Estado temporizado vira anotação no canto; oferta sem cronômetro                                                              | Apoio ativo e Presa aparecem no canto do dono e do Mestre                     |
| DF-16 / DF-17                | Alquimista | Contexto de rolagem vai no op; notas, grau e ajustes resolvidos no servidor                                                   | predicado `target:mark:*` avaliado no servidor                                |
| D-G01 / DEC-CBA-05           | Guerreiro  | Botão direito alterna a mira, `Esc` limpa; mirar é gesto de canvas                                                            | BHR-F3-01                                                                     |
| D-G02                        | Guerreiro  | Com alvo, o servidor decide o grau e o card mostra um botão de dano coerente                                                  | BHR-F3-03                                                                     |
| D-G03                        | Guerreiro  | MAP contado pelo servidor; botão único com o MAP corrente; "forçar MAP" recolhido                                             | BHR-F3-04, BHR-F3-05, BHR-F5-05                                               |
| D-G08 / D-G10                | Guerreiro  | Aba Ações executora só para o que tem regra; condição em outro ator é oferecida, não aplicada                                 | Caçar Presa, Comandar, manobras                                               |
| REQ-ACH-070/071              | spec 38    | CA/CD/alvo lidos do banco, nunca do payload; sem alvo resolvível, sem grau                                                    | todo `checkContext` deste plano                                               |

### 1.4 Numeração de specs

| Spec                                        | Prefixo    | Dono      | Estado |
| ------------------------------------------- | ---------- | --------- | ------ |
| 52 — `52-cacador-companheiro-e-montaria.md` | `REQ-BHR-` | BHR-F0-01 | nova   |

`BHR` conferido livre: zero ocorrências de `REQ-BHR`/`DEC-BHR` em `specs/` de `alfa/app` e em todos os branches
`origin/docs/*` e `origin/feat/*`. A 52 é o primeiro número realmente livre: 33 e 46 estão reservadas no `specs/README.md`;
47/48/49 (Alquimista), 50 (Animista, `50-animista-e-conjuracao-dupla.md`) e 51 (Guerreiro, `51-combate-marcial.md`) estão
reservadas **só nos tasks.md daqueles planos** — nenhum branch cita 52–59. A `BHR-F0-01` acrescenta 47–52 à seção de números
reservados do `specs/README.md`, como a `GUE-F0-01` previa fazer.

O companheiro não ganha prefixo próprio: o dono do assunto é a **spec 29** (`REQ-PET-`, hoje até `REQ-PET-097`), e as
REQ-PET-005/040/053/090 (hoje `[V2]`) viram `[MVP]` por emenda. A 52 fica com o que não é pet: marca no token, efeito em
outro ator, `after-roll`, leitor de ItemAlteration, limite de tamanho, editor de runas, campos só do Mestre.

Reserva de ids, **acima** do que Alquimista (`REQ-PF2-235`, `REQ-SYS-152`, `REQ-CBT-060`, `REQ-CHT-053`, `REQ-CNV-096`),
Animista (`REQ-PF2-236..244`, `REQ-SYS-153..158`, `REQ-CNV-097..099`, `REQ-CBT-061..062`) e Guerreiro (`REQ-PF2-245..278`,
`REQ-CBT-063..067`, `REQ-CNV-100..104`, `REQ-CHT-054..060`, `REQ-SYS-159..160`, `REQ-ACH-093..096`) reservaram:

| Faixa                                  | Tarefa dona                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `REQ-BHR-001..250`, `DEC-BHR-01..24`   | BHR-F0-01 (blocos por fase: F0 001–010, F1 011–040, F2 041–080, F3 081–120, F5 171–200, F6 201–220, F7 221–250)             |
| `REQ-PET-098..125`                     | BHR-F0-01 (emendas da 29: derivação, recálculo, criação, 2º companheiro, montaria) — bloco F4 da 52 fica vazio de propósito |
| `REQ-PF2-279..298`                     | BHR-F0-01 (emendas da 17: `after-roll`, ancestryhp de herança, substituição de perícia, runas)                              |
| `REQ-CBT-068..071`                     | BHR-F0-01 (emendas da 10: MAP compartilhado, expiração ancorada no dono)                                                    |
| `REQ-CNV-105..108`, `REQ-TOK-115..119` | BHR-F0-01 (emendas da 06/41: marca no token, token montado)                                                                 |
| `REQ-CHT-061..064`                     | BHR-F0-01 (emendas da 09: card de Caçar Presa, Comandar, Apoio)                                                             |
| `REQ-SYS-161..165`                     | BHR-F0-01 (emendas da 15: `effect:apply`, `after-roll`, handlers novos)                                                     |

**Nenhuma dessas faixas anteriores está escrita nas specs reais** (só a `ALQ-F1-01` integrou, até `REQ-PF2-216`, e só em
`feat/alquimista`). Se o merge da DC-01 trouxer faixas que colidam, a `BHR-F0-01` rebaseia antes de escrever: o `spec-lint`
não enxerga reserva de branch não mergeada.

## 2. Contratos canônicos

Um shape por contrato. A tarefa dona fixa em spec e tipa; quem consome segue o nome e a forma daqui. Os contratos
**importados** valem como estão nos planos de origem (`docs/guerreiro-tasks` §2, `docs/alquimista-tasks` §2) — repetidos
aqui só no que o Bhrotto acrescenta.

| Contrato                                   | Dono                          | Consumidores                                                     |
| ------------------------------------------ | ----------------------------- | ---------------------------------------------------------------- |
| `AttackCheckContext` (GUE §2.1)            | BHR-F3-03 (importa GUE-F1-03) | BHR-F3-05, BHR-F3-10, BHR-F4-06, BHR-F4-09                       |
| `TargetGesture` (GUE §2.2)                 | BHR-F3-01 (importa GUE-F1-01) | BHR-F3-02, BHR-F3-08, BHR-F6-03                                  |
| `MapCounter` (GUE §2.3) + `mapGroupOf`     | BHR-F3-04 / BHR-F5-05         | BHR-F3-05, BHR-F4-06                                             |
| `SkillCheckContext` (GUE §2.6)             | BHR-F6-01 (importa GUE-F5-05) | BHR-F6-03, BHR-F3-09                                             |
| `PositionQuery` (GUE §2.8, recorte)        | BHR-F5-01                     | BHR-F4-09, BHR-F5-02, BHR-F5-06, BHR-F6-04                       |
| `RollNotes` / `onRollResolved` (ALQ-F4-09) | BHR-F2-05                     | BHR-F2-06, BHR-F3-09, BHR-F3-10                                  |
| `CombatStatesStrip` (D-B23)                | BHR-F2-10                     | BHR-F4-06, BHR-F5-04                                             |
| `ExecutableActionRow`                      | BHR-F2-08 (recorte GUE-F5-01) | BHR-F1-08, BHR-F3-08, BHR-F4-07, BHR-F4-10, BHR-F5-02, BHR-F6-03 |
| `TokenMark`                                | BHR-F3-06                     | BHR-F2-02, BHR-F3-07..10, BHR-F4-11                              |
| `FusionExpiry` + `"after-roll"`            | BHR-F2-06                     | BHR-F3-09                                                        |
| `EffectApply`                              | BHR-F4-08                     | BHR-F4-09, BHR-F5-06                                             |
| `CompanionType` / `deriveAnimalCompanion`  | BHR-F1-04 / BHR-F4-01         | BHR-F4-02, BHR-F4-05, BHR-F4-06                                  |
| `CompanionLink`                            | BHR-F4-04                     | BHR-F4-03, BHR-F4-05, BHR-F4-10, BHR-F4-11, BHR-F5-02            |
| `MountState`                               | BHR-F5-02                     | BHR-F5-03..06                                                    |
| `ManeuverSizeLimit`                        | BHR-F6-04                     | —                                                                |
| `WeaponRunes` (editor)                     | BHR-F7-01                     | —                                                                |
| `GmOnlyActorFields`                        | BHR-F7-02                     | BHR-F7-03, BHR-F7-04                                             |

### 2.1 `TokenMark` — a Presa no token (BHR-F3-06)

Persistido no **ator que marcou** (sobrevive a troca de cena e à mira efêmera, DC-03), não no `targeting-store`
(`packages/server/src/combat/targeting-store.ts`, que limpa no `turnEnd`).

```ts
// packages/shared/src/combat/token-mark.ts
interface TokenMark {
  slug: "hunted-prey" | "monster-hunter" | (string & {}); // vocabulário do predicado target:mark:<slug>
  targetTokenId: string;
  targetActorId: string; // para sobreviver à troca do token
  sceneId: string;
  createdAt: number;
  exclusive: boolean; // hunted-prey: uma por ator (nova Caçar Presa substitui)
}
// Actor.flags.fusion.tokenMarks: TokenMark[]
// ops: "mark:set" { sourceActorId, mark } · "mark:clear" { sourceActorId, slug, targetTokenId? }
// permissão: GM em qualquer ator; jogador só no ator que possui (OWNER) e só em token que está
// na própria TargetSelection (ALQ-F1-05) no momento do set.
// redação: marca sobre token oculto é removida do payload de não privilegiados (net/redaction.ts).
```

Predicados que o servidor injeta nas opções da rolagem (consumidos via `GUE-F2-02` recortado, BHR-F2-02):
`target:mark:<slug>` quando o alvo do `checkContext` tem marca do ator que rola **ou do dono, se quem rola é o companheiro
ativo** (DC-08); `origin:mark:<slug>` quando quem ataca o ator está marcado por ele (Astúcia +1 CA contra a presa).

### 2.2 `FusionExpiry` com `"after-roll"` (BHR-F2-06)

```ts
// systems/pf2e/src/schemas/item-effect.ts (dono do FusionExpiry desde a ALQ-F2-01)
type FusionExpiryOn =
  | "turn-start"
  | "turn-end"
  | "round-end"
  | "combat-end"
  | "daily-prep"
  | "never"
  | "after-roll";
interface FusionExpiry {
  on: FusionExpiryOn;
  ownerActorId: string;
  remainingRounds?: number;
  rollPredicate?: string[]; // after-roll: só a rolagem que casa (ex.: ["attack-roll", "target:mark:monster-hunter"])
}
// resolvido pelo MESMO resolveExpirations (DF-08), chamado também por um ouvinte de onRollResolved.
```

### 2.3 `EffectApply` — efeito em outro ator (BHR-F4-08)

```ts
// packages/shared/src/protocol.ts
"effect:apply": {
  sourceActorId: string;
  targetActorIds: string[];
  effect: { packId: string; docId: string }; // cópia embutida com origem e início (DF-06)
  expiry?: FusionExpiry;                       // ex.: Apoio → { on: "turn-start", ownerActorId: dono }
  messageId?: string;                          // quando o alvo vem da foto da mensagem (DF-03)
}
// permissão (DC-06): GM sempre; jogador se possui sourceActorId E cada alvo é (a) ele mesmo,
// (b) ligado por CompanionLink a ele, ou (c) está na targetSnapshot de messageId e o efeito
// tem system.fusion.allowOnTarget = true.
```

### 2.4 `CompanionType`, `deriveAnimalCompanion` e `CompanionLink` (BHR-F1-04, BHR-F4-01, BHR-F4-04)

```ts
// systems/engine-2e/src/companions/types.ts
type CompanionStage = "young" | "mature" | "nimble" | "savage" | "specialized";
interface CompanionType {
  slug: string; // "bear", "antelope"
  sizes: Size[]; // antílope: ["med", "lg"]
  attributes: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>;
  ancestryHp: number;
  skill: SkillSlug;
  senses: string[];
  speeds: Record<string, number>;
  strikes: { slug: string; die: DieFace; damageType: string; traits: string[] }[];
  support: { effectRef: { packId: string; docId: string }; requiresMounted?: boolean };
  advancedManeuver: { slug: string; summary: string };
  special: ("mount")[];
  stagePreview: Record<Exclude<CompanionStage, "young">, string[]>; // D-B14/D-B22: o que ganha em cada estágio, sem nível de classe
}
deriveAnimalCompanion(input: { type: CompanionType; stage: CompanionStage; masterLevel: number; size?: Size }):
  { level; hp; ac; saves; perception; skills; strikes; size; speeds; breakdown: Record<string, string> };

// Ator familiar (schemas/actor-familiar.ts) — CompanionLink
// system.companionKind = "animalCompanion"; system.masterActorId; system.companion = {
//   typeSlug, stage, grantSlotId /* slot do Plano que o criou */, active: boolean, size }
```

> **Emenda (revisão da onda 2, I-5/I-4/I-6).**
>
> - **Estágio e trilha.** `specialized` vem **depois** de `nimble` ou `savage` e inclui as vantagens da trilha de onde veio. O estágio continua um valor único; quem indexa por estágio (multiplicador de dados do Apoio, `deriveAnimalCompanion`) DEVE ler por `companionStageIncludes` / `stageDiceMultiplier` (`systems/pf2e/src/schemas/companion-type.ts`), nunca pelo nome cru do estágio. O `stageDiceMultiplier` do efeito traz também `specialized`.
> - **Alcance e montaria do Apoio.** Não existem predicados `target:within-companion-reach` nem `self:mounted`. O alcance do companheiro é o campo `system.fusion.gate = { withinReachOf: "companion" }` do efeito, avaliado no servidor por `PositionQuery.distanceBetween`; "só montado" é `support.requiresMounted` do tipo.
> - **Crítico.** O dano extra do Apoio do urso é dano do urso: a regra do efeito carrega `doubleOnCrit: false`. O motor de dano ainda não consome `damage-dice`; a BHR-F4-09 DEVE honrar o campo e cobrir o crítico no teste.

### 2.5 `MountState` (BHR-F5-02)

```ts
// Scene.tokens[].flags.fusion.mount = { riderTokenId?: string; mountTokenId?: string }
// ops: "mount:mount" { riderTokenId, mountTokenId } · "mount:dismount" { riderTokenId, to: {x,y} }
// requisitos no servidor (PositionQuery): adjacentes; montaria >= 1 tamanho acima; montaria é
// companheiro ligado ao cavaleiro ou o Mestre faz. Mover a montaria move o cavaleiro no mesmo
// write; mover o cavaleiro montado (não privilegiado) é recusado (só Montar desmonta).
// mapGroupOf(combatantId): cavaleiro e montaria compartilham o MapCounter enquanto montados.
```

### 2.6 `ExecutableActionRow` (BHR-F2-08, recorte da GUE-F5-01)

```ts
// sheets/pf2e/src/lib/sheets/pf2e/actions/executableRows.ts
interface ExecutableActionRow {
  slug: string; // "hunt-prey", "command-an-animal", "support", "mount", "trip", ...
  requires?: ("target" | "mounted" | "not-mounted" | "companion")[];
  roll?: {
    kind: "skill" | "attack";
    skill?: SkillSlug;
    against?: "fortitude" | "reflex" | "will" | "ac" | "perception";
  };
  onUse: { selfEffect?: EffectRef; mark?: TokenMark["slug"]; card: string; op?: string };
}
// registro dirigido por slug; a linha sem registro continua navegável (D-G08).
```

### 2.7 `ManeuverSizeLimit`, `WeaponRunes`, `GmOnlyActorFields`

```ts
// engine-2e/src/maneuvers.ts — limite padrão +1 tamanho; handler kebab-case
// "fusion-maneuver-size-limit" { maneuvers: [...], maxSizeDelta: 2 } (Lutador de Titãs; 3 se lendário)
// item-weapon.ts:91 (existe) — system.runes = { potency: 0..3, striking: 0..3, property: string[] }; o editor só escreve
// GmOnlyActorFields (doc-handlers.ts, rejectUnwritableField :372): "system.build.gmExceptions" (string[] de ids de talento liberados pelo Mestre, D-B12);
// a carteira segue editável pelo jogador (DC-10)
```

## 3. Regras de colisão

- Tarefas na mesma onda têm **arquivos disjuntos** (campo Onde) ou vão para a **mesma faixa** e rodam em série nela.
- Faixas: **A** server/combat+chat (`chat-handler.ts`, `combat/*`, `protocol.ts`) · **B** server/docs (`doc-handlers.ts`,
  `ownership.ts`, `redaction.ts`) · **C** client/canvas (`TokenInteractionManager.ts`, `lib/canvas/**`) · **D** satélite
  motor (`engine-2e/**`, `systems/pf2e/src/derivations/**`) · **E** satélite fichas (`characterSheetVM.ts`,
  `CharacterSheet.svelte`, `ActionsTab.svelte`, `planVM.ts`, `PlanColumn.svelte`, `npcSheetVM.ts`) · **F** satélite
  packs/importer (`packs/**`, `tools/importer-pf2e/**`, `i18n.pt-BR.json`).
- Arquivos-gargalo deste plano: `chat-handler.ts` (BHR-F2-05, F3-03, F6-01), `doc-handlers.ts` (BHR-F4-03, F4-04,
  F5-03, F7-02), `characterSheetVM.ts`/`CharacterSheet.svelte` (BHR-F2-07, F3-05, F3-10, F7-01, F7-03), `ActionsTab.svelte`
  (BHR-F2-08, F1-08, F3-08, F4-07, F6-03), `familiar.ts` (BHR-F4-02, F4-11), `TokenInteractionManager.ts` (BHR-F3-01, F5-03).
  Duas delas na mesma onda = mesma faixa, em série, cada uma com commit próprio.
- `transform.mjs` e `build-mvp-subset.mjs` são faixa do importer: **uma tarefa por onda** (regra herdada do Alquimista).
- Toda tarefa de satélite fecha com tag nova e bump de pin no core **na própria tarefa** (o bump é commit separado no core,
  `chore: pin fusion-systems-2e vX.Y.Z`); duas tarefas de satélite na mesma onda fazem um bump só, no fim da onda.
- Cada ficha cita arquivo e linha do estado de **2026-10-05** (alfa 2cd67095 / satélite v0.3.20). Depois da DC-01 os
  números de linha mudam: a primeira coisa que cada tarefa faz é conferir se o trecho ainda está lá; a linha é evidência
  datada, não contrato.
- Teto de 6 tarefas por onda; roteiros de print rodam em faixa só-leitura depois que o lote fecha.

## 4. Tarefas

### B-F0 — Fundação e base importada

### BHR-F0-01 — Spec 52 (`REQ-BHR`) + emendas 29/17/10/06/41/09/15

- **Repo**: core
- **Onde**: nova `specs/52-cacador-companheiro-e-montaria.md`; `specs/README.md` (bloco `prefixos` e números reservados 47–52); emendas em `specs/29-pets-companions-familiars.md` (REQ-PET-005/040/053/090 `[V2]→[MVP]`, REQ-PET-093, fecha Q-PET-02 em `:472`), `specs/17-sistema-pf2e.md`, `specs/10-combate-e-iniciativa.md`, `specs/06-canvas-e-renderizacao.md`, `specs/41-token.md`, `specs/09-chat-e-mensagens.md`, `specs/15-api-de-sistemas.md`; `specs/RASTREABILIDADE.md` via `pnpm spec:report`
- **Entrega**: Spec de área no padrão de `specs/CONVENCOES.md`: `DEC-BHR-01..24` (D-B01..D-B23 e as DC respondidas) e `REQ-BHR-` com `[MVP]`. Fixa os contratos da §2 (`TokenMark`, `after-roll`, `EffectApply`, `CompanionType`, `CompanionLink`, `MountState`, `ExecutableActionRow`, `ManeuverSizeLimit`, `GmOnlyActorFields`). Cita por id os contratos importados (GUE §2.1/2.2/2.3/2.6/2.8, ALQ §2.4/2.5) sem reescrevê-los, e incorpora o **recorte da ALQ-F4-01** de que o Bhrotto depende (fases do motor e `onRollResolved`). Acrescenta 47–52 aos números reservados. Escrita **depois** da resposta às DC-01..DC-12: o que ficar sem resposta entra como `DEC` em aberto.
- **Depende de**: —
- **Paralelo com**: BHR-F0-02, BHR-F1-01, BHR-F1-02
- **Modelo / esforço**: opus / high — amarra o resto e as emendas da 29 mudam o que é MVP.
- **Teste (TDD)**: `spec-lint` verde (prefixo com dono, id único, citação resolvível, req com tag, decisão canônica) + `pnpm spec:report` regenerado.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-BHR-001..250`, `DEC-BHR-01..24`, `REQ-PET-098..125`, `REQ-PF2-279..298`, `REQ-CBT-068..071`, `REQ-CNV-105..108`, `REQ-TOK-115..119`, `REQ-CHT-061..064`, `REQ-SYS-161..165`
- **Tamanho**: G
- **Onda**: 1 · **Lote**: L1

### BHR-F0-02 — Base do Alquimista (ondas 1–5) em `alfa/app` (DC-01)

- **Repo**: core + satélite
- **Onde**: branch `chore/alquimista-sync-alfa` a partir de `origin/feat/alquimista` (738398e0) com merge de `origin/alfa/app`; satélite: a branch do Alquimista no `fusion-systems-2e` com merge de `main` (v0.3.20); arquivos disputados conhecidos: `packages/server/src/chat/chat-handler.ts`, `packages/client/src/lib/canvas/tokens/TokenInteractionManager.ts`, `sheets/pf2e/.../CharacterSheet.svelte`, `characterSheetVM.ts`, `derive-runner.ts`, `systems/pf2e/src/index.ts`
- **Entrega**: Opção (A) da DC-01. Traz para `alfa/app` as 33 tarefas `integrada` das ondas 1–5 do Alquimista: `RuleElementRegistry` (ALQ-F4-02/03/19), GrantItem dinâmico (ALQ-F0-02/07), TurnHooks (ALQ-F1-02/04), TargetSelection + `targetSnapshot` (ALQ-F1-05), mecânica/dano/condição (ALQ-F1-06..09), materializador e expiração (ALQ-F2-01/02/08/09), `item:consume` (ALQ-F2-11). Resolve os conflitos a favor do comportamento de alfa onde o Alquimista não tinha intenção (ex.: regras da casa do PR #312), roda a suíte inteira dos dois repos, e entrega **um PR** `feat/alquimista → alfa/app` para o Alexandre mergear (merge é ato humano). O `estado.json` do Alquimista ganha nota de que as ondas 1–5 estão em alfa. Com a opção (B), esta ficha se divide em seis transplantes por tarefa (ver DC-01).
- **Depende de**: — (bloqueada pela resposta à DC-01)
- **Paralelo com**: BHR-F0-01, BHR-F1-01, BHR-F1-02
- **Modelo / esforço**: opus / high — merge de 213 commits com pin de satélite divergente; exige julgamento em cada conflito.
- **Teste (TDD)**: não é TDD (é integração): gate = suíte completa core + satélite verde, typecheck, lint, `format:check`, `spec-lint`; mais os testes-oráculo das tarefas ALQ trazidas (`turn-hook-runner.test.ts`, `rule-elements-regression.test.ts`, testes de `target-selection`, `applyCondition`, `effect-expiry`) rodando verdes em cima de alfa. Smoke do executável em mundo existente (cópia de `a_queda` no scratchpad) sem regressão nas regras da casa.
- **Prova visual (print)**: ficha do Bhrotto (replay do L-ficha) antes × depois do merge com os mesmos números (CA 19, Fort +9, ataque +9) — prova de não-regressão.
- **Spec/REQ**: `REQ-BHR-001..004` (referencia `REQ-PF2-206..235`, `REQ-CBT-056..060`, `REQ-SYS-138..152`)
- **Tamanho**: G
- **Onda**: 1 · **Lote**: L1

### BHR-F0-03 — Conferência dos contratos herdados e expiração ancorada no dono

- **Repo**: core + satélite
- **Onde**: `systems/engine-2e/src/expiry.ts`, `systems/pf2e/src/hooks/effect-expiry.ts` (satélite, vindos da ALQ-F2-09); `packages/server/src/combat/turn-hook-runner.ts` (core, ALQ-F1-04); `docs/design/bhrotto/tasks.md` (correção das fichas que citam o que o merge mudou)
- **Entrega**: Duas coisas, nesta ordem. (1) **Conferência**: lê o que a DC-01 entregou de verdade — assinatura de `TurnHookContext`, `getMyTargets/setMyTargets`, `actor:applyCondition`, `resolveExpirations`, `RuleElementHandler` — e corrige as fichas deste plano onde o código diverge do que os planos ALQ descreviam (dependencias-importadas §5.3: "o código final deve ser relido antes de depender dele"). (2) **O caso que nenhum plano testou**: efeito aplicado pelo ator X no ator Y com `FusionExpiry.ownerActorId = Y` (o Apoio do companheiro, aplicado pelo urso, expira no início do turno do **dono**). Garante que `resolveExpirations` olha `ownerActorId`, não o ator de origem do item, e que o efeito sai de todos os atores.
- **Conferido na onda 2 (o que o código entrega de verdade)**: `resolveExpirations(actor, event)` já decidia por `expiry.ownerActorId` (engine-2e, sem estado; lê `system.duration` e `system.fusion.startedAt{combatId,round}`; `remainingRounds` é só informativo). A lacuna era no hook: `pf2e.effectExpiry` só recebia o ator da vez e portanto nunca alcançava um efeito que mora em outro ator. Corrigido: `TurnHookContext` ganhou `listActors(): Record<string, unknown>[]` (leitura do mundo, `packages/system-api/src/combat.ts`; real em `createDocumentWriteTurnHookContextServices`, `throw TurnHookContextStubError` no stub) e o hook varre todos os atores a cada `turn-start`/`turn-end`. `onCombatEnd` segue no-op. Risco latente: `actor-mechanics-service.ts` monta o contexto do `onDamageApplied` só com o stub, então `listActors` lança ali até alguém ligar o serviço real. Pendente para a BHR-F4-08: a op que aplica grava o `ownerActorId` (REQ-BHR-010); `actor:applyCondition` já aceita `expiry` (FusionExpirySchema) do chamador e o `consume.ts` grava `daily-prep` com o consumidor como dono.
- **Depende de**: BHR-F0-02, ALQ-F2-09, ALQ-F1-04
- **Paralelo com**: BHR-F1-04, BHR-F1-05, BHR-F1-07
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: `effect-expiry-owner.test.ts` (satélite): efeito com `ownerActorId = dono`, aplicado em nome do companheiro, **não** sai no `turnStart` do companheiro e sai no `turnStart` do dono; teste de integração no core (porta via `helpers/ports.ts`) com `combat:nextTurn` passando companheiro → dono confirmando o broadcast da remoção. Falha antes se o resolvedor usar a origem.
- **Prova visual (print)**: sem UI (a anotação no canto vem na BHR-F2-07).
- **Spec/REQ**: `REQ-BHR-005..010`, `REQ-CBT-068`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L1

### B-F1 — Dado e conteúdo

### BHR-F1-01 — Leshy Raiz dá os 10 PV de ancestralidade (B3)

- **Repo**: satélite
- **Onde**: `systems/engine-2e/src/progression/build-steps.ts:189-199` (`findAncestryHp`) e `:957` (`hpMax = ancestryHp + …`); regra do heritage "Root Leshy" em `systems/pf2e/packs/heritages-core/documents.json` (`ActiveEffectLike` `system.attributes.ancestryhp` = 10, override)
- **Entrega**: A derivação de PV passa a respeitar o override de `ancestryhp` vindo de herança (e de qualquer item com o mesmo AEL), em vez de ler só `ancestry.system.hp`. Corrige os −2 PV em todos os níveis (Fusion 20/32/44 → 22/34/46). Generaliza: toda herança com override de `ancestryhp` no pack passa a valer, não só a do Leshy.
- **Depende de**: —
- **Paralelo com**: BHR-F0-01, BHR-F0-02, BHR-F1-02
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: não circular — a asserção escreve a regra (PV = 10 + nível × (10 + Con)) e confere com a ficha montada do Bhrotto nos níveis 1/2/3 (22/34/46); varredura: toda herança do pack com AEL `ancestryhp` muda o PV para o valor do override; herança sem o AEL não muda nada (snapshot da `ALQ-F4-03` intacto fora delas).
- **Prova visual (print)**: cabeçalho da ficha do Bhrotto nível 3 com PV 46 e o tooltip "como foi calculado".
- **Spec/REQ**: `REQ-BHR-011..012`, `REQ-PF2-279`
- **Tamanho**: P
- **Onda**: 1 · **Lote**: L1

### BHR-F1-02 — Patrulheiro treina Natureza (B4, DC-09)

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/curation/` (correção curada de `trainedSkills` da classe); `systems/pf2e/packs/classes-core/documents.json` (Ranger `trainedSkills.value = ["survival"]`); `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (reabertura de escolha livre na colisão)
- **Entrega**: O Ranger passa a treinar Natureza e Sobrevivência, como o livro (`journals/classes.json`, página Ranger). Personagem Patrulheiro existente que já gastou uma escolha livre com Natureza ganha a escolha de volta como **livre aberta**, pelo mesmo caminho que a colisão da regra 2 da casa já usa (o grupo `skillTraining-1-0` passa a 5 de 6) — nenhum treino se perde.
- **Depende de**: — (bloqueada pela resposta à DC-09)
- **Paralelo com**: BHR-F0-01, BHR-F0-02, BHR-F1-01
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: replay do Hermit (antecedente sem perícia) dá perícias automáticas `nature, survival`; replay com Natureza escolhida como livre abre uma escolha (5 de 6) sem perder treino; varredura de classes: nenhuma outra classe muda de `trainedSkills`.
- **Prova visual (print)**: Plano do Bhrotto nível 1 com Natureza automática da classe e a contagem de livres.
- **Spec/REQ**: `REQ-BHR-013..014`
- **Tamanho**: P
- **Onda**: 1 · **Lote**: L1

### BHR-F1-03 — Mangual de Guerra no `weapons-core` (B5)

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/build-mvp-subset.mjs` (lista do subconjunto) ou curadoria; `systems/pf2e/packs/weapons-core/documents.json` e `i18n.pt-BR.json`; vendor `equipment/war-flail.json` (Apache-2.0)
- **Entrega**: Publica o War Flail (marcial, mangual, 1d10 contundente, duas mãos, desarmar/varrer/derrubar, 2 po, volume 2, nível 0 — `dados/itens.md`) com nome pt-BR "Mangual de Guerra" e sem arte da Paizo. É a arma do Bhrotto e a que o Alcance Prênsil altera (BHR-F2-04).
- **Depende de**: —
- **Paralelo com**: BHR-F0-01, BHR-F0-02, BHR-F1-01
- **Modelo / esforço**: haiku / low — dado puro.
- **Teste (TDD)**: teste de pack: o documento existe, `damage.die = d10`, `usage = held-in-two-hands`, traços `disarm, sweep, trip`, `group = flail`; a ficha do Bhrotto com o Mangual de Guerra equipado e `runes.striking = 1` mostra `+9` e `2d10+4` no nível 3 (valor escrito no teste pela conta do livro).
- **Prova visual (print)**: Mangual de Guerra no compêndio em pt-BR e na linha de golpes da ficha.
- **Spec/REQ**: `REQ-BHR-015`
- **Tamanho**: P
- **Onda**: 1 · **Lote**: L1

### BHR-F1-04 — Pack homebrew de tipos de companheiro: urso e antílope (D-B01, D-B14, D-B22)

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/packs/companion-types-homebrew/` (`documents.json`, `i18n.pt-BR.json`); schema `systems/pf2e/src/schemas/companion-type.ts` (novo); registro do pack em `systems/pf2e/src/index.ts`
- **Entrega**: Pack com o shape `CompanionType` (§2.4): Urso (Player Core p. 207) e Antílope (Howl of the Wild p. 90), números do stat block conferidos em `dados/companheiros.md` (d), **descrições em palavras próprias**, sem arte (ícone livre). Cada tipo traz `stagePreview` (o que ganha em Maduro, Ágil, Selvagem, Especializado) para o picker mostrar antes do requisito (D-B14), redigido como "a partir de Maduro" **sem citar nível de classe** (D-B22: Mature Animal Companion é talento opcional), o `effectRef` do Apoio (entra no pack da BHR-F1-05) e a Manobra Avançada (Abraço de Urso; Recuo Saltitante) como texto. Extensível: novo tipo = novo documento, sem código.
- **Depende de**: BHR-F0-01
- **Paralelo com**: BHR-F0-03, BHR-F1-05, BHR-F1-07
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: teste de schema (os dois documentos validam; tipo sem `ancestryHp` falha); teste de conteúdo não circular: Urso `ancestryHp 8`, For+3 Des+2 Con+2 Int−4 Sab+1 Car+0, Small, 35 pés, mandíbulas 1d8 P e garra 1d6 S ágil; Antílope `ancestryHp 6`, For+2 Des+3, Medium ou Large, 40 pés, `special: ["mount"]`, chifres 1d6 P acuidade e casco 1d4 C ágil acuidade — valores escritos no teste a partir do livro; nenhum texto de `stagePreview` contém referência a nível ("nível 6", "level") (D-B22).
- **Prova visual (print)**: sem UI própria (aparece no picker da BHR-F4-05).
- **Spec/REQ**: `REQ-PET-098..100`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L1

### BHR-F1-05 — Pack de efeitos do Patrulheiro e da montaria

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/packs/effects-ranger-homebrew/` (`documents.json`, `i18n.pt-BR.json`) no formato do `equipment-effects-core` (ALQ-F2-02: unidades normalizadas, `expiry` normalizado); `feats-core` (ligar `selfEffect`/referência de efeito de Caçar Presa, Caçador de Monstros, Animal de Companhia)
- **Entrega**: Efeitos que o vendor referencia e o pack não tem (B9: "o efeito `Effect: Monster Hunter` não existe no pack"): **Presa (Caçar Presa)** (+2 circ. Percepção ao Buscar e Sobrevivência ao Rastrear, predicado `target:mark:hunted-prey`), **Astúcia** (+2 circ. Enganação/Intimidação/Furtividade/Rememorar e +1 circ. CA com `origin:mark:hunted-prey`), **Caçador de Monstros** (+1 circ. no próximo ataque, `expiry.on = "after-roll"`), **Apoio do urso** (+1d8 cortante em golpe que acerta criatura ao alcance do urso, `turn-start` do dono), **Apoio do antílope** (+1d6 sangramento persistente, só montado), **Montado** (−2 circ. Reflexos). Regras em kebab-case (DF-15); textos em palavras próprias.
- **Depende de**: BHR-F0-01, BHR-F0-02, ALQ-F2-02
- **Paralelo com**: BHR-F0-03, BHR-F1-04, BHR-F1-07
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: teste de pack: cada efeito valida no schema de efeito; `expiry` de cada um bate com a regra escrita no teste (Apoio = `turn-start` + `ownerActorId` preenchido na aplicação; Caçador de Monstros = `after-roll`); nenhum texto em inglês no pt-BR.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-016..020`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L1

### BHR-F1-06 — pt-BR do que o jogador vê (B14)

- **Repo**: satélite
- **Onde**: `systems/pf2e/packs/feats-core/i18n.pt-BR.json` (Dedicação de Domador de Bestas, Medicina Natural, Floração Nobre), `actions-core/i18n.pt-BR.json` (Caçar Presa), `class-features-core/i18n.pt-BR.json`; `sheets/pf2e/src/lib/sheets/pf2e/actionsVM.ts:370` (`rowFromEmbeddedItem`: nome do item embutido sai em inglês, "Grasping Reach"); `systems/pf2e/src/derivations/situationalNotes.ts:235-238` (`MARK_NAMES_PT`) e `:410-414` (predicado cru)
- **Entrega**: Fecha a seção 6 do L-ficha: tradução da Dedicação de Domador de Bestas (nome, texto, pré-requisito); **um nome só** para Caçar Presa (ação e característica; hoje "Rastrear Presa" × "Caçar Presa"); acentos de Caçar Presa e Medicina Natural; "wilderness" = "ambiente selvagem" (não "deserto"); "Acesso:" separado do corpo na Floração Nobre; linha da aba Ações com o nome traduzido do item; `MARK_NAMES_PT` com `hunted-prey` = "presa" e `monster-hunter`, e nenhum `target:mark:*`/`origin:mark:*` cru na nota (vira "contra a presa", D-B18). Nomes das runas pela DC-11.
- **Depende de**: —
- **Paralelo com**: BHR-F0-01, BHR-F0-02, BHR-F1-01
- **Modelo / esforço**: sonnet / low.
- **Teste (TDD)**: varredura de i18n: os ids listados têm `name` e `description` pt-BR; nenhuma nota situacional da ficha do Bhrotto contém `:mark:` cru; nenhuma string de ação do Bhrotto sai em inglês no `actionsVM`.
- **Prova visual (print)**: aba Ações e notas situacionais do Bhrotto em pt-BR.
- **Spec/REQ**: `REQ-BHR-021..023`
- **Tamanho**: M
- **Onda**: 1 · **Lote**: L1

### BHR-F1-07 — Antecedente Wildborne (B2, D-B07, DC-12) — desbloqueada: Lost Omens World Guide (OGL), ver dados/wildborne.md

- **Repo**: satélite
- **Onde**: novo `systems/pf2e/packs/backgrounds-homebrew/` (`documents.json`, `i18n.pt-BR.json`); registro em `systems/pf2e/src/index.ts`
- **Entrega**: Wildborne já curado do Lost Omens World Guide (OGL 1.0a) em `dados/wildborne.md` (DEC-BHR-22): 2 aumentos de atributo (um deles Destreza ou Sabedoria, o outro livre), Natureza treinada, Forest Lore como Lore e Medicina Natural por `GrantItem`. Antecedente num pack próprio do mundo, com a origem declarada (OGL, Lost Omens World Guide), texto pt-BR próprio, sem texto nem arte da Paizo. Pendente só a confirmação do Alexandre de qual aumento (Des/Sab) o Bhrotto usou.
- **Depende de**: —
- **Paralelo com**: BHR-F0-03, BHR-F1-04, BHR-F1-05
- **Modelo / esforço**: haiku / low.
- **Teste (TDD)**: replay do Bhrotto com o Wildborne: Medicina Natural vem com `grantedBy` do antecedente, Forest Lore treinado (+6 no nível 3), conta de perícias do PDF fecha.
- **Prova visual (print)**: Plano do Bhrotto com o antecedente escolhido e as perícias.
- **Spec/REQ**: `REQ-BHR-024`
- **Tamanho**: P
- **Onda**: 2 · **Lote**: L1

### BHR-F1-08 — Medicina Natural: Natureza no Tratar Ferimentos (B10)

- **Repo**: satélite
- **Onde**: handler novo `fusion-skill-substitution` em `systems/engine-2e/src/ruleElementRegistry.ts` (registro, kebab-case); curadoria da regra em `feats-core` Natural Medicine (`N6YWCOq6zL8w5gcR`); linha executável de Tratar Ferimentos (`sheets/pf2e/.../actions/executableRows.ts`, da BHR-F2-08); `situationalNotes.ts` (a nota +2 com ingredientes frescos que hoje não aparece)
- **Entrega**: Tratar Ferimentos na aba Ações oferece **Medicina ou Natureza** quando o ator tem uma regra `fusion-skill-substitution { action: "treat-wounds", skill: "nature" }`; a CD respeita o rank da perícia usada (inclui as CDs maiores). A nota "+2 circunstância em ambiente selvagem (critério do Mestre)" aparece como opção a ligar (`fresh-ingredients`), não como texto cru.
- **Depende de**: BHR-F2-08, BHR-F2-01
- **Paralelo com**: BHR-F2-04, BHR-F2-06, BHR-F3-02
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: com o talento, a rolagem de Tratar Ferimentos com Natureza usa o modificador de Natureza (+9 no nível 3, especialista) e sem o talento a opção não existe; teste de escopo da ALQ-F4-03 (o handler só altera atores com a regra).
- **Prova visual (print)**: aba Ações do Bhrotto com Tratar Ferimentos oferecendo Natureza e o card da rolagem.
- **Spec/REQ**: `REQ-BHR-025..027`, `REQ-PF2-280`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L1

### BHR-F1-09 — Roteiro `tutorial-e2e` do L1 (base e dados)

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/bhrotto-l1.spec.ts`; prints em `.fusion-build/bhrotto/L1/`
- **Entrega**: Roteiro que monta o Bhrotto nível 3 (replay do L-ficha) num mundo existente, servidor isolado e data-dir no scratchpad, e fotografa: PV 46 (B3), Natureza automática (B4), Mangual de Guerra na ficha, Tratar Ferimentos com Natureza, aba Ações e notas em pt-BR. Relatório P3 com protótipo × tela; visão do jogador e do Mestre. O print da aba Ações no replay real tem de provar o REQ-BHR-023 ("Alcance Prênsil" em pt-BR): o fallback por slug da BHR-F1-06 não foi reproduzido no app real (o caminho primário por sourceId já devia traduzir; o sintoma original pode ser artefato do harness de coleta), então só este print fecha o requisito.
- **Depende de**: BHR-F1-01, BHR-F1-02, BHR-F1-03, BHR-F1-06, BHR-F1-08
- **Paralelo com**: BHR-F2-10, BHR-F3-03, BHR-F3-07
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L1

### B-F2 — Motor de regras (importado do Alquimista e do Guerreiro)

### BHR-F2-01 — Seletores de ataque, dano e defesa no pipeline (importa GUE-F2-01)

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/embeddedModifiers.ts`, `character.ts:279-300,1056`, `actions/strikes.ts:224-340` (linhas de 2026-09-16 no plano do Guerreiro; reconferir)
- **Entrega**: Ficha da GUE-F2-01 inteira: liga `ac`, `strike-damage`, `melee/ranged-strike-attack-roll`, `saving-throw`, `skill-check`, `perception`, `initiative` ao `ctx.synthetics` (hoje só `hp` e `land-speed` agregam). É o que faz um `flat-modifier` condicional (Astúcia, Caçador de Monstros, Montado −2 Reflexos) chegar ao número.
- **Depende de**: BHR-F0-01, BHR-F0-02, ALQ-F2-08, ALQ-F4-19
- **Paralelo com**: BHR-F0-03, BHR-F1-04, BHR-F1-05
- **Modelo / esforço**: sonnet / high — mexe no pipeline que todas as classes usam.
- **Teste (TDD)**: um `flat-modifier` sem predicado em cada seletor muda exatamente aquele número; snapshot da ALQ-F4-03 (níveis 1/5/10/15/20 das classes) inalterado onde não há regra nova.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-041..043` (referencia `REQ-GUE` da GUE-F2-01)
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L2

### BHR-F2-02 — Predicado com contexto de alvo e `target:mark:*` (recorte da GUE-F2-02, G1)

- **Repo**: satélite
- **Onde**: `systems/engine-2e/src/effectsEngine.ts:112` (avaliação de predicado), `systems/pf2e/src/derivations/character.ts`; vocabulário em `systems/pf2e/src/rollOptions.ts` (ou onde a GUE-F2-02 o fixar)
- **Entrega**: Só o mecanismo de predicado com **contexto do alvo** (sem `hands:*` nem `item:group`, que ficam para o Guerreiro): a avaliação recebe as opções do ator **e** do alvo da rolagem, e passam a existir `target:mark:<slug>`, `origin:mark:<slug>` e `target:condition:<slug>`. Modificador com esse predicado fica **condicional** na ficha (não entra no número base) e é resolvido no momento da rolagem pelo servidor (BHR-F2-05).
- **Depende de**: BHR-F2-01
- **Paralelo com**: BHR-F2-05, BHR-F2-07, BHR-F2-08
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: `flat-modifier` com `target:mark:hunted-prey` não muda o número base; avaliado com opções de alvo contendo a marca, soma; sem a marca, não soma. `origin:mark:hunted-prey` só vale na defesa contra atacante marcado.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-044..046`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L2

### BHR-F2-03 — Importer: `item-alteration` completo (recorte da ALQ-F4-04)

- **Repo**: satélite
- **Onde**: `tools/importer-pf2e/src/transform.mjs` (conversão de `ItemAlteration`); `systems/pf2e/packs/feats-core/documents.json` regerado (Alcance Prênsil); `tools/importer-pf2e/src/__tests__/`
- **Entrega**: Da ALQ-F4-04, só a parte de `ItemAlteration → item-alteration` completo (propriedades `traits`, `damage-dice-faces`, `other-tags`, `damage-type`, com predicado), que hoje chega `unconverted` ou só como texto. Os outros tipos da ALQ-F4-04 (`adjust-degree-of-success`, `damage-alteration`, `adjust-strike`) ficam com o Alquimista.
- **Depende de**: BHR-F0-02
- **Paralelo com**: BHR-F0-03, BHR-F1-04, BHR-F1-05
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: o Alcance Prênsil do vendor sai do importer com duas regras `item-alteration` (`traits add reach`, `damage-dice-faces downgrade`) e o predicado (equipada, corpo a corpo, duas mãos, sem reach); nenhum `unconverted` restante de `ItemAlteration` nos talentos do Bhrotto; diff do pack só nos documentos com `ItemAlteration`.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-BHR-047`, `REQ-PF2-281`
- **Tamanho**: M
- **Onda**: 2 · **Lote**: L2

### BHR-F2-04 — Leitor de ITEM-ALTER e o interruptor do Alcance Prênsil (recorte da ALQ-F4-14, B7, D-B16)

- **Repo**: satélite
- **Onde**: novo `systems/engine-2e/src/itemAlteration.ts`; `systems/pf2e/src/derivations/itemAlterations.ts`, `equipment.ts:238-244`; `systems/pf2e/src/derivations/rollOptionToggles.ts:14-27` e `:660` (`ruleIsRead`: "an ItemAlteration only reaches display text")
- **Entrega**: Handler `item-alteration` real para `traits` e `damage-dice-faces` (com predicado contra as opções do item-alvo e do ator), na fase `item` (DF-15). Com o leitor, `ruleIsRead` passa a considerar o toggle `grasping-reach` lido e a ficha oferece o interruptor; ligado, o golpe do Mangual de Guerra ganha `reach` (10 pés) e o dado cai um passo (`2d10+4` → `2d8+4`). O texto do estado **não cita a arma** (D-B16): "Alcance Prênsil: alcance 10 pés, dado da arma um passo menor"; na faixa de estados aparece só o nome (D-B23, BHR-F2-10).
- **Depende de**: BHR-F2-03, BHR-F2-02, ALQ-F0-07
- **Paralelo com**: BHR-F1-08, BHR-F2-06, BHR-F3-02
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: não circular — com o toggle ligado e o Mangual de Guerra (`runes.striking = 1`): traços incluem `reach`, dano `2d8+4`; desligado volta a `2d10+4`; arma de uma mão ou já com `reach` não muda (predicado); teste de escopo da ALQ-F4-03.
- **Prova visual (print)**: ficha com o interruptor "Alcance Prênsil" desligado × ligado e a linha do golpe mudando.
- **Spec/REQ**: `REQ-BHR-048..050`, `REQ-SYS-161`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L2

### BHR-F2-05 — `RollNotes` e `onRollResolved` no servidor (importa ALQ-F4-09)

- **Repo**: core + satélite
- **Onde**: `packages/server/src/chat/chat-handler.ts` (resolução da rolagem); `packages/system-api/src/effects.ts`; satélite `systems/pf2e/src/hooks/` (ouvinte)
- **Entrega**: Ficha da ALQ-F4-09: o servidor re-deriva o ator, resolve as notas e os modificadores condicionais contra as opções do ator **e do alvo** (inclui `target:mark:*` lido do `TokenMark`, BHR-F3-06, quando existir), grava `flags.fusion.rollNotes` e emite `onRollResolved({ message, rollContext, degree, targets })`. É o veículo do predicado de alvo no servidor e do `after-roll`.
- **Depende de**: BHR-F2-01, BHR-F0-01, ALQ-F4-02
- **Paralelo com**: BHR-F2-02, BHR-F2-07, BHR-F2-08
- **Modelo / esforço**: opus / high — trecho do `chat-handler.ts` disputado pelas três frentes.
- **Teste (TDD)**: socket (porta via `helpers/ports.ts`): rolagem com modificador condicionado a `target:mark:x` soma só quando o alvo da `targetSnapshot` está marcado; o payload do cliente com bônus forjado é ignorado (DF-17); `onRollResolved` dispara uma vez por rolagem com grau e alvos.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-051..053`
- **Tamanho**: G
- **Onda**: 3 · **Lote**: L2

### BHR-F2-06 — Expiração `after-roll` (G3, DC-05)

- **Repo**: satélite
- **Onde**: `FusionExpiry` está declarado em **quatro** lugares que precisam andar juntos (conferido na BHR-F0-03): o tipo `ExpiryOn`/`FusionExpiry` em `systems/engine-2e/src/expiry.ts`, o zod `.strict()` `ExpiryOnSchema`/`FusionExpirySchema` em `packages/shared/src/protocol.ts` (é o que o `actor:applyCondition` valida; sem ele o `after-roll` é recusado no servidor) e os zods de `systems/pf2e/src/schemas/item-effect.ts` e `systems/pf2e/src/schema-primitives.ts` (`FusionExpirySchema`, usado pelo gerenciador de condições). `ExpiryEvent` (engine-2e) ganha a variante `after-roll`; `resolveExpirations(actor, event)` (`systems/engine-2e/src/expiry.ts`) segue sem estado. Ouvinte de `onRollResolved` em `systems/pf2e/src/hooks/effect-expiry.ts`
- **Entrega**: `FusionExpiry` ganha `"after-roll"` + `rollPredicate` (§2.2). O mesmo `resolveExpirations` (DF-08) é chamado pelo ouvinte de `onRollResolved`: o efeito sai depois da primeira rolagem que casa com o predicado. É o `removeAfterRoll` do Caçador de Monstros.
- **Depende de**: BHR-F2-05, BHR-F0-03
- **Paralelo com**: BHR-F1-08, BHR-F2-04, BHR-F3-02
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: efeito `after-roll` com `rollPredicate ["attack-roll"]` sobrevive a uma rolagem de perícia e sai depois da primeira rolagem de ataque; o bônus vale **nessa** rolagem (sai depois, não antes); efeito sem `after-roll` não é tocado.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-054..055`, `REQ-PF2-282`, `REQ-SYS-162`
- **Tamanho**: P
- **Onda**: 4 · **Lote**: L2

### BHR-F2-07 — Efeitos ativos na ficha e no canto (importa ALQ-F2-12)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte`, `characterSheetVM.ts`; anotação no canto (D-16) no padrão que a ALQ deixou
- **Entrega**: Ficha da ALQ-F2-12 recortada: seção "Efeitos ativos" com origem, duração restante ("até o início do seu próximo turno", "até a próxima rolagem de ataque", "até nova Caçar Presa") e remover (dono e Mestre). O Apoio ativo e a Presa aparecem também na anotação do canto do dono e do Mestre. Sem "Usar"/quantidade de consumível (fora do Bhrotto).
- **Depende de**: BHR-F0-03, ALQ-F2-11
- **Paralelo com**: BHR-F2-02, BHR-F2-05, BHR-F2-08
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: VM: efeito embutido com `expiry` aparece com o rótulo de duração correto para cada `on`; remover emite o op de remoção; jogador sem posse não vê o botão.
- **Prova visual (print)**: ficha do Bhrotto com Apoio do urso e Presa ativos, e a anotação no canto (tela T3 do protótipo).
- **Spec/REQ**: `REQ-BHR-056..058`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L2

### BHR-F2-08 — Linha executável na aba Ações (recorte da GUE-F5-01, G7)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/components/sheets/pf2e/ActionsTab.svelte`; novo `sheets/pf2e/src/lib/sheets/pf2e/actions/executableRows.ts`; `actionsVM.ts:370` (`rowFromEmbeddedItem` não devolve linha para ação de exploração — B12)
- **Entrega**: O registro `ExecutableActionRow` (§2.6): uma linha com regra vira botão que checa requisito (alvo mirado, montado, companheiro), rola no servidor quando há rolagem, aplica `selfEffect`/marca e posta o card. As outras linhas seguem navegáveis (D-G08). Ações de exploração/passivas concedidas (Chamar Companheiro) passam a aparecer na lista. Sem `ShieldState` nem CA de escudo (fica com o Guerreiro).
- **Depende de**: BHR-F0-03, BHR-F0-01
- **Paralelo com**: BHR-F2-02, BHR-F2-05, BHR-F2-07
- **Modelo / esforço**: sonnet / high — muda a aba de "browser" para executora.
- **Teste (TDD)**: linha registrada sem requisito cumprido fica desabilitada com o motivo; com requisito, o clique emite o op certo; linha sem registro continua só descrição; Chamar Companheiro aparece para o Bhrotto nível 2.
- **Prova visual (print)**: aba Ações com Caçar Presa desabilitada (sem alvo) e habilitada (com alvo).
- **Spec/REQ**: `REQ-BHR-059..062`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L2

### BHR-F2-09 — Gate: nenhuma regra do Bhrotto inerte

- **Repo**: satélite
- **Onde**: novo `sheets/pf2e/src/lib/sheets/pf2e/__tests__/bhrotto-rules.test.ts`; `classBuildHarness.ts:188` (padrão do gate do Guerreiro, GUE-F2-03)
- **Entrega**: Varredura dirigida por dado: para cada regra dos documentos que o Bhrotto usa (Caçar Presa, Astúcia, Caçador de Monstros, Animal de Companhia, Alcance Prênsil, Medicina Natural, Lutador de Titãs, Dedicação de Domador de Bestas, Chamar Companheiro, Leshy Raiz), afirma que ela é **lida** por algum handler (nenhuma em `unsupportedLog`, nenhuma só "display text"). Falha listando a regra inerte. É o que impede "funciona no talento que eu olhei" (lição #48).
- **Depende de**: BHR-F2-04, BHR-F3-10, BHR-F1-08, BHR-F6-04
- **Paralelo com**: BHR-F5-07
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: o próprio gate; antes desta frente ele falha nas regras de B7/B8/B9/B10 (prova de que não é circular).
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-BHR-063`
- **Tamanho**: P
- **Onda**: 11 · **Lote**: L2

### BHR-F2-10 — Faixa "Estados de combate" compacta: nome, clique revela o efeito (D-B23)

- **Repo**: satélite
- **Onde**: componente novo e reutilizável `sheets/pf2e/src/components/sheets/pf2e/CombatStatesStrip.svelte` (+ VM puro `combatStatesVM.ts`); `CharacterSheet.svelte` (bloco de combate, hoje com notas/estados por extenso); ficha do companheiro (BHR-F4-06) e de NPC passam a usar o mesmo componente
- **Entrega**: A faixa "Estados de combate" mostra **só o nome** de cada estado ativo (Presa, Apoio do urso, Alcance Prênsil, Montado, condições, efeitos ativos); clicar no nome revela o texto do efeito (genérico, sem nome de arma, D-B16) e clicar de novo recolhe. É o padrão para **todos** os estados de combate de qualquer ficha, não um caso do Bhrotto: a lista vem dos efeitos ativos (BHR-F2-07), das condições e dos toggles ligados.
- **Depende de**: BHR-F2-07, BHR-F2-04
- **Paralelo com**: BHR-F1-09, BHR-F3-03, BHR-F3-07
- **Modelo / esforço**: sonnet / medium — lente T3 ("estados-v2").
- **Teste (TDD)**: VM: com três estados ativos devolve três itens só com nome e o texto recolhido; alternar um item expande só ele; o texto de nenhum estado contém o nome de uma arma; o mesmo componente renderiza na ficha de personagem e na de NPC (teste de componente).
- **Prova visual (print)**: faixa recolhida e com um estado expandido (tela T3), na ficha do Bhrotto e na de um NPC.
- **Spec/REQ**: `REQ-BHR-064..066`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### B-F3 — Alvo, golpe e Presa

### BHR-F3-01 — Mirar no canvas (importa GUE-F1-01, D-G01)

- **Repo**: core
- **Onde**: `packages/client/src/lib/canvas/tokens/TokenInteractionManager.ts:546-548` (hoje `if (e.button !== 0) return`); `packages/client/src/lib/combat/combatStore.svelte.ts:391-410`; `packages/client/src/lib/combat/targeting.ts`; remoção do SCAFFOLDING do commit 3c275484 (clique esquerdo em token alheio define alvo) se ele vier com a DC-01
- **Entrega**: Ficha da GUE-F1-01 inteira: clique direito num token alterna a mira do usuário, `Esc` limpa; o servidor (`packages/server/src/combat/target-handler.ts`) e a retícula já existem. Remove o gesto provisório do Alquimista.
- **Depende de**: BHR-F0-01, BHR-F0-02, ALQ-F1-05
- **Paralelo com**: BHR-F2-02, BHR-F2-05, BHR-F2-07
- **Modelo / esforço**: sonnet / high — gestor de interação onde clique e arraste disputam.
- **Teste (TDD)**: `targeting-gesture.test.ts` como na GUE-F1-01 (clique direito emite `combat:target` e o segundo desfaz; esquerdo continua selecionando/arrastando; `Esc` limpa só a própria mira; `getMyTargets()` devolve `{ tokenId, actorId, name }[]` do próprio usuário; `setMyTargets(socket, tokenIds)` é assíncrono e recebe o socket como 1º argumento — `packages/client/src/lib/combat/combatStore.svelte.ts`); `CombatQueue` (REQ-CBA-076) verde.
- **Prova visual (print)**: token inimigo mirado visto pelo jogador e pelo Mestre (tela T4).
- **Spec/REQ**: `REQ-BHR-081` (referencia `REQ-GUE-040..042`, `REQ-CNV-100..102`)
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L2

### BHR-F3-02 — O golpe carrega o alvo mirado (importa GUE-F1-02)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:2222-2284`, `CharacterSheet.svelte:268-274`
- **Entrega**: Ficha da GUE-F1-02: `strikeCard`/`rollStrike` enviam `payload.target` + `checkContext` de ataque; sem alvo, o card sai como hoje.
- **Depende de**: BHR-F3-01
- **Paralelo com**: BHR-F1-08, BHR-F2-04, BHR-F2-06
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: como na GUE-F1-02: com alvo mirado o payload leva `targetTokenId`; sem alvo, payload idêntico ao de hoje.
- **Prova visual (print)**: sem UI nova (prova no card da BHR-F3-03).
- **Spec/REQ**: `REQ-BHR-082`
- **Tamanho**: P
- **Onda**: 4 · **Lote**: L2

### BHR-F3-03 — O servidor decide o grau do golpe (importa GUE-F1-03, D-G02)

- **Repo**: core + satélite
- **Onde**: core `packages/shared/src/chat/types.ts:389-398` (`CheckContextSchema`), `packages/server/src/chat/chat-handler.ts:451-507,1620` (`computeAttackDegree`); satélite `AbilityCard.svelte`, `abilityCardVM.ts`
- **Entrega**: Ficha da GUE-F1-03: `AttackCheckContext` (`kind: "attack"`, `targetTokenId`, `mapIndex`, `agile?`), CA lida do banco (REQ-ACH-070), sem alvo resolvível sem grau (REQ-ACH-071); card com o grau e **um** botão de dano coerente.
- **Depende de**: BHR-F3-02
- **Paralelo com**: BHR-F1-09, BHR-F2-10, BHR-F3-07
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: como na GUE-F1-03: CA forjada no payload é ignorada; 20 natural sobe um grau; sem alvo, dois botões.
- **Prova visual (print)**: card de golpe do Bhrotto com "Acerto crítico" e um botão de dano (tela T5).
- **Spec/REQ**: `REQ-BHR-083` (referencia `REQ-GUE` da GUE-F1-03, `REQ-CHT-054..060`)
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### BHR-F3-04 — O servidor conta o ataque múltiplo (importa GUE-F1-04, D-G03)

- **Repo**: core
- **Onde**: novo `packages/server/src/combat/map-counter.ts`; `packages/server/src/combat/combat-event-bus.ts` (`onLifecycle("turnStart")`); `chat-handler.ts` (chama `noteAttack` quando o `AttackCheckContext` grada)
- **Entrega**: Ficha da GUE-F1-04: `MapCounter` (`getAttackCount`, `noteAttack`), zerado no `turnStart`; cálculo por `calculateMapPenalty` (`engine-2e/src/map.ts:31`). Já nasce com o ponto de extensão `mapGroupOf(combatantId)` (identidade por enquanto) que a BHR-F5-05 preenche.
- **Depende de**: BHR-F0-01, BHR-F0-02, ALQ-F1-04
- **Paralelo com**: BHR-F2-02, BHR-F2-05, BHR-F2-07
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: como na GUE-F1-04: três golpes no turno → índices 0/1/2; `turnStart` zera; golpe com "não conta" não incrementa.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-084`, `REQ-CBT-069`
- **Tamanho**: M
- **Onda**: 3 · **Lote**: L2

### BHR-F3-05 — O botão de golpe já sabe o MAP (importa GUE-F1-05)

- **Repo**: satélite
- **Onde**: `CharacterSheet.svelte:1013-1021`, `characterSheetVM.ts:2263-2284`
- **Entrega**: Ficha da GUE-F1-05: um botão com a penalidade corrente (Mangual de Guerra +9 → +4 → −1); os três botões viram seletor recolhido "forçar MAP".
- **Depende de**: BHR-F3-04, BHR-F3-03
- **Paralelo com**: BHR-F3-10, BHR-F4-02, BHR-F4-08
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: VM com contagem 0/1/2 mostra +9/+4/−1 (arma sem `agile`) e +9/+5/+1 para `agile`; "forçar MAP" envia o índice escolhido e o card grava qual foi.
- **Prova visual (print)**: linha do golpe antes e depois do primeiro ataque (tela T3).
- **Spec/REQ**: `REQ-BHR-085`
- **Tamanho**: P
- **Onda**: 6 · **Lote**: L2

### BHR-F3-06 — `TokenMark`: a Presa persistida no servidor (G1, D-B05, DC-03)

- **Repo**: core
- **Onde**: novo `packages/shared/src/combat/token-mark.ts`; novo `packages/server/src/combat/mark-handler.ts` (registro em `net/socket-manager.ts`); `packages/server/src/net/redaction.ts` (marca sobre token oculto); `packages/shared/src/protocol.ts` (`mark:set`, `mark:clear`)
- **Entrega**: Contrato §2.1. Ops `mark:set`/`mark:clear` com permissão no servidor (GM em qualquer ator; jogador só no próprio ator e só em token da própria `TargetSelection` no momento do set); `exclusive` (nova Caçar Presa substitui a anterior); persistência em `Actor.flags.fusion.tokenMarks`; broadcast com redação por papel (`isRolePrivileged`) — jogador que não vê o token não recebe a marca. A mira continua efêmera (DC-03). Leitura `getMarksOn(targetTokenId)` para o resolvedor de rolagem (BHR-F2-05).
- **Depende de**: BHR-F0-01, BHR-F0-02
- **Paralelo com**: BHR-F1-08, BHR-F2-04, BHR-F2-06
- **Modelo / esforço**: sonnet / high — permissão e redação novas.
- **Teste (TDD)**: socket (porta via `helpers/ports.ts`): jogador marca token mirado (ok) e não mirado (`PERMISSION_DENIED`); marca em ator alheio recusada; segunda Caçar Presa substitui a primeira; marca sobre token oculto não chega a outro jogador e chega ao Mestre; a marca sobrevive ao `turnEnd` (a mira não).
- **Prova visual (print)**: sem UI própria (BHR-F3-07).
- **Spec/REQ**: `REQ-BHR-086..090`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L2

### BHR-F3-07 — A Presa no canvas

- **Repo**: core
- **Onde**: `packages/client/src/lib/canvas/combat/` (novo `PreyMarker.ts`, no padrão do `TargetingMarker.ts`); `combatCanvasController.ts:158-176` (reconciliação por frame); `packages/client/src/lib/combat/` (store das marcas)
- **Entrega**: Token marcado como Presa ganha um selo próprio (distinto da retícula de mira), visto pelo dono, pelos donos do companheiro e pelo Mestre (outros jogadores: conforme a redação da BHR-F3-06). Tooltip "Presa de Bhrotto"; selo some quando a marca sai.
- **Depende de**: BHR-F3-06
- **Paralelo com**: BHR-F1-09, BHR-F2-10, BHR-F3-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: controller: marca recebida desenha o selo no token certo; `mark:clear` remove; token oculto não desenha para não privilegiado.
- **Prova visual (print)**: mapa com o ogro mirado **e** marcado como Presa, visto pelo jogador e pelo Mestre (tela T4).
- **Spec/REQ**: `REQ-BHR-091`, `REQ-CNV-105`, `REQ-TOK-115`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### BHR-F3-08 — Caçar Presa executável (D-B05)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/actions/executableRows.ts` (registro `hunt-prey`); `ActionsTab.svelte`; card em `AbilityCard.svelte`/`abilityCardVM.ts`
- **Entrega**: Caçar Presa exige alvo mirado; o clique faz `mark:set` (`hunted-prey`, exclusiva), aplica o efeito "Presa" do pack (BHR-F1-05) e posta **um** card "Caçar Presa" com o alvo (o efeito aplicado aparece dentro do card, não como segunda mensagem — nota do protótipo). A ação aparece com um só nome em pt-BR (BHR-F1-06).
- **Depende de**: BHR-F3-06, BHR-F3-01, BHR-F2-08, BHR-F1-05
- **Paralelo com**: BHR-F1-09, BHR-F2-10, BHR-F3-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: sem alvo, botão desabilitado; com alvo, `mark:set` com o token mirado e efeito embutido com origem; segunda Caçar Presa em outro alvo troca a marca; card único com o efeito.
- **Prova visual (print)**: card "Caçar Presa" no chat e a aba Ações (telas T3/T5).
- **Spec/REQ**: `REQ-BHR-092..094`, `REQ-CHT-061`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L2

### BHR-F3-09 — Caçador de Monstros no card da Presa (B9)

- **Repo**: satélite
- **Onde**: `executableRows.ts` (`hunt-prey` com variante Caçador de Monstros); `abilityCardVM.ts`; efeito "Caçador de Monstros" (BHR-F1-05)
- **Entrega**: Com o talento, Caçar Presa inclui no **mesmo card** um Rememorar Conhecimento sobre a presa (perícia escolhida pelo jogador; rolagem no servidor). Em sucesso crítico, o card aplica o efeito "+1 circunstância no próximo ataque contra a presa" (`after-roll`, BHR-F2-06; predicado `target:mark:hunted-prey`). "1×/dia por criatura" fica exibido, não imposto (DC-04).
- **Depende de**: BHR-F3-08, BHR-F2-06, BHR-F2-05, BHR-F6-01
- **Paralelo com**: BHR-F4-03, BHR-F4-05, BHR-F4-06
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: crítico no Rememorar aplica o efeito; o próximo ataque **contra a presa** soma +1 e o efeito sai; ataque contra outro alvo não soma e não consome; sem o talento o card não traz o Rememorar.
- **Prova visual (print)**: card combinado Caçar Presa + Rememorar (tela T5).
- **Spec/REQ**: `REQ-BHR-095..097`, `REQ-CHT-062`
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L2

### BHR-F3-10 — A ficha sabe o alvo: "Contra a presa" e Astúcia (D-B05, D-B18)

- **Repo**: satélite
- **Onde**: `characterSheetVM.ts` (golpe e defesa), `CharacterSheet.svelte` (bloco de combate), `systems/pf2e/src/derivations/situationalNotes.ts:410-414`, `rollOptionToggles.ts:220` (`FUSION_CLASS_STATES` sem presa)
- **Entrega**: Com Presa marcada, o golpe mostra a linha "Contra a presa" com os bônus condicionais (Astúcia em perícias, Caçador de Monstros), nunca o nome do alvo (D-B18); a CA mostra "+1 contra a presa (Astúcia)" com a origem ao lado, só enquanto existir marca (tela T3). Quando o alvo mirado **é** a presa, o botão de golpe já traz o total com o bônus (o servidor confirma na rolagem, BHR-F2-05); quando não é, o número normal. As notas cruas somem.
- **Depende de**: BHR-F2-02, BHR-F3-03, BHR-F3-06, BHR-F2-05
- **Paralelo com**: BHR-F3-05, BHR-F4-02, BHR-F4-08
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: VM: sem marca, nenhuma linha "contra a presa"; com marca e alvo = presa, a perícia de Intimidação mostra +2; com alvo ≠ presa, não; texto nunca contém o nome do alvo; nota situacional sem `:mark:`.
- **Prova visual (print)**: ficha de combate com e sem Presa (tela T3).
- **Spec/REQ**: `REQ-BHR-098..101`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L2

### BHR-F3-11 — Roteiro `tutorial-e2e` do L2 (motor, alvo e Presa)

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/bhrotto-l2.spec.ts`; prints em `.fusion-build/bhrotto/L2/`
- **Entrega**: Roteiro: o Bhrotto mira o ogro (botão direito), faz Caçar Presa com Rememorar (crítico forçado pelo seed do servidor de teste), ataca duas vezes (MAP +9/+4, +1 do Caçador de Monstros só no primeiro), liga o Alcance Prênsil (dado d8, alcance 10), abre e fecha um estado na faixa compacta, vê a CA +1 contra a presa e os efeitos ativos. Visão do jogador e do Mestre; relatório P3 protótipo × tela (T3, T4, T5).
- **Depende de**: BHR-F3-05, BHR-F3-07, BHR-F3-09, BHR-F3-10, BHR-F2-04, BHR-F2-10
- **Paralelo com**: BHR-F4-07, BHR-F4-10, BHR-F5-03
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L2

### B-F4 — Companheiro animal

### BHR-F4-01 — Derivação pura por tipo e estágio (D-B01)

- **Repo**: satélite
- **Onde**: novo `systems/engine-2e/src/companions/deriveAnimalCompanion.ts` (+ `types.ts`, §2.4)
- **Entrega**: Função pura `deriveAnimalCompanion({ type, stage, masterLevel, size })` com as fórmulas de `dados/companheiros.md` (a)/(b): PV = `ancestryHp + nível × (6 + Con)`; CA = `10 + nível + 2 + Des` (+ item até +3 de barding); saves/Percepção/perícias por rank (treinado 2 / especialista 4 …); golpes `nível + 2 + For` (ou Des se `finesse`), dano 1 dado + For (2 dados em Maduro, +2/+3 em Ágil/Selvagem, 3 dados em Especializado); ajustes de atributo e tamanho por estágio. Devolve `breakdown` por campo ("como foi calculado").
- **Depende de**: BHR-F1-04
- **Paralelo com**: BHR-F1-09, BHR-F2-10, BHR-F3-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: não circular — a tabela (d) de `dados/companheiros.md` escrita no teste: Urso nível 3 = PV 32, CA 17, Fort/Ref/Von +7/+7/+6, Percepção +6, mandíbulas +8 1d8+3, Acro/Atl/Intim +7/+8/+5; Antílope nível 3 = PV 30, CA 18, +7/+8/+6, chifres +8 1d6+2 (ataque por Des, dano por For). Mais um caso Maduro (nível 6) pela regra do avanço.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-PET-101..104`
- **Tamanho**: M
- **Onda**: 5 · **Lote**: L3

### BHR-F4-02 — O ator companheiro passa a ser derivado (B1)

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/familiar.ts:24-25,250-266` (ramo `!mirrorsMaster` zera ataque e perícias); `systems/pf2e/src/schemas/actor-familiar.ts:13-17,51` (`CompanionLink`, §2.4)
- **Entrega**: Ator `familiar` com `companionKind: "animalCompanion"` e `system.companion.typeSlug` deriva tudo pela BHR-F4-01 a partir do nível do dono (`masterActorId`): golpes, perícias, atributos, sentidos, velocidade, tamanho. O campo `progression.stage` que nada lia passa a ser o `system.companion.stage`. Os campos derivados ficam somente leitura (D-B01).
- **Depende de**: BHR-F4-01
- **Paralelo com**: BHR-F3-05, BHR-F3-10, BHR-F4-08
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: derivação do ator urso ligado ao Bhrotto nível 3 = números da BHR-F4-01; `derived.attack` deixa de ser 0; familiar comum (não `animalCompanion`) não muda (snapshot).
- **Prova visual (print)**: sem UI própria (BHR-F4-06).
- **Spec/REQ**: `REQ-PET-105..106`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L3

### BHR-F4-03 — Recalculo no servidor quando o dono muda (D-B02)

- **Repo**: core
- **Onde**: `packages/server/src/net/handlers/doc-handlers.ts` (após o update do ator; padrão de `rederiveActorsForChangedVariantRules`, `:1155`); `packages/server/src/documents/derive.ts`
- **Entrega**: Atualizar um ator que é `masterActorId` de companheiros re-deriva cada companheiro ligado no servidor e inclui os que mudaram no mesmo broadcast. Fecha a Q-PET-02 (`specs/29:472`). Sem recálculo no cliente.
- **Depende de**: BHR-F4-02
- **Paralelo com**: BHR-F3-09, BHR-F4-05, BHR-F4-06
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: socket (porta via `helpers/ports.ts`): subir o Bhrotto de nível 3 para 4 faz o broadcast trazer o urso com PV 40 (8 + 4×8); update do dono que não muda nível não re-transmite o companheiro (referência idêntica, como na derivação de regras da casa).
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-PET-107..108`
- **Tamanho**: P
- **Onda**: 7 · **Lote**: L3

### BHR-F4-04 — Permissão de criar companheiro: Animal de Companhia e Domador de Bestas (D-B09, DC-07)

- **Repo**: core + satélite
- **Onde**: satélite `systems/pf2e/src/companion-grant.ts:84-94` (`companionGrantAllows`: `default: return false` para `animalCompanion`); core `packages/server/src/net/handlers/doc-handlers.ts:521` (`masterHasCompanionOfGroup`) e `:540` (`authorizePlayerCompanionCreate`)
- **Entrega**: `companionGrantAllows("animalCompanion", master)` passa a ser verdadeiro quando o dono tem concessão (talento Animal de Companhia de qualquer classe, Dedicação de Domador de Bestas). O limite por grupo deixa de ser 1 e passa a ser o **número de concessões** (emenda da REQ-PET-093, DC-07), contado no servidor; cada companheiro guarda o `grantSlotId` que o criou. O Mestre segue sem a checagem.
- **Depende de**: BHR-F0-01
- **Paralelo com**: BHR-F1-08, BHR-F2-04, BHR-F2-06
- **Modelo / esforço**: sonnet / high — regra de permissão do servidor.
- **Teste (TDD)**: Bhrotto nível 1 cria um companheiro e o segundo é recusado; nível 2 (com a Dedicação) cria o segundo e o terceiro é recusado; personagem sem concessão é recusado; `mount` continua recusado ao jogador.
- **Prova visual (print)**: sem UI própria (BHR-F4-05).
- **Spec/REQ**: `REQ-PET-109..111`
- **Tamanho**: M
- **Onda**: 4 · **Lote**: L3

### BHR-F4-05 — Plano: sub-slot "escolher companheiro" e picker de tipo (D-B09, D-B14, D-B15, D-B22)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts` (slots aninhados no padrão `level-card__slot--nested` de Chamar Companheiro); `PlanColumn.svelte`; picker de tipo (novo componente no padrão do `picker-modal`); `petsVM.ts:793` (CTA hoje só `familiar|pet|eidolon`)
- **Entrega**: O talento Animal de Companhia abre, recuado, o sub-slot "Escolher companheiro"; a Dedicação abre um segundo. O picker lista os tipos do pack (BHR-F1-04) com tamanho, golpes, Apoio e **o que ganha "a partir de Maduro" e depois** (D-B14), sem citar nível de classe (D-B22), permite o mesmo tipo duas vezes (D-B15) e, para o antílope, escolher Médio ou Grande. Escolher cria o ator ligado (pela permissão da BHR-F4-04) e o slot preenchido vira o vínculo (clicar abre a ficha); "Trocar tipo" refaz a derivação. A ficha do Bhrotto não ganha aba Pets (D-B04).
- **Depende de**: BHR-F4-04, BHR-F1-04, BHR-F4-02
- **Paralelo com**: BHR-F3-09, BHR-F4-03, BHR-F4-06
- **Modelo / esforço**: sonnet / high — UI nova no Plano, lente T1.
- **Teste (TDD)**: VM: Bhrotto nível 1 tem um sub-slot vazio, nível 2 tem dois; escolher Urso duas vezes cria dois atores; "Trocar tipo" mantém o ator e muda `typeSlug`; o picker expõe `stagePreview` de Maduro e nenhum rótulo cita nível de classe.
- **Prova visual (print)**: Plano com os sub-slots vazios, o picker aberto mostrando os benefícios de Maduro e os slots preenchidos (tela T1).
- **Spec/REQ**: `REQ-PET-112..114`
- **Tamanho**: G
- **Onda**: 7 · **Lote**: L3

### BHR-F4-06 — Ficha própria do companheiro (D-B04)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/npcSheetVM.ts` / `NpcSheet.svelte` (base da ficha) ou nova `CompanionSheet.svelte` no mesmo padrão; `petsVM.ts` (o que já mostra pets)
- **Entrega**: Ficha do companheiro com cabeçalho "pertence a Bhrotto", estágio, PV editáveis (dano) e todo o resto derivado somente leitura com tooltip "como foi calculado" (`breakdown`); golpes clicáveis que rolam no servidor com o alvo mirado e o MAP do companheiro (o card é o mesmo do golpe da BHR-F3-03); perícias roláveis; sentidos e velocidades.
- **Depende de**: BHR-F4-02, BHR-F3-03, BHR-F2-10
- **Paralelo com**: BHR-F3-09, BHR-F4-03, BHR-F4-05
- **Modelo / esforço**: sonnet / high — lente T2.
- **Teste (TDD)**: VM: ficha do urso nível 3 mostra os números da BHR-F4-01, campo derivado não editável, golpe emite rolagem com `AttackCheckContext`; jogador dono do Bhrotto tem posse do companheiro (herdada, `inheritMasterOwnershipOnCreate`).
- **Prova visual (print)**: ficha do urso e do antílope (tela T2), visão do jogador e do Mestre.
- **Spec/REQ**: `REQ-PET-115..116`
- **Tamanho**: G
- **Onda**: 7 · **Lote**: L3

### BHR-F4-07 — Comandar um Animal (D-B10)

- **Repo**: satélite
- **Onde**: `executableRows.ts` (registro `command-an-animal`); ficha do companheiro (BHR-F4-06); card em `abilityCardVM.ts`
- **Entrega**: Na ficha do companheiro, "Comandar" posta o card "Bhrotto comanda o urso: 2 ações" sem teste de Natureza (regra do companheiro); montaria comum segue com teste (fora do Bhrotto). Sem contador de ações (D-15): o card é registro, não orçamento.
- **Depende de**: BHR-F4-06, BHR-F2-08
- **Paralelo com**: BHR-F3-11, BHR-F4-10, BHR-F5-03
- **Modelo / esforço**: sonnet / low.
- **Teste (TDD)**: companheiro animal: card sem rolagem; NPC não companheiro: a linha pede teste de Natureza contra Vontade do alvo.
- **Prova visual (print)**: card "Comandar" no chat (tela T5).
- **Spec/REQ**: `REQ-PET-117`, `REQ-CHT-063`
- **Tamanho**: P
- **Onda**: 8 · **Lote**: L3

### BHR-F4-08 — `effect:apply`: efeito em outro ator com permissão por vínculo (G4, DC-06)

- **Repo**: core
- **Onde**: `packages/shared/src/protocol.ts` (op e schema zod, §2.3); novo `packages/server/src/net/handlers/effect-handlers.ts` (registro em `socket-manager.ts`); `packages/server/src/documents/ownership.ts` (vínculo companheiro↔dono); o `createEmbedded` do `TurnHookContext` **é stub em produção** (rejeita com `TurnHookContextStubError`; só `applyDamage`, `applyCondition`, `chat`, `deleteEmbedded` e, desde a BHR-F0-03, `listActors` são reais — `packages/server/src/combat/turn-hook-runner.ts`), então o handler grava o item embutido pelo mesmo caminho de `deleteEmbedded` (`store.update` + `OpBuffer` + `broadcastToWorld`) ou implementa o `createEmbedded` real nessa tarefa
- **Entrega**: Op `effect:apply` que copia um efeito do pack para os atores-alvo como item embutido com origem, início e `expiry` (DF-06), com a regra de permissão da DC-06 checada no servidor. Usada pelo Apoio (companheiro → dono) e pela Presa compartilhada.
- **Depende de**: BHR-F0-03
- **Paralelo com**: BHR-F3-05, BHR-F3-10, BHR-F4-02
- **Modelo / esforço**: sonnet / high — permissão nova no servidor.
- **Teste (TDD)**: socket: dono do companheiro aplica do urso no Bhrotto (ok); aplica no ator de outro jogador sem `messageId` (`PERMISSION_DENIED`); com `messageId` e efeito sem `allowOnTarget` (negado); Mestre aplica em qualquer ator; o efeito chega com `expiry.ownerActorId` gravado.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-102..105`, `REQ-SYS-163`
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L3

### BHR-F4-09 — Apoio automático do urso (D-B10)

- **Repo**: satélite
- **Onde**: `executableRows.ts` (registro `support`); efeito "Apoio do urso" (BHR-F1-05); resolvedor de dano extra em `systems/pf2e/src/derivations/` (handler `damage-dice` se existir no registro após a DC-01; se não, nota de rolagem clicável pela BHR-F2-05)
- **Entrega**: "Apoio" na ficha do urso aplica no **dono**, via `effect:apply`, o efeito com `expiry { on: "turn-start", ownerActorId: dono }` (BHR-F0-03). Enquanto ativo, golpe do dono que acerta criatura **ao alcance do urso** (`PositionQuery.distanceBetween` ≤ alcance) ganha +1d8 cortante no card de dano (2d8 em Ágil/Selvagem). Sai sozinho no início do próximo turno do dono.
- **Depende de**: BHR-F4-07, BHR-F4-08, BHR-F5-01, BHR-F2-05
- **Paralelo com**: BHR-F4-11, BHR-F6-03, BHR-F7-01
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: golpe que acerta alvo a 5 pés do urso tem +1d8 cortante; alvo a 30 pés do urso, não; erro não soma; no `turnStart` do dono o efeito sai, no `turnStart` do urso não.
- **Prova visual (print)**: card de dano com a parcela do urso e a anotação "Apoio do urso" no canto (telas T3/T5).
- **Spec/REQ**: `REQ-PET-118..119`, `REQ-CHT-064`
- **Tamanho**: M
- **Onda**: 9 · **Lote**: L3

### BHR-F4-10 — Chamar Companheiro: troca do ativo (D-B09, B12, DC-07)

- **Repo**: satélite
- **Onde**: `executableRows.ts` (registro `call-companion`, ação de exploração); `characterSheetVM.ts` (vínculos na ficha do Bhrotto); `system.companion.active`
- **Entrega**: Chamar Companheiro (concedido pela Dedicação) aparece na aba Ações e troca qual companheiro está **ativo**: o ativo é o único que age, apoia e herda a Presa; o inativo continua com ficha legível e sem token em cena (o Mestre coloca o token do novo ativo, ou o servidor o troca no lugar do anterior se ele estiver em cena). Os vínculos na ficha do Bhrotto mostram qual está ativo.
- **Depende de**: BHR-F4-05, BHR-F4-06
- **Paralelo com**: BHR-F3-11, BHR-F4-07, BHR-F5-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: com dois companheiros, `call-companion` inverte `active`; exatamente um ativo sempre; Apoio do inativo desabilitado com o motivo; com um companheiro só, a ação fica desabilitada.
- **Prova visual (print)**: ficha do Bhrotto com os dois vínculos e o ativo marcado.
- **Spec/REQ**: `REQ-PET-120..121`
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L3

### BHR-F4-11 — O companheiro ativo herda a Presa e a Astúcia (DC-08)

- **Repo**: satélite
- **Onde**: `systems/pf2e/src/derivations/familiar.ts` (opções do companheiro); resolvedor de opções de alvo (BHR-F2-02)
- **Entrega**: As opções `target:mark:hunted-prey`/`origin:mark:hunted-prey` também valem para o companheiro **ativo** quando a marca é do dono; os bônus de Caçar Presa e Astúcia aparecem na ficha do companheiro "contra a presa do dono".
- **Depende de**: BHR-F3-06, BHR-F4-02, BHR-F2-02, BHR-F4-10
- **Paralelo com**: BHR-F4-09, BHR-F6-03, BHR-F7-01
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: urso ativo atacando a presa do Bhrotto: Intimidação +2 contra a presa e CA +1 contra ataques dela; companheiro inativo não herda; companheiro de outro dono não herda.
- **Prova visual (print)**: ficha do urso com "contra a presa" (tela T2).
- **Spec/REQ**: `REQ-PET-122`
- **Tamanho**: P
- **Onda**: 9 · **Lote**: L3

### B-F5 — Combate montado

### BHR-F5-01 — Consultas de posição no servidor (recorte da GUE-F3-01)

- **Repo**: core
- **Onde**: novo `packages/server/src/combat/position.ts`; usa `packages/shared/src/grid/` (matemática já testada)
- **Entrega**: Só o recorte que o Bhrotto consome: mapeamento `size → células` (não existe em lugar nenhum do repo), `sizeRank`, `distanceBetween(tokenA, tokenB)` contando de qualquer célula ocupada, `areAdjacent`. Sem flanqueio nem cobertura (ficam com o Guerreiro, `PositionQuery` completa).
- **Depende de**: BHR-F0-01
- **Paralelo com**: BHR-F3-05, BHR-F3-10, BHR-F4-02
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: tiny…gargantuan → 1/1/1/2/3/4 células de lado (tiny ocupa 1 célula para efeito de distância); distância entre token Grande e Pequeno conta da borda; adjacência diagonal vale.
- **Prova visual (print)**: sem UI.
- **Spec/REQ**: `REQ-BHR-171..173` (referencia `REQ-GUE` da GUE-F3-01)
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L3

### BHR-F5-02 — Montar e desmontar: estado montado no servidor (D-B03)

- **Repo**: core + satélite
- **Onde**: core novo `packages/server/src/combat/mount-handler.ts` (`mount:mount`, `mount:dismount`, §2.5) + `protocol.ts`; satélite `executableRows.ts` (registro `mount`)
- **Entrega**: Ação Montar (1 ação, movimento): exige adjacência e montaria pelo menos 1 tamanho maior (BHR-F5-01), montaria voluntária (companheiro ligado ao cavaleiro, ou o Mestre faz); grava `MountState` nos dois tokens. Montado, Montar desmonta para uma casa adjacente vazia. Leshy Pequeno + Antílope Médio = ok; + Urso Pequeno = recusado com o motivo.
- **Depende de**: BHR-F5-01, BHR-F4-02, BHR-F2-08
- **Paralelo com**: BHR-F3-09, BHR-F4-03, BHR-F4-05
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: socket: montar no antílope adjacente (ok), no urso (recusado: tamanho), em token não adjacente (recusado), em companheiro de outro jogador (recusado); desmontar para casa ocupada recusado.
- **Prova visual (print)**: aba Ações com Montar e o token montado (tela T4).
- **Spec/REQ**: `REQ-PET-123`, `REQ-BHR-174..176`
- **Tamanho**: M
- **Onda**: 7 · **Lote**: L3

### BHR-F5-03 — O cavaleiro anda com a montaria (D-B03)

- **Repo**: core
- **Onde**: `packages/server/src/net/handlers/doc-handlers.ts` (`handleEmbeddedUpdate` de Token, `:1963`); `packages/client/src/lib/canvas/tokens/TokenInteractionManager.ts` (arraste do cavaleiro bloqueado); render do token empilhado em `packages/client/src/lib/canvas/tokens/`
- **Entrega**: Mover a montaria move o cavaleiro **no mesmo write** (uma trilha só, a Velocidade terrestre da montaria); mover o cavaleiro montado é recusado para não privilegiado (a única ação de movimento dele é Montar). No canvas, o token do cavaleiro fica empilhado no canto do da montaria; desmontado, cada um volta a se mover separado. A montaria só anda pelo jogador se ele a possuir (Comandar é registro, D-15).
- **Depende de**: BHR-F5-02
- **Paralelo com**: BHR-F3-11, BHR-F4-07, BHR-F4-10
- **Modelo / esforço**: sonnet / high — mexe no update de token e no gestor de interação.
- **Teste (TDD)**: socket: update de posição da montaria gera um broadcast com os dois tokens movidos; update do cavaleiro montado recusado; Mestre pode mover o cavaleiro (e isso desmonta). Client: arraste do cavaleiro montado não inicia.
- **Prova visual (print)**: mapa antes e depois de mover o antílope montado (tela T4, "montado-moveu").
- **Spec/REQ**: `REQ-TOK-116..118`, `REQ-CNV-106..107`
- **Tamanho**: M
- **Onda**: 8 · **Lote**: L3

### BHR-F5-04 — Penalidades e restrições de quem está montado (D-B03)

- **Repo**: satélite
- **Onde**: efeito "Montado" (BHR-F1-05) aplicado/removido por Montar; `characterSheetVM.ts` (selos); ficha do companheiro (montaria carregando cavaleiro)
- **Entrega**: Montado, o cavaleiro tem −2 circunstância em Reflexos (efeito, via seletor da BHR-F2-01) e só Montar como ação de movimento; a montaria companheira carregando cavaleiro usa só Velocidade terrestre e não pode mover e Apoiar no mesmo turno — **salvo** se o tipo tem `mount` (antílope ignora as duas). "Reflexos −2" e "Montado" como itens da faixa compacta da ficha (D-B23); **sem** selo no token (Q-BHR-01).
- **Depende de**: BHR-F5-02, BHR-F2-01, BHR-F1-05, BHR-F2-10
- **Paralelo com**: BHR-F3-11, BHR-F4-07, BHR-F4-10
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: montado: Reflexos do Bhrotto +7 → +5; desmontar volta; montaria sem `mount` com cavaleiro tem Apoio desabilitado depois de mover; antílope não.
- **Prova visual (print)**: ficha do Bhrotto montado com os dois estados na faixa compacta (tela T3, "gigante-montado").
- **Spec/REQ**: `REQ-BHR-177..179`
- **Tamanho**: P
- **Onda**: 8 · **Lote**: L3

### BHR-F5-05 — MAP compartilhado entre cavaleiro e montaria (D-B03)

- **Repo**: core
- **Onde**: `packages/server/src/combat/map-counter.ts` (`mapGroupOf`, BHR-F3-04)
- **Entrega**: Enquanto montados, cavaleiro e montaria compartilham o contador: golpe do Bhrotto e depois golpe do antílope = −5 no do antílope. Desmontar separa os contadores (o já contado no turno fica com cada um).
- **Depende de**: BHR-F5-02, BHR-F3-04
- **Paralelo com**: BHR-F3-11, BHR-F4-07, BHR-F4-10
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: montado, ataque do cavaleiro e depois da montaria → índices 0 e 1; desmontado → 0 e 0; `turnStart` zera o grupo.
- **Prova visual (print)**: botão de golpe do antílope já com −5 depois do golpe do Bhrotto.
- **Spec/REQ**: `REQ-CBT-070..071`, `REQ-BHR-180`
- **Tamanho**: P
- **Onda**: 8 · **Lote**: L3

### BHR-F5-06 — Alcance a partir da montaria e Apoio do antílope (D-B03, D-B10)

- **Repo**: satélite
- **Onde**: checagem de alcance do golpe (`characterSheetVM.ts`/resolvedor de alvo da BHR-F3-03) usando `distanceBetween` a partir de **qualquer** célula da montaria; registro `support` do antílope; efeito "Apoio do antílope" (BHR-F1-05)
- **Entrega**: Montado, o cavaleiro ataca de qualquer célula da montaria (Grande: adjacente a ela ou até 10 pés com alcance). O Apoio do antílope aplica no dono, via `effect:apply`, +1d6 sangramento persistente em golpe que causa dano a criatura ao alcance do antílope — **só enquanto montado** (`requiresMounted`).
- **Depende de**: BHR-F5-03, BHR-F4-09
- **Paralelo com**: BHR-F6-04, BHR-F7-03, BHR-F7-04
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: montado num antílope Grande, alvo a 10 pés da montaria e 15 do token do cavaleiro está ao alcance com o Alcance Prênsil; Apoio do antílope desmontado: golpe não ganha sangramento; montado: ganha.
- **Prova visual (print)**: card de dano com o sangramento do antílope (tela T5).
- **Spec/REQ**: `REQ-PET-124..125`, `REQ-BHR-181..182`
- **Tamanho**: M
- **Onda**: 10 · **Lote**: L3

### BHR-F5-07 — Roteiro `tutorial-e2e` do L3 (companheiros e montaria)

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/bhrotto-l3.spec.ts`; prints em `.fusion-build/bhrotto/L3/`
- **Entrega**: Roteiro: no Plano, o jogador escolhe Urso e Antílope (picker com Maduro visível), abre as duas fichas próprias, sobe o Bhrotto de nível (urso re-derivado pelo servidor), chama o outro companheiro, monta no antílope, move a montaria (cavaleiro junto), vê Reflexos −2, ataca com o MAP compartilhado, Comanda e Apoia (urso e antílope), e o Apoio some no início do próximo turno. Visão do jogador e do Mestre; P3 protótipo × tela (T1, T2, T4, T5).
- **Depende de**: BHR-F4-03, BHR-F4-05, BHR-F4-10, BHR-F4-11, BHR-F5-04, BHR-F5-05, BHR-F5-06
- **Paralelo com**: BHR-F2-09
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: G
- **Onda**: 11 · **Lote**: L3

### B-F6 — Atletismo contra o alvo

### BHR-F6-01 — Perícia rolada contra a CD de outra criatura (importa GUE-F5-05)

- **Repo**: core
- **Onde**: `packages/shared/src/chat/types.ts:389-398` (`SkillCheckContext`, 4º membro de `CheckContextSchema`); `packages/server/src/chat/chat-handler.ts:451-507,1458` (`readActorDefense`)
- **Entrega**: Ficha da GUE-F5-05: `{ kind: "skill", targetTokenId, against, maneuver? }`; CD lida no servidor de `system.derived.saves.<n>.dc`/`perception.dc`; sem alvo resolvível, sem grau. Usada pelas manobras e pelo Rememorar Conhecimento contra a presa.
- **Depende de**: BHR-F3-03
- **Paralelo com**: BHR-F3-05, BHR-F3-10, BHR-F4-02
- **Modelo / esforço**: sonnet / high.
- **Teste (TDD)**: como na GUE-F5-05: CD forjada ignorada; grau contra a CD de Fortitude do alvo; sem alvo, só o total.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-201` (referencia `REQ-GUE` da GUE-F5-05)
- **Tamanho**: M
- **Onda**: 6 · **Lote**: L4

### BHR-F6-02 — Condição no alvo pela ficha (importa ALQ-F1-11)

- **Repo**: satélite
- **Onde**: card de resultado (`abilityCardVM.ts`); consome `actor:applyCondition` (ALQ-F1-09, chega pela DC-01)
- **Entrega**: Ficha da ALQ-F1-11: o card oferece "aplicar agarrado/derrubado/…" no alvo da foto da mensagem; o clique humano aplica (D-G10). Jogador só nos alvos da `targetSnapshot`.
- **Depende de**: BHR-F0-03, ALQ-F1-09
- **Paralelo com**: BHR-F3-09, BHR-F4-03, BHR-F4-05
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: clique aplica a condição no alvo da foto; tentar em outro ator é recusado pelo servidor; Mestre aplica em qualquer.
- **Prova visual (print)**: card com o botão "aplicar derrubado".
- **Spec/REQ**: `REQ-BHR-202`
- **Tamanho**: P
- **Onda**: 7 · **Lote**: L4

### BHR-F6-03 — Agarrar, Empurrar e Derrubar executáveis (recorte da GUE-F5-03, D-B17)

- **Repo**: satélite
- **Onde**: novo `systems/engine-2e/src/maneuvers.ts` (`ManeuverDef` para `grapple`, `shove`, `trip`); `executableRows.ts`; `ActionsTab.svelte`
- **Entrega**: As três manobras na aba Ações (não na tela de combate do protótipo, D-B17): exigem alvo mirado, rolam Atletismo contra a CD certa (Agarrar/Empurrar: Fortitude; Derrubar: Reflexos) no servidor e o card oferece o efeito por grau (`ManeuverOutcome`), aplicado por clique (BHR-F6-02). Penalidade de MAP vale (são ataques). Desarmar e Reposicionar ficam para o Guerreiro.
- **Depende de**: BHR-F6-01, BHR-F6-02, BHR-F2-08
- **Paralelo com**: BHR-F4-09, BHR-F4-11, BHR-F7-01
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: Derrubar contra alvo com Reflexos CD 18: total 20 = sucesso → oferece derrubado; falha crítica → oferece o próprio derrubado; sem alvo, desabilitado; contam no MAP.
- **Prova visual (print)**: aba Ações com as três manobras e o card de Derrubar.
- **Spec/REQ**: `REQ-BHR-203..205`
- **Tamanho**: M
- **Onda**: 9 · **Lote**: L4

### BHR-F6-04 — Limite de tamanho e Lutador de Titãs (D-B11, G6)

- **Repo**: satélite
- **Onde**: `systems/engine-2e/src/maneuvers.ts` (`ManeuverSizeLimit`, §2.7); handler `fusion-maneuver-size-limit` no `RuleElementRegistry`; curadoria da regra em `feats-core` Titan Wrestler (`bAe9kGn1hxSejFKe`, hoje `rules: []`)
- **Entrega**: Agarrar, Empurrar e Derrubar checam o tamanho do alvo: até 1 acima; com Lutador de Titãs, até 2 (3 com Atletismo lendário). Alvo grande demais deixa a linha desabilitada com o motivo ("alvo Enorme: até Grande").
- **Depende de**: BHR-F6-03, BHR-F5-01
- **Paralelo com**: BHR-F5-06, BHR-F7-03, BHR-F7-04
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: Bhrotto Pequeno sem o talento: alvo Médio ok, Grande recusado; com Lutador de Titãs: Grande ok, Enorme recusado; teste de escopo da ALQ-F4-03 do handler novo.
- **Prova visual (print)**: Derrubar desabilitado contra o gigante sem o talento e habilitado com ele.
- **Spec/REQ**: `REQ-BHR-206..208`, `REQ-SYS-164`
- **Tamanho**: P
- **Onda**: 10 · **Lote**: L4

### B-F7 — Runas, carteira e exceções do Mestre

### BHR-F7-01 — Editor de runas na arma (D-B06, D-B19, D-B20, D-B21, DC-11)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/components/sheets/pf2e/CharacterSheet.svelte` (linha da arma no inventário, padrão do botão "Equipado"); `characterSheetVM.ts`; `systems/pf2e/src/schemas/item-weapon.ts:91` (`WeaponRunesSchema`, já existe); leitura já correta em `strikesStep.ts:89` e `actions/strikes.ts:221`
- **Entrega**: Botão "Runas" em **qualquer** arma abre o editor: campo "Potência (bônus de ataque)" (+0..+3), campo "Runa de ataque (dados de dano)" (nenhuma / de ataque / maior / suprema — o rótulo do campo diz o que se escolhe e o valor mostra o efeito, ex. "2 dados"), e "Runas de propriedade" com tantas vagas quanto a potência (texto livre; lista de runas fora). Preview com ataque e dados já derivados. **Sem aviso nem bloqueio** (D-B20). Escreve `system.runes` pelo `doc:update` do dono.
- **Depende de**: BHR-F0-01
- **Paralelo com**: BHR-F4-09, BHR-F4-11, BHR-F6-03
- **Modelo / esforço**: sonnet / medium — lente T6.
- **Teste (TDD)**: VM: escolher "Runa de ataque" no Mangual de Guerra muda o preview para `2d10+4`; potência +1 abre uma vaga de propriedade e sobe o ataque para +10; qualquer combinação é aceita (sem validação); arma de outro dono não abre o editor.
- **Prova visual (print)**: editor aberto sobre o Mangual de Guerra e a linha atualizada (tela T6).
- **Spec/REQ**: `REQ-BHR-221..225`, `REQ-PF2-283`
- **Tamanho**: M
- **Onda**: 9 · **Lote**: L4

### BHR-F7-02 — Campos só do Mestre no servidor: carteira e exceções do Plano (D-B12, D-B13, DC-10)

- **Repo**: core
- **Onde**: `packages/server/src/net/handlers/doc-handlers.ts:372` (`rejectUnwritableField`, no padrão da atitude `flags.fusion.attitude`)
- **Entrega**: Jogador não escreve `system.build.gmExceptions` em ator nenhum; o Mestre escreve. **A carteira não muda de dono** (DC-10 respondida: o jogador continua editando a própria carteira; sem chave `walletGmOnly`). Validação de moeda existente (`validateActorCurrencyForSystem`) continua valendo.
- **Depende de**: BHR-F0-01
- **Paralelo com**: BHR-F4-09, BHR-F4-11, BHR-F6-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: socket: jogador altera `system.currency` do próprio ator → ok (regressão protegida); jogador escreve `system.build.gmExceptions` → negado; Mestre → ok; diff que não toca esses campos segue igual.
- **Prova visual (print)**: sem UI própria.
- **Spec/REQ**: `REQ-BHR-226..229`
- **Tamanho**: P
- **Onda**: 9 · **Lote**: L4

### BHR-F7-03 — Carteira: ajuste do Mestre na ficha (D-B13)

- **Repo**: satélite
- **Onde**: `characterSheetVM.ts:1273-1296` (`readWallet`, `setWalletAmountOp`); `CharacterSheet.svelte` (bloco da carteira)
- **Entrega**: O jogador continua editando a própria carteira (DC-10); o Mestre ganha "Ajustar carteira" na ficha de qualquer personagem, com entrada por moeda e total em po. Sem regra automática de riqueza por nível.
- **Depende de**: BHR-F7-02
- **Paralelo com**: BHR-F5-06, BHR-F6-04, BHR-F7-04
- **Modelo / esforço**: sonnet / low.
- **Teste (TDD)**: VM: jogador mantém o controle de edição; Mestre ajusta 15 po → 2 po na ficha de outro ator e o op sai com o valor; total em po correto.
- **Prova visual (print)**: carteira vista pelo jogador e pelo Mestre (tela T6, "carteira").
- **Spec/REQ**: `REQ-BHR-230`
- **Tamanho**: P
- **Onda**: 10 · **Lote**: L4

### BHR-F7-04 — Floração Nobre: Acesso e exceção do Mestre no Plano (D-B12, B11)

- **Repo**: satélite
- **Onde**: `sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:5355-5372` (`ancestryFeatEffectiveLevel`, `generalSlotTakesAncestry`) e o predicado de elegibilidade (`isFeatEligible`); leitura do Acesso no texto/dado de `feats-core` Noble Bloom
- **Entrega**: O Plano passa a reconhecer **Acesso** (Floração Nobre pede a herança crisântemo): sem o Acesso o talento fica inelegível com o motivo. O Mestre pode marcar o talento como **liberado** para aquele ator (`system.build.gmExceptions`, BHR-F7-02); liberado, entra no `generalFeat-3` (com as regras 3 e 4 da casa) e o slot mostra o selo "liberado pelo Mestre" (tela T1).
- **Depende de**: BHR-F7-02
- **Paralelo com**: BHR-F5-06, BHR-F6-04, BHR-F7-03
- **Modelo / esforço**: sonnet / medium.
- **Teste (TDD)**: Leshy Raiz: Floração Nobre inelegível ("Acesso: herança crisântemo"); com a exceção gravada, elegível no `generalFeat-3`; Leshy Crisântemo elegível sem exceção; jogador não consegue gravar a exceção (servidor).
- **Prova visual (print)**: Plano com Floração Nobre bloqueada e depois liberada (tela T1, "liberado").
- **Spec/REQ**: `REQ-BHR-231..233`
- **Tamanho**: M
- **Onda**: 10 · **Lote**: L4

### BHR-F7-05 — Roteiro `tutorial-e2e` do L4 (Atletismo, runas e Mestre)

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/bhrotto-l4.spec.ts`; prints em `.fusion-build/bhrotto/L4/`
- **Entrega**: Roteiro: Derrubar contra um alvo Grande com e sem Lutador de Titãs, card oferece e aplica derrubado; editor de runas no Mangual de Guerra; Mestre ajusta a carteira para 2 po e o jogador continua editando a própria carteira (DC-10; a carteira não é só leitura); Floração Nobre bloqueada e liberada pelo Mestre. Visão do jogador e do Mestre; P3 protótipo × tela (T1, T6).
- **Depende de**: BHR-F6-04, BHR-F7-01, BHR-F7-03, BHR-F7-04, BHR-F2-09
- **Paralelo com**: —
- **Modelo / esforço**: sonnet / medium — exige olhar print.
- **Teste (TDD)**: o próprio roteiro; prints abertos com Read antes de declarar pronto.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: M
- **Onda**: 12 · **Lote**: L4

### BHR-F7-06 — Bhrotto de ponta a ponta e fechamento da frente

- **Repo**: core
- **Onde**: `.claude/skills/tutorial-e2e/roteiros/bhrotto-ponta-a-ponta.spec.ts`; `.fusion-build/bhrotto/final/`; `docs/design/bhrotto/` (estado e lições)
- **Entrega**: Um encontro inteiro com o Bhrotto nível 3 no mundo de teste (cópia de `a_queda`): criação dos companheiros pelo Plano, Caçar Presa com Caçador de Monstros, golpe montado com Alcance Prênsil e runa, MAP compartilhado, Apoio do urso e do antílope, Derrubar, fim de turno expirando o Apoio; comparação com o PDF do Flávio (CA 19, Fort +9, Ref +7 / +5 montado, Von +9, ataque +9, 2d10+4, PV 46 + o talento geral pendente). Smoke como Mestre e como jogador. Lista o que ficou pendente do jogador (idiomas, talento geral, Ocultismo/Religião, Wildborne).
- **Depende de**: BHR-F1-09, BHR-F3-11, BHR-F5-07, BHR-F7-05
- **Paralelo com**: —
- **Modelo / esforço**: sonnet / high — o gate de "100% jogável".
- **Teste (TDD)**: o próprio roteiro + a suíte completa dos dois repos verde no pin final.
- **Prova visual (print)**: é a tarefa de print.
- **Spec/REQ**: —
- **Tamanho**: G
- **Onda**: 13 · **Lote**: L4

## 5. Ondas

Gate de saída de cada onda: suíte dos pacotes tocados + typecheck, lint e `format:check` + `pnpm spec:report` quando entra teste novo (e `spec-lint` quando há spec); tarefa do satélite só fecha a onda depois do pin no core com a suíte verde.

| Onda | Tarefas                                                          | Repo     | Espera algo de fora                                             |
| ---- | ---------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| 1    | BHR-F0-01, BHR-F0-02, BHR-F1-01, BHR-F1-02, BHR-F1-03, BHR-F1-06 | ambos    | —                                                               |
| 2    | BHR-F0-03, BHR-F1-04, BHR-F1-05, BHR-F1-07, BHR-F2-01, BHR-F2-03 | ambos    | `ALQ-F1-04`, `ALQ-F2-02`, `ALQ-F2-08`, `ALQ-F2-09`, `ALQ-F4-19` |
| 3    | BHR-F2-02, BHR-F2-05, BHR-F2-07, BHR-F2-08, BHR-F3-01, BHR-F3-04 | ambos    | `ALQ-F1-04`, `ALQ-F1-05`, `ALQ-F2-11`, `ALQ-F4-02`              |
| 4    | BHR-F1-08, BHR-F2-04, BHR-F2-06, BHR-F3-02, BHR-F3-06, BHR-F4-04 | ambos    | `ALQ-F0-07`                                                     |
| 5    | BHR-F1-09, BHR-F2-10, BHR-F3-03, BHR-F3-07, BHR-F3-08, BHR-F4-01 | ambos    | —                                                               |
| 6    | BHR-F3-05, BHR-F3-10, BHR-F4-02, BHR-F4-08, BHR-F5-01, BHR-F6-01 | ambos    | —                                                               |
| 7    | BHR-F3-09, BHR-F4-03, BHR-F4-05, BHR-F4-06, BHR-F5-02, BHR-F6-02 | ambos    | `ALQ-F1-09`                                                     |
| 8    | BHR-F3-11, BHR-F4-07, BHR-F4-10, BHR-F5-03, BHR-F5-04, BHR-F5-05 | ambos    | —                                                               |
| 9    | BHR-F4-09, BHR-F4-11, BHR-F6-03, BHR-F7-01, BHR-F7-02            | ambos    | —                                                               |
| 10   | BHR-F5-06, BHR-F6-04, BHR-F7-03, BHR-F7-04                       | satélite | —                                                               |
| 11   | BHR-F2-09, BHR-F5-07                                             | ambos    | —                                                               |
| 12   | BHR-F7-05                                                        | core     | —                                                               |
| 13   | BHR-F7-06                                                        | core     | —                                                               |

Fechamento por lote: L1 na onda 5 · L2 na onda 11 · L3 na onda 11 · L4 na onda 13.

Observação: o gate BHR-F2-09 é da fase F2 mas depende de Atletismo (F6) e Medicina Natural; por isso o L2 só fecha na onda do gate, depois do roteiro BHR-F3-11. A BHR-F1-07 entra na onda 2 só se o Flávio tiver passado os campos; senão fica de fora sem bloquear nada (nenhuma ficha depende dela).

## 6. Lotes de print

Regras comuns: servidor isolado em mundo existente (cópia de `a_queda`) com data-dir no scratchpad, fora da worktree;
primeiro passo confere a branch com `git merge-base --is-ancestor`; um print por tarefa com UI, visão do Mestre e do
jogador; prints em `.fusion-build/bhrotto/<lote>/`; relatório P3 em `.fusion-build/bhrotto/<lote>/relatorio.html`, com
**protótipo × tela** contra `docs/design/bhrotto/prototipo-bhrotto-fiel.html` (telas T1–T6; prints de referência em
`docs/design/bhrotto/prints-fiel/`).

| Lote | Fases      | Roteiros             | O que o lote prova                                                                                                       |
| ---- | ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| L1   | B-F0, B-F1 | BHR-F1-09            | a base do Alquimista em alfa sem regressão e a ficha com o dado certo: PV 46, Natureza, Mangual de Guerra, pt-BR         |
| L2   | B-F2, B-F3 | BHR-F3-11            | **o Bhrotto caça**: mira, Presa no token, Caçador de Monstros, grau e MAP no servidor, Alcance Prênsil, "contra a presa" |
| L3   | B-F4, B-F5 | BHR-F5-07            | os dois companheiros criados pelo Plano, derivados e com ficha própria; Comandar/Apoio; montaria completa                |
| L4   | B-F6, B-F7 | BHR-F7-05, BHR-F7-06 | Atletismo com limite de tamanho, runas, carteira e exceção do Mestre; o encontro inteiro de ponta a ponta                |

O L2 e o L3 são os que mudam a mesa. Se a frente precisar parar, o ponto natural é depois do L3: o que falta (manobras,
editor de runas, carteira) tem rota manual hoje (runa à mão pelo Mestre, carteira já editável).

## 7. Riscos

| Risco                                             | Efeito                                                                                                                                                                   | Mitigação                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Merge da base do Alquimista (DC-01)**           | 213 commits de divergência, pin de satélite diferente, arquivos disputados (`chat-handler.ts`, `TokenInteractionManager.ts`, `CharacterSheet.svelte`); tudo depende dele | BHR-F0-02 é a primeira tarefa e é opus/high; gate = suíte completa + testes-oráculo das tarefas ALQ + replay do Bhrotto antes × depois; BHR-F0-03 confere contratos e corrige as fichas antes de qualquer código novo. Se o merge travar, cai para a opção (B) da DC-01. |
| Precedência sobre o Guerreiro (DC-02)             | o Bhrotto fixa `AttackCheckContext`, `TargetGesture`, `MapCounter`, `SkillCheckContext`, `PositionQuery`; o Guerreiro herda o recorte                                    | importar as fichas GUE **sem alterar o contrato** (só recortar escopo); cada ficha cita a GUE de origem; o plano do Guerreiro recebe nota "já entregue pelo Bhrotto" nas fichas afetadas quando esta frente fechar.                                                      |
| `chat-handler.ts` e `doc-handlers.ts` são gargalo | conflito entre faixas da mesma onda                                                                                                                                      | regra de faixas (§3): mesmo arquivo = mesma faixa, em série, commit por tarefa; a marca, o `effect:apply` e o montado entram por **módulos novos** (`mark-handler.ts`, `effect-handlers.ts`, `mount-handler.ts`), não pelo corpo dos handlers existentes.                |
| Permissões novas no servidor                      | marca, efeito em outro ator e movimento do cavaleiro abrem três superfícies de anti-cheat                                                                                | cada uma com teste de socket negativo (jogador sem posse, alvo fora da foto, token oculto); redação só por `net/redaction.ts` + `isRolePrivileged`.                                                                                                                      |
| Token montado no canvas                           | o update de dois tokens num write e o arraste bloqueado mexem em código de interação sensível                                                                            | o servidor é a verdade (o cliente só reflete o broadcast); o Mestre sempre pode mover e isso desmonta; o roteiro do L3 fotografa antes/depois.                                                                                                                           |
| Teste circular (lição #48)                        | verde com regra errada                                                                                                                                                   | asserções com os números do livro e do PDF escritos no teste (tabela (d) de `dados/companheiros.md`, conta do L-ficha); gate BHR-F2-09 dirigido por dado.                                                                                                                |
| Dados que dependem do jogador                     | Wildborne (B2), talento geral, idiomas e Ocultismo/Religião seguem em aberto                                                                                             | BHR-F1-07 bloqueada explicitamente; nada é preenchido por inferência; o fechamento (BHR-F7-06) lista o que falta do jogador.                                                                                                                                             |
| Mudança de comportamento para todos os jogadores  | Natureza do Patrulheiro (DC-09) afeta outros personagens da mesa                                                                                                         | a correção do Patrulheiro devolve a escolha livre em vez de apagar treino.                                                                                                                                                                                               |

## 8. Fora do escopo / futuro

| Item                                                                                                                           | Motivo                                                                | Onde retomar                            |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------- |
| Preparação diária e frequência imposta (Caçar Presa, Caçador de Monstros 1×/dia, Floração Nobre 1×/dia)                        | D-05 (sem relógio de mundo) e DC-04; exige ALQ-F3-02/F3-05            | quando a F3 do Alquimista chegar a alfa |
| Desarmar e Reposicionar (Lutador de Titãs cobre 5 manobras)                                                                    | D-B11 cita três; as outras duas são do plano do Guerreiro (GUE-F5-03) | GUE-F5-03                               |
| Flanqueio, cobertura, `PositionQuery` completa                                                                                 | recorte só de tamanho/distância/adjacência                            | GUE-F3-01..03                           |
| Lista de runas de propriedade                                                                                                  | `dados/itens.md`: fora de escopo; o editor aceita texto livre         | issue própria                           |
| Estágios Incrível/Especializado com especialização (nível 8+) e Manobra Avançada executável (Abraço de Urso, Recuo Saltitante) | o Bhrotto é nível 3; o picker já mostra o texto (D-B14)               | quando o personagem chegar ao 6/8       |
| Queda da montaria (Reflexos CD 20, arremessado)                                                                                | regra do GM Core sem dano de queda confirmado (`dados/montaria.md`)   | issue própria                           |
| Montaria não companheira (teste de Comandar, Cavalgar)                                                                         | o Bhrotto só monta companheiro                                        | issue própria                           |
| Contador das três ações do turno                                                                                               | D-15 do Alquimista, mantida                                           | spec 49 (`REQ-ACO`)                     |
| Riqueza automática por nível                                                                                                   | D-B13                                                                 | —                                       |

## 9. Como este plano se mantém

- **Ondas e paralelismo são derivados** das dependências: os scripts `ondas.cjs` e `build-resumo.cjs` de
  `docs/design/guerreiro/tools/`, com o prefixo trocado para `BHR` e o mapa de lotes por fase (F0–F1 → L1, F2–F3 → L2,
  F4–F5 → L3, F6–F7 → L4), recalculam a onda de cada ficha (teto 6), reescrevem as linhas "Onda · Lote" e "Paralelo com",
  regeneram a §5 e o `tasks-resumo.json` validando id único, dependência existente, onda que cresce e teto por onda.
  Mudou uma dependência (ou a resposta de uma DC), roda de novo. Os scripts adaptados entram em
  `docs/design/bhrotto/tools/` no commit do plano.
- **O estado de execução** (`estado.json`) é escrito pelo `record.mjs` da skill de frentes, nunca à mão.
- **Dependências externas** (`ALQ-*` no campo "Depende de") são as tarefas FA que chegam pela BHR-F0-02; servem de
  rastreio. Se a DC-01 for (B), elas viram as tarefas de transplante BHR-F0-02a..f.
