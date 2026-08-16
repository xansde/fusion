# 45 — Atores

- **Título:** Atores — quem são os sujeitos do mundo, e como a engine pergunta isso
- **Status:** draft v0.1 (2026-08-16)
- **Nível:** Área (ver DEC-ATR-01)
- **Baseada em:**
  - `02-modelo-de-dados.md` — a **forma** do `Actor`: Document primário, `items`/`effects` embedded, `subtype`, `ownership`, e a herança token→actor por delta (REQ-DOC-018/020/023/027..029, REQ-DOC-031..035, DEC-DOC-08).
  - `15-api-de-sistemas.md` — o contrato pelo qual um sistema declara subtypes (REQ-SYS-010..015). É esta API que ganha a declaração de natureza.
  - `42-aba-npcs.md` — a spec que definiu "não-jogável" primeiro, cunhou "presença na cena" para não usar "token", e deixou registradas as pontas que só esta spec pode fechar (Q-NPC-04, Q-NPC-05).
  - `39-contatos.md` — "contato", "conhecido", "sub-personagem", e a decisão de que conhecimento é do par contato × personagem (DEC-CTT-03).
  - `40-aba-combate.md` — "criatura" como a palavra da regra de visibilidade de vida (DEC-CBA-03) e a constatação de que Token não tem dona (DEC-CBA-06).
  - `29-pets-companions-familiars.md` — `masterActorId`, o vínculo entre atores (REQ-PET-002).
  - `17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md` — os subtypes reais que os três sistemas declaram hoje.

> **Spec de área.** Esta spec é dona do **conceito de ator**: o que é, quais naturezas
> existem, como nasce, como morre, como é identificado, de quem é, e qual a sua relação
> com a presença numa cena. Ela **não** redefine a forma de Document (`02`), a superfície
> da system API (`15`), a ficha (`11` e as specs de sistema), nem o que é uma presença na
> cena (`41`, reservada). Onde essas specs já decidiram, esta cita.

---

## 1. Objetivo

Dar ao Fusion uma resposta única e portável para a pergunta que três specs já precisaram
fazer e nenhuma pôde responder: **"este ator é um personagem de jogador, uma criatura, um
perigo ou uma coisa?"** — e, a partir dela, fixar o ciclo de vida, a identidade e a posse
de um ator, que hoje existem repartidos entre `02`, `05`, `29`, `39`, `40` e `42`.

## 2. Escopo

### 2.1 Inclui

- A **definição** de ator e a fronteira entre o que é e o que não é ator.
- O **catálogo de naturezas** (`player`, `creature`, `hazard`, `container`) e a forma como
  o sistema de jogo as declara.
- O **vocabulário único** que substitui os sinônimos que cada aba cunhou.
- O **ciclo de vida**: qual porta cria cada natureza, e o que acontece ao excluir.
- A **identidade** de um ator e o tratamento de homônimos.
- O **ownership** com que cada natureza nasce.
- A relação **ator-base × presença na cena**: o que é molde e o que é estado vivo.
- O **vínculo entre atores** (sub-personagem) e o que acontece quando ele se rompe.

### 2.2 Não inclui

- A forma de `Document`, `EmbeddedCollection`, o campo `ownership` e o CRUD →
  `02-modelo-de-dados.md`.
- A avaliação de permissão por operação e a UI gating → `05-usuarios-e-permissoes.md`.
- O conteúdo do `system` de cada subtype (o que um `npc` do PF2e tem dentro) →
  `17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md`.
- A **ficha** de qualquer natureza → `11-ui-framework-e-fichas.md`, as specs de sistema e
  a futura spec de ficha de não-jogável (DEC-NPC-13).
- O que é uma **presença na cena**, seus dados, seu movimento e seu desenho → spec `41`
  (Token), reservada. Esta spec diz o que a presença herda; não diz o que ela é.
- As **telas**: quem lista, com que busca, em que pasta → `39-contatos.md`,
  `42-aba-npcs.md`, `43-aba-compendio.md`.
- O **modelo de conhecimento** (quem conhece quem) → `39-contatos.md`
  (REQ-CTT-060..076).
- A política de redação de payload por papel → `21-seguranca.md` (REQ-SEC-020).

## 3. Conceitos e terminologia

| Conceito             | Definição                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Ator**             | Document `Actor`: o sujeito do mundo que tem ficha própria, pode ter presença numa cena e é alvo das regras do sistema.            |
| **Natureza**         | O papel do ator na mesa, declarado pelo sistema por subtype: `player`, `creature`, `hazard` ou `container`. Vocabulário da engine. |
| **Personagem**       | Ator de natureza `player`. É o ator que pertence a um jogador.                                                                     |
| **Criatura**         | Ator de natureza `creature`. Age, tem vida e pode entrar em combate; não pertence a um jogador.                                    |
| **Perigo**           | Ator de natureza `hazard`. Armadilha ou ameaça sem intenção própria.                                                               |
| **Recipiente**       | Ator de natureza `container`. Guarda itens e não age. O baú (DEC-NPC-08) é um recipiente.                                          |
| **Não-jogável**      | Termo de conveniência: qualquer ator que não seja personagem. **Derivado**, nunca declarado — ver DEC-ATR-05.                      |
| **Sub-personagem**   | Ator vinculado a um personagem por `masterActorId` (REQ-PET-002): familiar, companheiro, montaria.                                 |
| **Ator-base**        | O `Actor` do mundo, tal como persistido. Quando há presença desvinculada, ele é **molde**, não valor vivo (DEC-ATR-11).            |
| **Presença na cena** | A manifestação de um ator numa cena. O termo é o da spec `42` e o conceito é da spec `41`; aqui só se diz o que ele herda do ator. |
| **Identidade**       | `flags.fusion.sourceId` — o que diz que dois documentos são o mesmo ator. Nunca o nome (DEC-ATR-09).                               |

