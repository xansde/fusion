# Bhrotto Raiz-funda 100% jogável — decisões (2026-10-05)

Frente para tornar jogável o Bhrotto Raiz-funda (campanha A Queda, jogador Flávio): Ranger 3 Leshy
(Root Leshy), Wildborne, Outwit, dois companheiros jovens (urso e antílope-montaria) via Animal Companion +
Beastmaster Dedication. Base: `alfa/app` 2cd67095 + satélite `v0.3.20`. Levantamento:
`.fusion-build/bhrotto/L-ficha.md` (achados B1–B14).

## Decisões do Alexandre

| ID    | Tema                               | Decidido                                                                                                                                                                                                                                                          |
| ----- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-B01 | Números do companheiro             | **Derivados por tipo + estágio.** Pack homebrew de tipos de companheiro (urso e antílope agora, extensível) e um passo de derivação que calcula PV, CA, saves, perícias e golpes a partir do nível do dono e do estágio (jovem, maduro, incrível, ágil/selvagem). |
| D-B02 | Recálculo                          | **No servidor.** Mudou o dono, o servidor re-deriva os companheiros ligados a ele (fecha a Q-PET-02).                                                                                                                                                             |
| D-B03 | Montaria                           | **Combate Montado completo**: estado montado, token do cavaleiro anda com o da montaria, regras de Combate Montado (penalidades, ações da montaria, Apoio montado).                                                                                               |
| D-B04 | Tela dos companheiros              | **Ficha própria só.** Cada companheiro é um ator com ficha própria (cabeçalho "pertence a …"); a ficha do Bhrotto só tem os vínculos. Sem aba Pets para ele.                                                                                                      |
| D-B05 | Presa (Caçar Presa)                | **Marca real no token.** Usar Caçar Presa com um alvo marca aquele token; os bônus de Astúcia e do Caçador de Monstros só valem contra ele. Exige alvo persistente e a ficha saber o alvo da rolagem.                                                             |
| D-B06 | Runas                              | **Editor de runas na arma** (potência, striking, propriedade), genérico para qualquer arma.                                                                                                                                                                       |
| D-B07 | Wildborne                          | **Curado da fonte ORC** (Howl of the Wild), sem texto nem arte da Paizo, conferido pelo Alexandre.                                                                                                                                                                |
| D-B08 | Dependências de outras frentes     | **Trazer para este plano** as peças planejadas no Guerreiro (alvo, contexto de ataque) e no Alquimista (expiração de efeito, ganchos de turno, rule elements) de que o Bhrotto precisa, seguindo os contratos já desenhados lá.                                   |
| D-B09 | Criação dos companheiros           | **Pelo Plano.** O talento Animal Companion abre um sub-slot "escolher companheiro" (tipo) que cria o ator ligado; a Beastmaster Dedication abre um segundo. O jogador faz sozinho.                                                                                |
| D-B10 | Comandar e Apoio                   | **Automático.** Na ficha do companheiro, Comandar posta o card; Apoio aplica no dono o efeito do benefício (urso: +1d8 cortante contra o alvo; antílope: sangramento persistente montado), que expira sozinho no início do próximo turno do dono.                 |
| D-B11 | Limite de tamanho (Titan Wrestler) | **Checado com alvo.** Agarrar, Empurrar e Derrubar contra um alvo checam o tamanho (até 1 acima; Titan Wrestler, até 2).                                                                                                                                          |
| D-B12 | Noble Bloom                        | **Pode, como exceção do Mestre.** O Plano marca o talento como liberado pelo Mestre (o Acesso pede a herança crisântemo).                                                                                                                                         |
| D-B13 | Riqueza do nível 3                 | **O Mestre ajusta a carteira.** Sem regra automática de riqueza por nível.                                                                                                                                                                                        |

## Pendências do jogador (não preencher)

Idiomas · general feat do nível 1 (o PDF sugere Toughness, PV 49) · Ocultismo ou Religião da regra da casa ·
qual companheiro vem de cada talento.

## Revisão do protótipo fiel (Alexandre, 2026-10-05)

| ID    | Tema                              | Decidido                                                                                                                                                                                                                                                                                                                                           |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-B14 | Escolha do tipo de companheiro    | O seletor de tipo mostra também a ação/habilidade que o companheiro ganha ao virar **Maduro** (e os avanços seguintes), mesmo sem cumprir o requisito ainda — serve para planejar o personagem.                                                                                                                                                    |
| D-B15 | Tipo repetido                     | Pode escolher o **mesmo tipo mais de uma vez** (ex.: dois ursos).                                                                                                                                                                                                                                                                                  |
| D-B16 | Estados de combate citam a arma   | O texto de um estado nunca pode ficar preso ao nome de uma arma antiga. Se acompanhar a arma equipada for complexo, **não citar a arma**: descrever o efeito genérico (ex.: "reduz em um o passo do dado da arma").                                                                                                                                |
| D-B17 | Manobras de Atletismo             | **Fora da tela de combate do protótipo** (já existem na aba Ações) — evita overengineering. A checagem de tamanho (D-B11) continua valendo na ação.                                                                                                                                                                                                |
| D-B18 | Texto "contra a presa"            | Generalizar: **"Contra a presa"**, nunca o nome do alvo ("Contra o ogro").                                                                                                                                                                                                                                                                         |
| D-B19 | Editor de runas                   | A lógica de edição foi aprovada. Ajustes: o rótulo "dados" ficou confuso; "Golpeadora" não agradou como tradução de _striking_ (tradução em aberto); o nível da runa (Golpeadora/Maior/…) não pode ficar só dentro do selecionável — o nome do campo tem de dizer o que se escolhe. Regra detalhada das runas a explicar antes de decidir o resto. |
| D-B20 | Validação de runas                | **Sem aviso nem bloqueio**: o editor de runas é livre (o Mestre confia nos jogadores).                                                                                                                                                                                                                                                             |
| D-B21 | Tradução de _striking_            | **"Runa de ataque"** (e as versões maior/suprema). O campo mostra o efeito em dados de dano.                                                                                                                                                                                                                                                       |
| D-B22 | Avanços do companheiro no seletor | Mostrar "a partir de Maduro" **sem** citar nível de classe: Maduro vem de um talento opcional (Mature Animal Companion), não de um nível automático.                                                                                                                                                                                               |
| D-B23 | Faixa "Estados de combate"        | Aprovada, mas compacta: cada estado mostra **só o nome**; clicar no nome mostra o efeito. Evita a faixa crescer demais com o tempo.                                                                                                                                                                                                                |

## Respostas às decisões do plano (Alexandre, 2026-10-05)