## 4. Decisões

### DEC-ATR-01 — Ator é área, e por isso esta spec é de nível Área apesar do número

O `CONVENCOES.md` §3 mapeia nível por faixa: `01`–`26` são áreas, `28`+ são recortes.
Esta spec tem número 45 e **não é recorte**: ela não atravessa áreas combinando decisões
existentes — ela é dona de decisões novas que ninguém tomou.

- **Racional:** a faixa reflete a ordem em que as specs nasceram, e o próprio `CONVENCOES.md`
  §3 diz isso ("a numeração reflete a ordem em que as specs nasceram, não a estrutura").
  Tratar Ator como recorte a proibiria de definir qualquer coisa — recorte cita, não define
  — e é justamente a falta de definição que a trouxe à existência.
- **O que isso obriga:** emenda em `CONVENCOES.md` §3, para que a faixa deixe de ser o
  critério de nível e passe a ser sinal — ver §12.
- **O teste de corte foi aplicado** (`CONVENCOES.md` §1): decidir o que é um ator me obriga
  a decidir a natureza, a fronteira, a porta de criação e a posse — as quatro se restringem
  mutuamente. Não obriga a decidir o que é um Document, porque a `02` já decidiu.

### DEC-ATR-02 — Ator é sujeito, não registro: tem ficha, pode ter presença, é alvo de regra

Um ator é o que a mesa trata como **sujeito**: tem ficha própria, pode aparecer numa cena e
as regras do sistema se aplicam a ele. Não é ator o que existe **dentro** de um ator (item,
efeito), o que descreve o mundo sem ser sujeito dele (nota, desenho, cena, journal), nem o
que é dado do jogo e não do mundo (tabela, macro).

- **Por que a `02` não bastava:** ela define a **forma** — Document primário com `items` e
  `effects` embedded (REQ-DOC-018, REQ-DOC-020), `subtype` (REQ-DOC-023), `ownership`
  (REQ-DOC-027). Forma responde "como se guarda", não "o que é". A prova é que a `02` nunca
  precisou enumerar os subtypes de `Actor`, e de fato não os enumera: ela delega ao sistema
  (REQ-SYS-015) e segue em frente. A engine, até aqui, **não tem opinião sobre o que um ator
  é** — e três specs de aba tiveram que ter uma por conta própria.
- **A fronteira não é estética, é operacional:** ser ator implica ter as quatro coisas desta
  spec — natureza, porta de criação, identidade e ownership. Uma coisa que não precisa das
  quatro não deve ser ator; uma que precisa das quatro e não é, vira caso especial em toda
  tela que a encontra.

### DEC-ATR-03 — Natureza é declarada pelo sistema, e é o vocabulário portável da engine

Todo `SystemDataModel` de `documentType: "Actor"` DEVE declarar uma `nature`, com exatamente
quatro valores possíveis: `player`, `creature`, `hazard`, `container`. A engine, o cliente e
as abas passam a perguntar pela natureza — nunca pelo nome do subtype.

O mapeamento dos sistemas de hoje:

| Sistema | Subtype       | Natureza    |
| ------- | ------------- | ----------- |
| pf2e    | `character`   | `player`    |
| pf2e    | `npc`         | `creature`  |
| pf2e    | `hazard`      | `hazard`    |
| pf2e    | `loot`        | `container` |
| pf2e    | `familiar`    | `creature`  |
| sf2e    | `character`   | `player`    |
| sf2e    | `npc`         | `creature`  |
| etmos   | `orador`      | `player`    |
| etmos   | `antagonista` | `creature`  |

- **O fato que motiva a decisão:** hoje ninguém sabe responder. O cliente decide com string
  literal de PF2e — `t === "character" || t === "npc"` em `spellCastCardVM.ts`,
  `subtype === "npc" || subtype === "hazard"` em `compendiumBrowser.ts`, e uma tabela
  `{ pf2e: "character", sf2e: "character", etmos: "orador" }` codificada dentro de
  `ActorDirectory.svelte`. No Etmos os subtypes são `orador`/`antagonista`: o hardcode
  simplesmente não se aplica, e o que acontece hoje é que a pergunta é respondida errado
  em silêncio.
- **Quem depende disso, hoje, sem ter de quem depender:** a `39` precisa saber quem é
  personagem para montar "na mesa"; a `40` precisa saber quem é criatura para esconder a
  vida (DEC-CBA-03); a `42` precisa saber quem é não-jogável para listar (DEC-NPC-05). Três
  specs escritas, três definições paralelas, zero contratos.
- **Rejeitado: derivar de `ownership`** ("é personagem quem tem um não-GM como OWNER"). Um
  NPC entregue a um jogador viraria personagem, e um personagem sem dono atribuído sumiria
  da categoria. Posse é uma pergunta legítima e é outra — ver DEC-ATR-10.
- **Rejeitado: um campo de engine no próprio `Actor`.** Seria dado duplicado do subtype,
  livre para divergir dele, e alguém teria que preenchê-lo nos 492 registros do bestiário
  já importado.
- **Sobre o nome `player`:** ele descreve o ator que **pertence a um jogador**, não o
  usuário. `User` continua sendo o usuário (`05`), e nada nesta spec o toca.

### DEC-ATR-04 — Natureza descreve papel na mesa, nunca mecânica

A natureza serve para a engine e a interface perguntarem "quem é isto na mesa". Ela **NÃO
DEVE** ser consultada para decidir dano, iniciativa, condição, alcance, visibilidade de
regra ou qualquer resultado de jogo — isso é do sistema, pela API que já existe (`15`).

- **Racional:** natureza é um enum de quatro valores fixado pela engine. No instante em que
  uma regra de jogo passar a depender dela, ela vira uma segunda API de sistemas — com um
  vocabulário pobre, sem versionamento e sem contract test. O PF2e tem criaturas que não
  agem e perigos que agem; deixar a mecânica ler natureza é ensinar a engine a errar.
- **A fronteira prática:** a engine pode dizer "não mostre a vida deste ator ao jogador"
  (DEC-CBA-03) porque isso é regra de **mesa**. Não pode dizer "este ator não rola
  iniciativa" — isso é regra de **jogo**, e é `REQ-SYS-042` quem responde.

### DEC-ATR-05 — Um vocabulário só; "não-jogável" passa a ser derivado

A partir daqui existem quatro palavras — **personagem**, **criatura**, **perigo**,
**recipiente** — e elas são exatamente as quatro naturezas. **Não-jogável** continua
existindo como termo de conveniência, mas passa a ser **definido por derivação**: qualquer
ator cuja natureza não seja `player`.

- **O que isso corrige:** a mesma fatia do mundo estava batizada três vezes, cada vez numa
  spec de painel — "não-jogável" (`42` §3), "criatura" (`40` §3), "conhecido" (`39` §3) —
  e as três definições não coincidem. A da `42` é `npc` **ou** `hazard`, e portanto exclui
  o familiar de um jogador; a da `40` é "participante que não é personagem de jogador", e
  portanto o inclui. Nenhuma das duas estava errada na sua spec; elas não podiam estar certas
  juntas.
- **O que cada spec mantém:** "contato" e "conhecido" (`39`) continuam sendo o que sempre
  foram — recortes de **exibição**, definidos sobre a natureza, não ao lado dela. Nenhuma
  aba precisa mudar de nome.
- **Consequência de redação:** "não-jogável" só pode ser usado onde a derivação é a intenção
  real. Onde a intenção era `creature` — como na regra de vida da DEC-CBA-03 — a palavra
  passa a ser **criatura**, e ela agora tem definição.

### DEC-ATR-06 — Cada natureza tem exatamente uma porta de criação

| Natureza    | Porta                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| `player`    | Nasce junto com o usuário, na administração de usuários (`37`, DEC-NPC-02). |
| `creature`  | Aba NPCs: do bestiário ou do zero (`42`, DEC-NPC-06).                       |
| `hazard`    | Aba NPCs, mesma janela (`42`, DEC-NPC-05).                                  |
| `container` | Posto direto na cena ativa, pelo rodapé da aba NPCs (`42`, DEC-NPC-08).     |

- **Racional:** porta única é o que impede que a mesma coisa nasça de dois jeitos com dois
  conjuntos de defaults. A `42` já tinha chegado a essa conclusão para três das quatro
  naturezas; esta spec generaliza e nomeia a regra.
- **Importar não é uma quinta porta.** Trazer um ator de um pack (REQ-CMP-016, REQ-CMP-021)
  é a mesma criação com os campos pré-preenchidos, e a natureza vem do subtype importado
  como em qualquer outra criação.
- **O que continua sem porta, e é aceito:** **excluir personagem** não tem tela nenhuma
  (Q-NPC-06). Esta spec define a regra de exclusão (DEC-ATR-12) para quando a tela existir;
  não a cria.

### DEC-ATR-07 — Recipiente é ator, e é isso que dá ao baú conteúdo, dono e presença

O baú é um ator de natureza `container`. Ele tem `items` como qualquer ator, tem `ownership`
como qualquer ator, e tem presença na cena como qualquer ator — e **nenhuma aba de autoria
o lista**, exatamente como a DEC-NPC-08 exigiu.

- **Isto não contraria a DEC-NPC-08, e o ponto é esse:** o que ela recusou foi o baú **no
  diretório** — "entraria na árvore de pastas, pediria pasta, atitude e conhecimento". Tudo
  isso continua valendo: recipiente não tem pasta, não tem atitude e não entra na janela de
  conhecimento. Ausência de aba não é ausência de registro.
- **Fecha Q-NPC-04:** o subtype `loot` do PF2e ganha consumidor — ele é a natureza
  `container`, e não fica declarado sem uso.
- **Fecha Q-NPC-05:** o conteúdo do baú vive onde o conteúdo de qualquer ator vive, na
  coleção `items` (REQ-DOC-020). Quando o baú está numa cena com presença desvinculada, o
  conteúdo vivo é o da presença, pela mesma regra de todo mundo (DEC-ATR-11) — nenhuma
  mecânica nova.
- **Rejeitado: recipiente como coisa da cena, fora de ator.** Criaria uma segunda família de
  coisas que ocupam a cena e guardam itens, com a sua própria posse, o seu próprio inventário
  e a sua própria presença — três subsistemas duplicados para economizar um subtype.