DC-01 antecipar o merge da `feat/alquimista` (ondas 1–5) em `alfa/app` · DC-08 o companheiro **ativo** herda
Caçar Presa e Astúcia · **DC-10: o jogador continua editando a própria carteira** (o Mestre só ganha "Ajustar
carteira"; refina a D-B13) · DC-02..07, DC-09, DC-11, DC-12 como recomendado em `tasks.md` §1.

## Escolhas do jogador (Alexandre, 2026-10-05)

General feat extra do nível 1: **Toughness** · regra da casa: **Ocultismo** · **urso** vem do Animal Companion
(classe), **antílope** da Beastmaster Dedication (arquétipo) · Wildborne é de um livro **Lost Omens** (DC-12
desbloqueada: curar da fonte). Pendente: idiomas.

## Decisões durante a execução (Alexandre, 2026-10-05)

- **Q-BHR-01**: os estados "Montado" e "Reflexos −2" ficam só na faixa compacta da ficha; o token não ganha selo
  (DEC-TOK-19 mantida).
- **Seletor de talentos**: requisito reconhecido não cumprido → candidato **marcado com aviso** (o motivo) e
  selecionável (REQ-PF2-208 emendada; DEC-BC-05/REQ-BC-032). Entrou na BHR-F0-02 (PRs core #313 e satélite #472).
- **Decisão provisória do orquestrador, a confirmar (2026-10-06)** — **Comandar um Animal** (Natureza) continua na
  aba Ações para animais que **não são o companheiro** (ação básica do livro: Natureza contra a Vontade do animal);
  para o companheiro é automático (D-B10).
- **Regra da Presa (2026-10-06, regra do PF2e remaster)**: a Presa de Caçar Presa dura **até o Patrulheiro usar
  Caçar Presa de novo**; **não** expira na preparação diária. Os efeitos Presa e Astúcia ficam sem fronteira de
  expiração própria (`never`); a saída é a nova Caçar Presa, que substitui o efeito.
- **Faixa × lista de interruptores (2026-10-06, orquestrador, derivada da D-B23; revisão da onda 5, I-5)**: a faixa "Estados de combate" **substitui** o texto por extenso. `CombatStates` e `RollOptionToggles` ficam só como controle de ligar/desligar (nome, interruptor, ligado/desligado e o motivo de um bloqueio), sem o efeito, o limite nem a dica por extenso. A faixa é o único lugar que mostra o efeito, ao clicar no nome, e traz junto o limite e a dica que a lista mostrava. Cada estado aparece uma vez como estado. Nome e descrição de efeitos e condições vêm do snapshot pt-BR (`flags.fusion.i18n["pt-BR"]`), com o inglês só como reserva.
- **D-B04, emenda (2026-10-07)**: o companheiro abre também pela aba Contatos e a ficha do PJ mostra um resumo na aba Pets (pedido do Alexandre).

### Decisões do Alexandre (2026-10-06)

- **RAW é o default**: na falta de decisão explícita, vale a regra do livro (PF2e remaster).
- **Forçar MAP (BHR-F3-05)**: confirmado. O ataque forçado **conta** para o MAP (todo ataque conta, pela regra); o
  seletor só escolhe qual penalidade aplicar àquele golpe. Deixa de ser provisório.
- **Comandar um Animal fora do companheiro**: a decisão provisória acima (Natureza contra a Vontade do animal, na aba
  Ações) fica confirmada pelo default RAW.
- **Q (dono × penalidade)**: mantém o comportamento atual. O dono pode remover qualquer efeito do próprio ator,
  inclusive penalidade aplicada pelo Mestre ou por inimigo; o Mestre também pode.
- **P-1 (BHR-F4-04)**: confirmado. O companheiro criado pelo **Mestre** conta no teto do jogador (se o Mestre criar
  o urso, o Bhrotto só cria mais um).
- **I-5 (revisão da onda 7)**: mantém o comportamento atual. O botão "Aplicar condição" aplica em quem está mirado
  na hora do clique. Usar o alvo da rolagem, como pede a regra, fica como ajuste futuro: ver
  [ajustes-futuros.md](ajustes-futuros.md). O contrato REQ-SYS-142 do Alquimista não muda nesta frente.
- **Alcance de golpe (pergunta 1 da onda 10)**: o Fusion **não faz nada** com o alcance do ataque: nem bloqueia nem avisa golpe fora de alcance. Não se constrói checagem de alcance de golpe.
- **Anti-cheat do Apoio (pergunta 2 da onda 10, M-10)**: não fazer; o Alexandre confia nos jogadores (D-B20). O gate do Apoio continua lido da cópia do efeito no ator.
- **Nome do monstro nos cards (pergunta da onda 11, D7 do L3)**: o jogador só vê o nome da criatura (ex.: "Ogro") se o
  Mestre a marcar como **conhecida** em "Quem conhece quem" (contatos, spec 39); senão vê "criatura desconhecida". O
  comportamento atual está certo. O mecanismo já existe e já está ligado aos cards: o servidor só entrega o nome de um
  ator conhecido (`redactActorDocsForViewer`; o "avistado" vai sem nome) e o card resolve o nome pelo espelho do
  jogador (`resolveTargetName`). Visto no roteiro L4: depois de o Mestre revelar o Ogro, o card do jogador diz "Ogro".
  O jogador recebe de um monstro Conhecido **sem ownership** só nome, título, retrato e tamanho (DEC-CTT-04,
  REQ-CTT-074), nunca a ficha (revisão da onda 13, B1); com ownership LIMITED ou mais o corpo segue como antes.
- **Apoio do urso no crítico (revisão da onda 13, RAW)**: o texto diz que a criatura sofre 1d8 de dano cortante "do
  urso", dano separado do Golpe. No acerto crítico o golpe dobra e o 1d8 do urso **não** dobra (`doubleOnCrit: false`,
  como era o contrato original da spec 52). Reverte o D6 da onda 13.
- **CI do satélite**: fica desligado, por custo. O gate do satélite é o local (integrador e corretor) mais o CI do core.

## Perguntas abertas

Detalhes e contexto em [ajustes-futuros.md](ajustes-futuros.md#perguntas-de-produto-para-o-alexandre).

Nenhuma.

### Resolvidas

- **P-2 (BHR-F4-04/F4-10)**: um só companheiro ativo; o novo nasce inativo, quem decide é o servidor, trocar é ação do
  dono (revisão da onda 4).
- **P-3 (BHR-F1-08)**: CD padrão de Tratar Ferimentos é 15 (revisão da onda 4).
- **Alcance de golpe (onda 10)**: o Fusion não bloqueia nem avisa (Decisões do Alexandre, 2026-10-06).
- **Anti-cheat do Apoio, M-10 (onda 10)**: não fazer, confia nos jogadores (Decisões do Alexandre, 2026-10-06).
- **Nome do monstro nos cards, D7 (onda 11)**: só criatura Conhecida mostra o nome (Decisões do Alexandre, 2026-10-06).
- **Aplicar condição, I-5 (onda 7)**: mantém a mira no clique; alvo da rolagem virou ajuste futuro (Decisões do
  Alexandre, 2026-10-06).
- **Forçar MAP, Comandar Animal, dono × penalidade, P-1**: confirmados (Decisões do Alexandre, 2026-10-06).
- **Condições do monstro Conhecido**: o jogador VÊ as condições (caído, sangrando) de monstro Conhecido — entra na
  allow-list do recorte do jogador com emenda na spec 39 (Alexandre, 2026-10-07). Feito.
- **Regra nova do pack em personagem já criado**: FAZER migração do snapshot de talento (Alexandre, 2026-10-07).
  Feito.
- **Tipo de dano**: "cortante" em todo o app (glossário passa a usar "cortante"; vale para os demais tipos no mesmo
  padrão adjetivo) (Alexandre, 2026-10-07). Feito.
- **MAP de cavaleiro e montaria**: compartilhado, como manda a regra de Combate Montado ("você e a montaria lutam
  como uma unidade; vocês compartilham a penalidade de ataques múltiplos") — confirmado pelo RAW (2026-10-07).