### DEC-ATR-08 — Veículo não existe, e o plano deixa de dizer que existe

Não há natureza para veículo, e não haverá subtype de veículo enquanto ninguém o pedir. O
mesmo vale para `party`.

- **O que estava contraditório:** a `17` lista `vehicle` como Actor type [V2] (REQ-PF2-115)
  e a `27` o coloca no marco M6; a `42` (DEC-NPC-05) declarou "veículo não existe no Fusion.
  Não é subtipo cortado: nunca foi declarado por sistema nenhum". As duas não podiam estar
  certas, e nenhuma emendou a outra.
- **A resolução:** esta spec é a dona do catálogo, e o catálogo não tem veículo. `17` e `27`
  são emendadas — ver §12.
- **`party` cai pelo mesmo motivo, com um argumento a mais:** o agrupamento de personagens
  já existe e não é ator — é o painel de Comitiva do Hub (`28`, REQ-HUB-044). Um ator `party`
  seria uma segunda resposta para uma pergunta já respondida.
- **Isto não é uma linha vermelha.** Se um dia uma mesa precisar de veículo, ele volta pela
  porta da frente: um sistema declara o subtype e esta spec ganha a natureza correspondente
  ou a decisão de que ele é `container`. O que está proibido é ele continuar no plano sem
  ninguém tê-lo pedido.

### DEC-ATR-09 — Identidade é `flags.fusion.sourceId`; nome é rótulo

Dois documentos são o mesmo ator quando têm o mesmo `flags.fusion.sourceId`. O nome **NÃO
DEVE** ser usado como identidade em lugar nenhum — nem para deduplicar importação, nem para
casar ator com presença, nem para reconhecer um ator já trazido de um pack.

- **Racional:** homônimo é o padrão do conteúdo de PF2e, não a exceção — o bestiário
  importado tem nomes repetidos entre packs e dentro do mesmo pack. Casar por nome já é a
  técnica que a `31` recusou explicitamente para a base canônica ("casamento por nome é"
  rejeitado, §5).
- **Ator criado do zero também tem identidade:** ele recebe um `sourceId` próprio na
  criação, não `null`. Sem isso, "veio de um pack" e "nasceu aqui" seriam distinguíveis
  apenas por ausência, e toda consulta precisaria tratar o caso nulo.
- **O que esta spec não faz:** ela não define `flags.fusion.sourceId` para todo Document —
  isso continua sem dona, e vira Q-ATR-05. Ela fixa a regra **para ator**.

### DEC-ATR-10 — Ownership nasce por natureza, e personagem nasce com dono

| Natureza    | `ownership` na criação                                                             |
| ----------- | ---------------------------------------------------------------------------------- |
| `player`    | `{ default: none, <userId>: owner }` — o usuário com quem ele nasceu (DEC-NPC-02). |
| `creature`  | `{ default: none }` — só papel privilegiado.                                       |
| `hazard`    | `{ default: none }`.                                                               |
| `container` | `{ default: none }` — abrir um baú é concessão do Mestre, não default do mundo.    |

- **Relação com a `02`:** REQ-DOC-029 já fixa a regra geral de criação. Esta decisão não a
  contraria: ela diz **qual é o `<userId>`** no caso de personagem, que é a única natureza
  em que o dono não é o criador. Quem cria o personagem é o Mestre, na administração de
  usuários; quem o possui é o jogador.
- **Sobre recipiente:** `default: none` significa que um baú posto na cena é invisível ao
  jogador até que o Mestre decida o contrário. Isso é deliberado — o baú é ferramenta de
  narração (DEC-NPC-08), e narração tem tempo.
- **Isto não é a matriz de permissões.** O que cada nível permite fazer continua sendo da
  `05`; aqui só se diz com que mapa o ator nasce.

### DEC-ATR-11 — O ator-base é molde quando a presença é desvinculada

Quando a presença numa cena é desvinculada do ator (`actorLink: false`, REQ-DOC-033), os
valores vivos — vida, condições, inventário — são os da **presença**, e os do ator-base são
**molde**. Nenhuma tela deve exibir o valor do ator-base como se descrevesse alguém.

- **Racional:** é o argumento da DEC-NPC-10, generalizado. Cinco goblins na cena têm cada
  um a sua vida; "a vida do goblin" não descreve nenhum dos cinco.
- **Consequência para toda tela:** uma lista de atores (`42`), uma lista de contatos (`39`)
  ou um resultado de busca (`43`) exibe **identidade e natureza**, nunca estado vivo. Estado
  vivo aparece onde há presença ou ficha: a aba Combate para o Mestre (`40`, DEC-CBA-03) e a
  ficha.
- **O ator efetivo já está definido, e esta spec não o redefine:** REQ-DOC-032/033/034 e
  REQ-CNV-090/091 dizem como reconstruí-lo e por qual rota mutá-lo. O que faltava era a
  regra de **leitura**: quando o base é molde, não se lê o base.

### DEC-ATR-12 — Excluir mostra o que cai junto, e é recusado com combate ativo

Excluir um ator DEVE mostrar antes o que a exclusão leva junto, e DEVE ser recusado enquanto
o ator participar de um combate ativo.

- **Generaliza a DEC-NPC-12**, que valia só para não-jogável na aba NPCs. A regra é do ator,
  não da aba: qualquer porta que venha a excluir um ator responde por ela.
- **O que cai junto, e precisa ser mostrado:** presenças nas cenas, sub-personagens
  pendurados nele por `masterActorId`, o conhecimento registrado sobre ele (`39`), e a
  participação em combates encerrados.
- **Soft reference não é integridade:** a `02` já decidiu que referências entre documents são
  fracas e que o consumidor trata `null` (Conceitos, `02`). Mostrar o que cai junto é o que
  transforma uma referência quebrada em uma decisão informada, e é por isso que o aviso é
  requisito e não cortesia.
- **Combate ativo é recusa, não aviso:** remover um participante do meio da fila é um estado
  que o `10` não modela, e um encontro corrompido custa mais que uma exclusão adiada.

### DEC-ATR-13 — Sub-personagem é vínculo entre atores, e o dono é sempre um personagem

Um ator pode apontar para outro por `masterActorId` (REQ-PET-002). O alvo desse vínculo
**DEVE** ser um ator de natureza `player`.

- **Racional:** o vínculo existe para que o sub-personagem derive do dono (REQ-PET-003) e
  seja exibido dentro dele (DEC-CTT-06). Ambos pressupõem um personagem: é o nível dele que
  o familiar lê, e é o cartão dele que encapsula o companheiro.
- **Natureza do sub-personagem:** é `creature`, não uma quinta natureza. Um familiar age,
  tem vida e entra em combate; o que o distingue é o vínculo, não o papel.
- **Órfão é estado visível, não erro silencioso:** REQ-PET-002 já exige que a ficha sinalize
  o companion sem mestre válido. Esta spec acrescenta o outro lado: excluir o dono é uma
  exclusão que **leva junto** (DEC-ATR-12) e tem que dizer isso antes.

## 5. Requisitos funcionais

### Definição e natureza

- **REQ-ATR-001** [MVP] A engine DEVE tratar como **ator** todo Document `Actor`, e
  DEVE recusar a criação de um `Actor` cujo subtype não tenha um `SystemDataModel`
  registrado (REQ-SYS-011).
- **REQ-ATR-002** [MVP] Todo ator DEVE ter exatamente uma **natureza**, com valor em
  `{ player, creature, hazard, container }`.
- **REQ-ATR-003** [MVP] A natureza de um ator DEVE ser derivada do seu subtype pela
  declaração do sistema (REQ-ATR-010), e NÃO DEVE ser um campo gravado no próprio ator.
- **REQ-ATR-004** [MVP] A engine DEVE expor uma função pura `natureOf(actor): Nature` que
  resolve a natureza a partir do `type` do ator e do registro do sistema ativo, e DEVE ser
  a **única** rota pela qual engine, servidor e cliente respondem essa pergunta.
- **REQ-ATR-005** [MVP] Nenhum código de engine, servidor ou cliente DEVE comparar o
  subtype de um ator contra um literal de sistema (`"character"`, `"npc"`, `"orador"`) para
  decidir comportamento de mesa; toda decisão desse tipo DEVE consultar `natureOf`.
- **REQ-ATR-006** [MVP] A engine NÃO DEVE consultar a natureza para decidir resultado de
  jogo (dano, iniciativa, condição, alcance, aplicabilidade de regra), conforme DEC-ATR-04.
- **REQ-ATR-007** [MVP] O termo **não-jogável** DEVE ser derivado (`natureOf(actor) !==
"player"`) e NÃO DEVE existir como valor declarado, campo ou filtro independente.

### Declaração pelo sistema

- **REQ-ATR-010** [MVP] O `SystemDataModelSpec` (REQ-SYS-010) DEVE ganhar o campo `nature`,
  **obrigatório** quando `documentType === "Actor"` e **proibido** nos demais documentTypes.
- **REQ-ATR-011** [MVP] O contract test da system API DEVE falhar quando um sistema
  registrar um model de `Actor` sem `nature`, com `nature` fora do enum, ou declarar
  `nature` em um documentType que não seja `Actor`.
- **REQ-ATR-012** [MVP] Um sistema PODE declarar mais de um subtype com a mesma natureza
  (PF2e declara `npc` e `familiar`, ambos `creature`), e NÃO DEVE ser obrigado a cobrir as
  quatro naturezas (Etmos declara apenas `player` e `creature`).
- **REQ-ATR-013** [MVP] Quando o sistema ativo não declara nenhum subtype de uma natureza,
  a interface NÃO DEVE oferecer a porta de criação correspondente (DEC-ATR-06) — em vez de
  oferecer um gesto que falharia na validação do servidor.
- **REQ-ATR-014** [MVP] A engine DEVE expor a lista de subtypes de `Actor` do sistema ativo
  agrupados por natureza, para que as telas de criação e de filtro sejam construídas a
  partir dela e não de uma tabela codificada no cliente.

### Ciclo de vida — criação

- **REQ-ATR-020** [MVP] Criar um usuário DEVE criar, no mesmo gesto, um ator de natureza
  `player` associado a ele (DEC-NPC-02, emendando REQ-USR-025 e REQ-CFG-051).
- **REQ-ATR-021** [MVP] A criação de ator de natureza `creature` e `hazard` DEVE acontecer
  pela aba NPCs (`42`), pelas duas portas que a DEC-NPC-06 fixa.
- **REQ-ATR-022** [MVP] A criação de ator de natureza `container` DEVE acontecer pelo gesto
  que o põe direto numa cena (DEC-NPC-08), e o ator resultante NÃO DEVE aparecer em
  diretório, busca de autoria ou contagem de nenhuma aba.
- **REQ-ATR-023** [MVP] Importar um ator de um pack (REQ-CMP-016, REQ-CMP-021) DEVE produzir
  um ator com a mesma disciplina de qualquer criação: natureza pelo subtype, identidade por
  `sourceId` e ownership por natureza.
- **REQ-ATR-024** [MVP] O servidor DEVE recusar a criação de um ator de natureza `player`
  que não venha acompanhada do usuário a quem ele pertence (REQ-ATR-050).
- **REQ-ATR-025** [V2] Um jogador PODE ter mais de um personagem; o gesto de criar o segundo
  é [V2] (REQ-NPC-055a) e, quando existir, DEVE usar a mesma porta da administração de
  usuários.

### Ciclo de vida — exclusão

- **REQ-ATR-030** [MVP] Antes de excluir um ator, a interface DEVE apresentar o que a
  exclusão leva junto: presenças nas cenas, sub-personagens vinculados, conhecimento
  registrado e participações em combates encerrados.
- **REQ-ATR-031** [MVP] O servidor DEVE **recusar** a exclusão de um ator que participe de
  um combate ativo, com erro identificável pelo cliente, e a interface DEVE explicar o
  motivo em vez de apenas falhar.
- **REQ-ATR-032** [MVP] Excluir um ator DEVE remover as presenças dele em todas as cenas.
- **REQ-ATR-033** [MVP] Excluir um ator que seja dono de sub-personagens NÃO DEVE excluir os
  sub-personagens; eles ficam órfãos e a ficha sinaliza isso (REQ-PET-002).
- **REQ-ATR-034** [MVP] Excluir um ator NÃO DEVE apagar nem reescrever mensagens de chat que
  o citem; a referência fica pendente e o consumidor trata a ausência.
- **REQ-ATR-035** [V2] Excluir um ator de natureza `player` DEVE ter uma porta na interface;
  hoje não tem nenhuma, e isso é aceito (Q-NPC-06).

### Identidade

- **REQ-ATR-040** [MVP] Todo ator DEVE carregar `flags.fusion.sourceId`, preenchido na
  criação — pela origem, quando importado de um pack; por um identificador próprio, quando
  criado do zero.
- **REQ-ATR-041** [MVP] Nenhuma operação de engine, servidor ou cliente DEVE usar o **nome**
  de um ator como identidade: nem para deduplicar importação, nem para casar ator com
  presença, nem para reconhecer um ator já trazido de um pack.
- **REQ-ATR-042** [MVP] Dois atores com o mesmo `sourceId` no mesmo mundo DEVEM ser tratados
  como duas cópias do mesmo ator de origem, e a interface DEVE poder distingui-los sem
  depender do nome.
- **REQ-ATR-043** [MVP] Renomear um ator NÃO DEVE alterar o `sourceId` nem quebrar qualquer
  vínculo (presença, sub-personagem, conhecimento, participação em combate).

### Posse

- **REQ-ATR-050** [MVP] Um ator de natureza `player` DEVE nascer com
  `ownership.default = none` e `ownership.<userId> = owner`, onde `<userId>` é o usuário com
  quem ele foi criado — não o criador do documento (complementa REQ-DOC-029).
- **REQ-ATR-051** [MVP] Atores de natureza `creature`, `hazard` e `container` DEVEM nascer
  com `ownership.default = none`.
- **REQ-ATR-052** [MVP] A natureza de um ator NÃO DEVE ser consultada para autorizar
  operação alguma; autorização é `ownership` (REQ-DOC-028, REQ-DOC-030) e papel (`05`).
- **REQ-ATR-053** [MVP] Conceder ownership de um ator de natureza `creature` a um jogador
  NÃO DEVE mudar a natureza dele: um NPC controlado por um jogador continua sendo criatura,
  e continua sujeito às regras de exibição de criatura (DEC-CBA-03).

### Ator e presença

- **REQ-ATR-060** [MVP] Uma presença na cena DEVE herdar a natureza do ator que ela
  manifesta; presença NÃO DEVE ter natureza própria.
- **REQ-ATR-061** [MVP] Quando a presença é desvinculada (REQ-DOC-033), nenhuma tela DEVE
  exibir valores vivos do ator-base (vida, condições, inventário) como se descrevessem a
  presença.
- **REQ-ATR-062** [MVP] Listas de atores (diretório, contatos, resultado de busca) DEVEM
  exibir identidade e natureza, e NÃO DEVEM exibir estado vivo.
- **REQ-ATR-063** [MVP] Um ator PODE existir sem nenhuma presença em cena, e isso NÃO DEVE
  ser tratado como estado incompleto ou erro.

### Vínculo entre atores

- **REQ-ATR-070** [MVP] O alvo de `masterActorId` (REQ-PET-002) DEVE ser um ator de natureza
  `player`; o servidor DEVE recusar um vínculo que aponte para outra natureza.
- **REQ-ATR-071** [MVP] Um sub-personagem DEVE ter natureza `creature`.
- **REQ-ATR-072** [MVP] O vínculo DEVE ser uma soft reference: um `masterActorId` que aponta
  para um ator inexistente NÃO DEVE quebrar a leitura do sub-personagem, e DEVE ser
  sinalizado (REQ-PET-002).

## 6. Requisitos não-funcionais

- **RNF-ATR-01** `natureOf` DEVE ser pura, síncrona e livre de I/O: ela é consultada em
  laço de render de lista e em predicado de redação por payload.
- **RNF-ATR-02** Acrescentar uma natureza ao enum DEVE exigir mudança nesta spec e no
  contract test da system API — nunca apenas em um sistema.
- **RNF-ATR-03** A resolução de natureza NÃO DEVE depender do pacote de nenhum sistema estar
  carregado no cliente: o cliente resolve pelo registro que a engine já lhe entrega
  (`REQ-ARQ-005`, fronteira de pacotes).

## 7. Modelo de dados e API

A única mudança de contrato é em `SystemDataModelSpec` (`15`, REQ-SYS-010):

```ts
type Nature = "player" | "creature" | "hazard" | "container";

interface SystemDataModelSpec<S extends ZodType = ZodType> {
  documentType: DocumentType; // "Actor" | "Item" | ...
  subtype: string; // "character" | "npc" | "orador" | ...
  schema: S; // valida APENAS o campo `system`
  migrations?: MigrationMap;
  defaults?: Partial<z.infer<S>>;
  /** Obrigatório quando documentType === "Actor"; proibido nos demais. */
  nature?: Nature;
}
```

E a função que a engine passa a expor:

```ts
/** REQ-ATR-004 — a única rota para "quem é este ator na mesa". */
function natureOf(actor: { type: string }): Nature;

/** REQ-ATR-014 — subtypes do sistema ativo, agrupados por natureza. */
function actorSubtypesByNature(): Record<Nature, readonly string[]>;
```

Nenhum campo novo é gravado no `Actor`: a natureza é resolvida, nunca persistida
(REQ-ATR-003). Isso mantém a `02` intocada no que diz respeito à forma do documento.

## 8. Dependências

| Spec | O que esta spec depende / não pode contrariar                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| `02` | Forma do `Actor`, `ownership`, herança token→actor por delta. Esta spec lê e cita; não redefine nenhum campo. |
| `05` | Papéis e matriz de permissões. Natureza nunca autoriza nada (REQ-ATR-052).                                    |
| `15` | Contrato de declaração de subtypes. Esta spec **acrescenta** um campo (§12) e nada mais.                      |
| `16` | Importação de pack: a natureza vem do subtype importado, sem segundo caminho.                                 |
| `29` | `masterActorId` e derivação do mestre. Esta spec restringe o alvo do vínculo (REQ-ATR-070).                   |
| `39` | "Contato"/"conhecido" continuam sendo recortes de exibição, agora definidos sobre a natureza.                 |
| `40` | "Criatura" da DEC-CBA-03 passa a ser a natureza `creature`, com definição.                                    |
| `41` | Reservada. Esta spec diz o que a presença **herda** do ator; o que a presença **é** continua sendo dela.      |
| `42` | Portas de criação, baú, atitude. Esta spec generaliza as decisões dela e fecha Q-NPC-04 e Q-NPC-05.           |
| `43` | Trazer ator do acervo é criação com campos pré-preenchidos, não uma porta paralela.                           |

## 9. Critérios de aceitação

- **CA-ATR-001** Um mundo de Etmos lista os `orador` na seção "na mesa" da aba Contatos e os
  `antagonista` na aba NPCs, sem nenhuma string de PF2e envolvida.
- **CA-ATR-002** Um sistema que registre um model de `Actor` sem `nature` falha o contract
  test com mensagem que aponta o subtype.
- **CA-ATR-003** Criar um usuário produz, na mesma operação, um ator de natureza `player`
  com esse usuário como `owner` e `default: none`.
- **CA-ATR-004** Um baú posto na cena não aparece na aba NPCs, não aparece na busca de
  autoria, não entra em contagem de aba nenhuma — e abrir a presença dele mostra os itens
  que ele carrega.
- **CA-ATR-005** Excluir um goblin que está em três cenas e é dono de nenhum sub-personagem
  mostra as três presenças antes de confirmar, e removê-lo limpa as três.
- **CA-ATR-006** Excluir um ator que está numa fila de combate ativo é recusado pelo
  servidor, e a interface explica que há combate em andamento.
- **CA-ATR-007** Dois goblins importados do mesmo pack com o mesmo nome são distinguíveis na
  interface e não se deduplicam entre si.
- **CA-ATR-008** Renomear "Goblin" para "Grubber" não quebra a presença dele na cena, o
  vínculo do familiar, nem o conhecimento registrado sobre ele.
- **CA-ATR-009** Cinco presenças desvinculadas do mesmo goblin, com vidas diferentes, não
  fazem nenhuma lista de atores exibir vida.
- **CA-ATR-010** Dar OWNER de um NPC a um jogador não faz a vida dele aparecer para os
  outros jogadores.
- **CA-ATR-011** Um `masterActorId` apontando para uma criatura é recusado pelo servidor.
- **CA-ATR-012** Uma busca por `"character"` no código de engine, servidor e cliente não
  encontra nenhuma comparação de subtype que decida comportamento de mesa.

## 10. Questões em aberto

- **Q-ATR-01** O `familiar` do PF2e tem natureza `creature` e vínculo com um personagem.
  Ele deve aparecer na aba NPCs (é criatura) ou apenas encapsulado no dono (é
  sub-personagem, DEC-CTT-06)? _Posição atual: apenas encapsulado; a aba NPCs lista o que
  ela cria, e ela não cria familiar._
- **Q-ATR-02** Um recipiente pode existir fora de uma cena (um baú "de estoque", sem
  presença)? _Posição atual: pode, por REQ-ATR-063, mas nenhuma tela o alcançaria — o que
  torna a resposta acadêmica até a spec `41` existir._
- **Q-ATR-03** A recusa de exclusão com combate ativo (REQ-ATR-031) vale também para combate
  **encerrado mas ainda arquivado**? _Posição atual: não; encerrado é histórico, e histórico
  tolera referência pendente (REQ-ATR-034)._
- **Q-ATR-04** Quem gera o `sourceId` de um ator criado do zero — o cliente que pede ou o
  servidor que persiste? _Posição atual: o servidor, pela mesma razão de toda autoridade
  ser dele; falta confirmar contra o caminho de criação otimista._
- **Q-ATR-05** `flags.fusion.sourceId` é usado por `31` e `34` e não é definido por spec
  nenhuma. Esta spec fixa a regra para ator; a definição geral (formato, unicidade, quem
  preenche) segue sem dona. _Candidata natural: `16`._
- **Q-ATR-06** Um ator de natureza `player` sem nenhum usuário como owner (porque o usuário
  foi removido) continua sendo personagem? _Posição atual: sim — natureza não deriva de
  posse (DEC-ATR-03); mas nenhuma tela decide o que fazer com ele._

## 11. Referências

- `specs/02-modelo-de-dados.md` — REQ-DOC-018/020/023, REQ-DOC-027..030, REQ-DOC-031..035,
  DEC-DOC-08.
- `specs/15-api-de-sistemas.md` — REQ-SYS-010..015, REQ-SYS-042.
- `specs/39-contatos.md` — DEC-CTT-01, DEC-CTT-02, DEC-CTT-03, DEC-CTT-06, REQ-CTT-060..076.
- `specs/40-aba-combate.md` — DEC-CBA-03, DEC-CBA-06, Q-CBA-02.
- `specs/42-aba-npcs.md` — DEC-NPC-02, DEC-NPC-05..10, DEC-NPC-12, DEC-NPC-13, Q-NPC-04,
  Q-NPC-05, Q-NPC-06.
- `specs/29-pets-companions-familiars.md` — REQ-PET-002, REQ-PET-003.
- Código consultado (branch `alfa/app`, 2026-08-16): `systems/pf2e/src/index.ts` e
  `systems/etmos/src/index.ts` (subtypes declarados hoje);
  `packages/client/src/lib/sheets/pf2e/spellCastCardVM.ts`,
  `packages/client/src/lib/compendium/compendiumBrowser.ts` e
  `packages/client/src/components/actors/ActorDirectory.svelte` (os três lugares onde a
  pergunta desta spec é hoje respondida por string literal).

## 12. Emendas que esta spec obriga

Registradas aqui para que o PR não deixe nenhuma spec contrariada em silêncio
(`CONVENCOES.md` §2):

| Spec            | O que muda                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONVENCOES.md` | §3 deixa de mapear nível por faixa de número. A faixa vira **sinal histórico**, e o nível passa a ser declarado no cabeçalho da spec. Motivo em DEC-ATR-01.                                                                                    |
| `15`            | **REQ-SYS-010** passa a exigir `nature` no `SystemDataModelSpec` quando `documentType === "Actor"`, e a proibi-lo nos demais. O contract test (REQ-SYS-030, quando escrito) ganha o caso.                                                      |
| `17`            | **REQ-PF2-115** e a tabela de Actor types perdem `vehicle` e `party` (DEC-ATR-08); a tabela ganha a coluna **Natureza**; `familiar` passa de ⏳ V2 para ✅ MVP, alinhando a `17` ao que a `29` (REQ-PET-002/003 [MVP]) e o código já praticam. |
| `27`            | O marco M6 deixa de listar os actor types `vehicle`/`party` (DEC-ATR-08) e registra que `familiar` é [MVP] pela `29`.                                                                                                                          |
| `40`            | **DEC-CBA-03** passa a usar "criatura" como a natureza `creature` desta spec, em vez de uma definição local. A regra não muda; a palavra ganha dona.                                                                                           |
| `42`            | **Q-NPC-04 fica fechada** (o subtype `loot` é a natureza `container`, DEC-ATR-07) e **Q-NPC-05 fica fechada** (o conteúdo do baú vive em `items`, como o de qualquer ator). O termo "não-jogável" da §3 passa a ser derivado.                  |
| `39`            | Nada muda de comportamento. Registra-se que "contato" e "conhecido" passam a ser definidos sobre a natureza (DEC-ATR-05), e que a `39` deixa de ser a spec que decide quem é personagem.                                                       |
| `02`            | Nada muda no modelo. Registra-se que a natureza é **resolvida e nunca persistida** (REQ-ATR-003), e que REQ-DOC-029 ganha o complemento de REQ-ATR-050 para o caso de personagem.                                                              |
| `05`            | **REQ-USR-025** ganha, junto com a emenda que a `42` já obrigou, a exigência de que o personagem criado nasça de natureza `player` com o usuário como `owner` (REQ-ATR-020, REQ-ATR-050).                                                      |
| `41`            | Nada muda — ela não existe. Registra-se que esta spec entrega a ela a metade que faltava: o que a presença **herda** (REQ-ATR-060/061) está resolvido, e ela pode se ocupar do que a presença **é**.                                           |
