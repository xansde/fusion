# 45 — Atores

- **Título:** Atores — o objeto raiz do que tem vida no jogo, e as facetas que ele acumula
- **Status:** draft v0.2 (2026-08-16)
- **Nível:** Área (ver DEC-ATR-01)
- **Baseada em:**
  - `02-modelo-de-dados.md` — a **forma** do `Actor`: Document primário, `items`/`effects` embedded, `subtype`, `ownership`, `flags` com namespace validável, e a herança token→actor por delta (REQ-DOC-009, REQ-DOC-010, REQ-DOC-018/020/023/027..029, REQ-DOC-031..035, DEC-DOC-08).
  - `15-api-de-sistemas.md` — o contrato pelo qual um sistema declara subtypes (REQ-SYS-010..015). É esta API que ganha a declaração de facetas.
  - `42-aba-npcs.md` — a spec que cunhou "presença na cena" para não usar "token", e deixou registradas as pontas que só esta spec pode fechar (Q-NPC-04, Q-NPC-05).
  - `39-contatos.md` — "contato", "conhecido", "sub-personagem", e a decisão de que conhecimento é do par contato × personagem (DEC-CTT-03).
  - `40-aba-combate.md` — "criatura" como a palavra da regra de visibilidade de vida (DEC-CBA-03) e a constatação de que Token não tem dona (DEC-CBA-06).
  - `29-pets-companions-familiars.md` — `masterActorId`, o vínculo entre atores (REQ-PET-002).
  - `17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md` — os subtypes reais que os três sistemas declaram hoje.

> **Spec de área.** Esta spec é dona do **conceito de ator**: o que é, que facetas existem,
> quem as declara, como se ganham e se perdem, como um ator nasce, morre, é identificado e
> de quem é. Ela **não** redefine a forma de Document (`02`), a superfície da system API
> (`15`), a ficha (`11` e as specs de sistema), nem o que é uma presença numa cena (`41`,
> reservada). Ela fixa o **mecanismo**; qual faceta cada subtype tem e sob que estado a
> ganha é de cada área — ver DEC-ATR-17.

---

## 1. Objetivo

Dar ao Fusion uma resposta única e portável para a pergunta que três specs já precisaram
fazer e nenhuma pôde responder: **"o que este ator é capaz de ser na mesa?"** — e, a partir
dela, fixar o ciclo de vida, a identidade e a posse de um ator, que hoje existem repartidos
entre `02`, `05`, `29`, `39`, `40` e `42`.

O ator é **o objeto raiz de tudo que tem vida no jogo**: toda ficha é ficha de um ator, toda
presença numa cena é presença de um ator. O que varia é o **papel** — e um mesmo ator
acumula mais de um papel ao longo de uma sessão.

## 2. Escopo

### 2.1 Inclui

- A **definição** de ator e a fronteira entre o que é e o que não é ator.
- O **catálogo de facetas** (`player`, `creature`, `hazard`, `container`) e o fato de que um
  ator tem um **conjunto** delas, não uma só.
- A **declaração** de facetas pelo sistema de jogo e a **aquisição** de facetas em tempo de
  jogo (o corpo que passa a ser saqueável; o baú que o Mestre abre).
- O **vocabulário único** que substitui os sinônimos que cada aba cunhou.
- O **ciclo de vida**: por qual porta cada ator nasce, e o que acontece ao excluir.
- A **identidade** de um ator e o tratamento de homônimos.
- O **ownership** com que um ator nasce, e a regra de conflito entre facetas.
- A relação **ator-base × presença na cena**: o que é molde e o que é estado vivo.
- O **vínculo entre atores** (`masterActorId`) e o que acontece quando ele se rompe.

### 2.2 Não inclui

- A forma de `Document`, `EmbeddedCollection`, o campo `ownership` e o CRUD →
  `02-modelo-de-dados.md`.
- A avaliação de permissão por operação e a UI gating → `05-usuarios-e-permissoes.md`.
- O conteúdo do `system` de cada subtype (o que um `npc` do PF2e tem dentro) →
  `17-sistema-pf2e.md`, `18-sistema-sf2e.md`, `19-sistema-etmos.md`.
- A **ficha** de qualquer ator → `11-ui-framework-e-fichas.md`, as specs de sistema e a
  futura spec de ficha de criatura (DEC-NPC-13). Esta spec só fixa que a ficha é do
  **subtype**, nunca da faceta (DEC-ATR-07).
- O **saque, o comércio e a permissão de abrir um recipiente** → spec `46` (Recipientes),
  reservada. Esta spec diz o que é a faceta `container`; a `46` diz o que se faz com ela.
- O que é uma **presença na cena**, seus dados, seu movimento e seu desenho → spec `41`
  (Token), reservada. Esta spec diz o que a presença herda; não diz o que ela é.
- As **telas**: quem lista, com que busca, em que pasta → `39-contatos.md`,
  `42-aba-npcs.md`, `43-aba-compendio.md`.
- O **modelo de conhecimento** (quem conhece quem) → `39-contatos.md` (REQ-CTT-060..076).
- A política de redação de payload por papel → `21-seguranca.md` (REQ-SEC-020).

## 3. Conceitos e terminologia

| Conceito                | Definição                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ator**                | Document `Actor`: o objeto raiz do que tem vida no jogo. Tem ficha, pode ter presença numa cena e é alvo das regras do sistema.              |
| **Faceta**              | Um papel que o ator exerce na mesa: `player`, `creature`, `hazard` ou `container`. Um ator tem **um ou mais** — ver DEC-ATR-03.              |
| **Facetas de nascença** | As que o sistema declara para o subtype (DEC-ATR-04). Não são graváveis nem removíveis por gesto de mesa.                                    |
| **Facetas adquiridas**  | As que o ator ganha ou perde em jogo, gravadas em `flags.fusion.facets` (DEC-ATR-05). É o corpo que vira saqueável, o baú que o Mestre abre. |
| **Personagem**          | Ator com a faceta `player`. É o ator que representa um jogador na mesa.                                                                      |
| **Criatura**            | Ator com a faceta `creature`. Age, tem vida e pode entrar em combate.                                                                        |
| **Perigo**              | Ator com a faceta `hazard`. Ameaça sem intenção própria.                                                                                     |
| **Recipiente**          | Ator com a faceta `container`. Guarda itens que outro ator pode retirar. O baú (DEC-NPC-08) é um recipiente; um mercador também é.           |
| **Sub-personagem**      | Ator vinculado a outro por `masterActorId` (REQ-PET-002): familiar, companheiro, montaria. O alvo do vínculo é livre (DEC-ATR-16).           |
| **Ator-base**           | O `Actor` do mundo, tal como persistido. Quando há presença desvinculada, ele é **molde**, não valor vivo (DEC-ATR-14).                      |
| **Presença na cena**    | A manifestação de um ator numa cena. O termo é o da spec `42` e o conceito é da spec `41`; aqui só se diz o que ela herda do ator.           |
| **Identidade**          | `flags.fusion.sourceId` — o que diz que dois documentos são o mesmo ator. Nunca o nome (DEC-ATR-11).                                         |

## 4. Decisões

### DEC-ATR-01 — Ator é área, e por isso esta spec é de nível Área apesar do número

O `CONVENCOES.md` §3 mapeava nível por faixa: `01`–`26` áreas, `28`+ recortes. Esta spec tem
número 45 e **não é recorte**: ela não atravessa áreas combinando decisões existentes — ela é
dona de decisões novas que ninguém tomou.

- **Racional:** a faixa reflete a ordem em que as specs nasceram, e o próprio `CONVENCOES.md`
  §3 diz isso. Tratar Ator como recorte a proibiria de definir qualquer coisa — recorte cita,
  não define — e é justamente a falta de definição que a trouxe à existência.
- **O que isso obriga:** emenda em `CONVENCOES.md` §3, para que a faixa deixe de ser critério
  de nível e passe a ser sinal — ver §12.
- **O teste de corte foi aplicado** (`CONVENCOES.md` §1): decidir o que é um ator me obriga a
  decidir a faceta, a fronteira, a porta de criação e a posse — as quatro se restringem
  mutuamente. Não obriga a decidir o que é um Document, porque a `02` já decidiu.

### DEC-ATR-02 — Ator é o objeto raiz do que tem vida no jogo

Um ator é o sujeito ao qual tudo o mais se pendura: **toda ficha é ficha de um ator**, toda
presença numa cena é presença de um ator, todo alvo de regra do sistema é um ator. Não é ator
o que existe **dentro** de um ator (item, efeito), o que descreve o mundo sem ser sujeito dele
(nota, desenho, cena, journal), nem o que é dado do jogo e não do mundo (tabela, macro).

- **Por que a `02` não bastava:** ela define a **forma** — Document primário com `items` e
  `effects` embedded (REQ-DOC-018, REQ-DOC-020), `subtype` (REQ-DOC-023), `ownership`
  (REQ-DOC-027). Forma responde "como se guarda", não "o que é". A prova é que a `02` nunca
  precisou enumerar os subtypes de `Actor`, e de fato não os enumera: ela delega ao sistema
  (REQ-SYS-015) e segue em frente. A engine, até aqui, **não tinha opinião sobre o que um ator
  é** — e três specs de aba tiveram que ter uma por conta própria.
- **A fronteira é operacional, não estética:** ser ator implica ter as quatro coisas desta
  spec — facetas, porta de criação, identidade e ownership. Uma coisa que não precisa das
  quatro não deve ser ator; uma que precisa das quatro e não é, vira caso especial em toda
  tela que a encontra. Foi exatamente o que aconteceu com o baú (DEC-ATR-09).

### DEC-ATR-03 — Ator tem um **conjunto** de facetas, não uma natureza

Um ator exerce **um ou mais** papéis na mesa, simultaneamente. O conjunto é não-vazio e os
valores possíveis são exatamente quatro: `player`, `creature`, `hazard`, `container`.

- **O fato que obriga:** um mercador é criatura **e** recipiente ao mesmo tempo — conversa,
  luta se preciso, e tem estoque. Um NPC morto passa a ser saqueável sem deixar de ser a
  criatura que era. Um único valor por ator só descreveria o caso mais pobre, e toda mesa que
  quisesse mais cairia num caso especial fora da engine.
- **Rejeitado: natureza única com "papel primário".** Obrigaria cada tela a decidir se
  pergunta pelo primário ou pelo conjunto, e a resposta divergiria entre telas — que é
  precisamente o defeito que esta spec veio corrigir.
- **Rejeitado: derivar de `ownership`** ("é personagem quem tem um não-GM como OWNER"). Um NPC
  entregue a um jogador viraria personagem, e um personagem sem dono sumiria da categoria.
  Posse é uma pergunta legítima e é outra — ver DEC-ATR-12 e DEC-ATR-15.
- **O enum é fechado, e fechar é o ponto.** Acrescentar uma faceta exige emenda **nesta** spec
  e no contract test (RNF-ATR-02). Sem isso, cada spec de área inventa a sua e o vocabulário
  vira lixeira — o problema que a DEC-ATR-06 está desfazendo.

### DEC-ATR-04 — O sistema declara as facetas de nascença do subtype

Todo `SystemDataModel` de `documentType: "Actor"` DEVE declarar `facets`: a lista não-vazia
das facetas com que qualquer ator daquele subtype nasce.

O mapeamento dos sistemas de hoje:

| Sistema | Subtype       | Facetas de nascença |
| ------- | ------------- | ------------------- |
| pf2e    | `character`   | `player`            |
| pf2e    | `npc`         | `creature`          |
| pf2e    | `hazard`      | `hazard`            |
| pf2e    | `loot`        | `container`         |
| pf2e    | `familiar`    | `creature`          |
| sf2e    | `character`   | `player`            |
| sf2e    | `npc`         | `creature`          |
| sf2e    | `hazard`      | `hazard`            |
| sf2e    | `loot`        | `container`         |
| etmos   | `orador`      | `player`            |
| etmos   | `antagonista` | `creature`          |

- **O fato que motiva a decisão:** hoje ninguém sabe responder. O cliente decide com string
  literal de PF2e — `t === "character" || t === "npc"` em `spellCastCardVM.ts`,
  `subtype === "npc" || subtype === "hazard"` em `compendiumBrowser.ts`, e uma tabela
  `{ pf2e: "character", sf2e: "character", etmos: "orador" }` codificada dentro de
  `ActorDirectory.svelte`. No Etmos os subtypes são `orador`/`antagonista`: o hardcode
  simplesmente não se aplica, e a pergunta é respondida errado em silêncio.
- **Quem depende disso, hoje, sem ter de quem depender:** a `39` precisa saber quem é
  personagem para montar "na mesa"; a `40` precisa saber quem é criatura para esconder a vida
  (DEC-CBA-03); a `42` precisa saber o que listar (DEC-NPC-05). Três specs escritas, três
  definições paralelas, zero contratos.
- **Rejeitado: um campo de engine no próprio `Actor` para as facetas de nascença.** Seria dado
  duplicado do subtype, livre para divergir dele, e alguém teria que preenchê-lo nos 492
  registros do bestiário já importado. O que se grava é só o **delta** — ver DEC-ATR-05.
- **Sobre o nome `player`:** ele descreve o ator que representa um jogador, não o usuário.
  `User` continua sendo o usuário (`05`), e nada nesta spec o toca.

### DEC-ATR-05 — Facetas também se ganham e se perdem em jogo, e o delta é gravado

Além das facetas de nascença, um ator pode **ganhar** e **perder** facetas durante o jogo. O
delta vive em `flags.fusion.facets`, e o conjunto efetivo é:

```
facetsOf(actor) = (declaradas(subtype) ∪ granted) − revoked
```

- **O fato que obriga:** "se eu for morto, devem poder lotear meu corpo". A criatura não
  nasceu recipiente; ela **passa a ser**. O mesmo vale para o mercador que fecha a loja, e
  para qualquer gesto que o Mestre invente na hora.
- **Por que não deixar isso implícito nas telas** (o sistema declara `{creature, container}`
  em `npc` e a UI decide quando oferecer saque): a regra "quando pode saquear" ficaria
  espalhada em cada tela que encontra um NPC, cada uma com o seu critério, e o Mestre não
  teria como marcar um ator saqueável fora do caso previsto. Facetas adquiridas põem a
  resposta num lugar só e deixam a mesa criar casos que ninguém previu.
- **Onde isso mora não é campo novo:** a `02` já tem `flags.<namespace>.<key>` com namespace
  registrável e validado (REQ-DOC-009, REQ-DOC-010), e o namespace `fusion` já é usado pela
  identidade (DEC-ATR-11). Nenhuma emenda estrutural na `02` — só o registro do que ocupa
  esse espaço.
- **Continua puro e síncrono:** o delta é dado do próprio ator, então `facetsOf` não faz I/O
  nem depende de estado externo (RNF-ATR-01).
- **`revoked` existe para não travar a mesa:** se o sistema declara `container` num subtype e
  o Mestre não quer aquele ator saqueável, ele tira. Faceta declarada não é dogma.

### DEC-ATR-06 — Um vocabulário só; "não-jogável" deixa de existir como termo

A partir daqui existem quatro palavras — **personagem**, **criatura**, **perigo**,
**recipiente** — e elas são exatamente as quatro facetas. **"Não-jogável" sai do vocabulário**:
não é faceta, não é derivação e não é filtro.

- **O que isso corrige:** a mesma fatia do mundo estava batizada três vezes, cada vez numa
  spec de painel — "não-jogável" (`42` §3), "criatura" (`40` §3), "conhecido" (`39` §3) — e as
  três definições não coincidem. A da `42` é `npc` **ou** `hazard`; a da `40` é "participante
  que não é personagem de jogador", que inclui o familiar. Nenhuma estava errada na sua spec;
  elas não podiam estar certas juntas.
- **Por que derivar não resolvia:** definir "não-jogável" como "quem não tem a faceta `player`"
  produz um conjunto mais largo que o da `42` — inclui recipiente — e faria a aba prometer
  listar o que não lista. Com facetas, a `42` diz o que sempre quis dizer sem o termo: ela
  **lista quem tem `creature` ou `hazard`**.
- **O que cada spec mantém:** "contato" e "conhecido" (`39`) continuam sendo o que sempre
  foram — recortes de **exibição**, definidos sobre facetas, não ao lado delas. Nenhuma aba
  muda de nome.

### DEC-ATR-07 — A ficha é do subtype, nunca da faceta

Todo ator tem ficha, e **fichas diferentes são fichas diferentes**: a ficha de um personagem
não é a de uma criatura, que não é a de um perigo. Quem seleciona a ficha é o **subtype**
(REQ-SYS-010, `sheet(spec)` da `15`) — nunca a faceta.

- **Racional:** faceta é um enum de quatro valores da engine; ficha é conteúdo de sistema, com
  ações e características próprias (o familiar do PF2e tem ações que só ele tem). Ligar ficha
  a faceta obrigaria um ator de duas facetas a ter duas fichas, ou a engine a arbitrar qual
  vence — nenhuma das duas é resposta.
- **Consequência prática:** um ator que ganha a faceta `container` **não** troca de ficha. O
  que muda é o que a `46` (Recipientes) passa a oferecer sobre ele.

### DEC-ATR-08 — A porta de criação é do subtype; cada aba declara o que cria

Cada subtype nasce por uma porta, e é a spec da aba que diz quais subtypes ela cria. Não há
"porta por faceta": um subtype de duas facetas nasceria por duas portas, com dois conjuntos de
defaults.

| Porta                             | O que ela cria                                                     |
| --------------------------------- | ------------------------------------------------------------------ |
| Administração de usuários (`37`)  | O ator do jogador, no mesmo gesto que cria o usuário (DEC-NPC-02). |
| Aba NPCs (`42`)                   | Os subtypes com faceta `creature` ou `hazard` (DEC-NPC-06).        |
| Gesto na cena ativa (`42` rodapé) | O baú — subtype com faceta `container` (DEC-NPC-08).               |

- **Racional:** porta única por subtype é o que impede que a mesma coisa nasça de dois jeitos
  com dois conjuntos de defaults. A `42` já tinha chegado a essa conclusão; esta spec
  generaliza e nomeia a regra.
- **Importar não é uma porta a mais.** Trazer um ator de um pack (REQ-CMP-016, REQ-CMP-021) é a
  mesma criação com os campos pré-preenchidos, e as facetas vêm do subtype importado como em
  qualquer outra criação.
- **O que continua sem porta, e é aceito:** **excluir personagem** não tem tela nenhuma
  (Q-NPC-06). Esta spec define a regra de exclusão (DEC-ATR-15) para quando a tela existir; não
  a cria.

### DEC-ATR-09 — Recipiente é ator, e é isso que dá ao baú conteúdo, dono e presença

O baú é um ator com a faceta `container`. Ele tem `items` como qualquer ator, `ownership` como
qualquer ator e presença na cena como qualquer ator — e **nenhuma aba de autoria o lista**,
exatamente como a DEC-NPC-08 exigiu.

- **Isto não contraria a DEC-NPC-08, e o ponto é esse:** o que ela recusou foi o baú **no
  diretório** — "entraria na árvore de pastas, pediria pasta, atitude e conhecimento". Tudo
  isso continua valendo: um ator que só tem a faceta `container` não tem pasta, não tem atitude
  e não entra na janela de conhecimento. Ausência de aba não é ausência de registro.
- **Fecha Q-NPC-04:** o subtype `loot` do PF2e ganha consumidor — ele é o subtype de faceta
  `container`, e não fica declarado sem uso.
- **Fecha Q-NPC-05:** o conteúdo do baú vive onde o conteúdo de qualquer ator vive, na coleção
  `items` (REQ-DOC-020). Com presença desvinculada, o conteúdo vivo é o da presença, pela mesma
  regra de todo mundo (DEC-ATR-14) — nenhuma mecânica nova.
- **Rejeitado: recipiente como coisa da cena, fora de ator.** Criaria uma segunda família de
  coisas que ocupam a cena e guardam itens, com a sua própria posse, o seu próprio inventário e
  a sua própria presença — três subsistemas duplicados para economizar um subtype. E não
  atenderia o mercador, que precisa ser criatura e recipiente ao mesmo tempo.

### DEC-ATR-10 — Veículo e `party` não existem, e o plano deixa de dizer que existem

Não há faceta de veículo, e não haverá subtype de veículo enquanto ninguém o pedir. O mesmo
vale para `party`.

- **O que estava contraditório:** a `17` listava `vehicle` como Actor type [V2] (REQ-PF2-115) e
  a `27` o punha no marco M6; a `42` (DEC-NPC-05) declarou "veículo não existe no Fusion. Não é
  subtipo cortado: nunca foi declarado por sistema nenhum". As duas não podiam estar certas, e
  nenhuma emendou a outra.
- **A resolução:** esta spec é a dona do catálogo, e o catálogo não tem veículo. `17` e `27` são
  emendadas — ver §12.
- **`party` cai pelo mesmo motivo, com um argumento a mais:** o agrupamento de personagens já
  existe e não é ator — é o painel de Comitiva do Hub (`28`, REQ-HUB-044).
- **Isto não é linha vermelha, e com facetas ficou barato:** se uma mesa precisar de veículo, um
  sistema declara o subtype com as facetas que ele exercer (provavelmente `container`, talvez
  `creature`) e nada nesta spec precisa mudar. O que está proibido é ele continuar no plano sem
  ninguém tê-lo pedido.

### DEC-ATR-11 — Identidade é `flags.fusion.sourceId`; nome é rótulo

Dois documentos são o mesmo ator quando têm o mesmo `flags.fusion.sourceId`. O nome **NÃO
DEVE** ser usado como identidade em lugar nenhum — nem para deduplicar importação, nem para
casar ator com presença, nem para reconhecer um ator já trazido de um pack.

- **Racional:** homônimo é o padrão do conteúdo de PF2e, não a exceção — o bestiário importado
  tem nomes repetidos entre packs e dentro do mesmo pack. Casar por nome já é a técnica que a
  `31` recusou explicitamente para a base canônica.
- **Ator criado do zero também tem identidade:** recebe um `sourceId` próprio na criação, não
  `null`. Sem isso, "veio de um pack" e "nasceu aqui" seriam distinguíveis apenas por ausência,
  e toda consulta precisaria tratar o caso nulo.
- **O que esta spec não faz:** ela não define `flags.fusion.sourceId` para todo Document — isso
  continua sem dona, e vira Q-ATR-05. Ela fixa a regra **para ator**.

### DEC-ATR-12 — Ownership nasce pelas facetas, e personagem nasce com dono

| Facetas de nascença       | `ownership` na criação                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Contém `player`           | `{ default: none, <userId>: owner }` — o usuário com quem ele nasceu (DEC-NPC-02). |
| Qualquer outra combinação | `{ default: none }`.                                                               |

- **A regra de conflito é simples porque `player` é a única faceta que concede posse:** se o
  conjunto contém `player`, vale a linha de cima; nos demais casos, o ator nasce fechado.
- **Relação com a `02`:** REQ-DOC-029 já fixa a regra geral de criação. Esta decisão não a
  contraria: ela diz **qual é o `<userId>`** no caso de personagem, que é o único em que o dono
  não é o criador. Quem cria o personagem é o Mestre, na administração de usuários; quem o
  possui é o jogador.
- **Sobre recipiente:** nascer com `default: none` **não** significa que abrir um baú exige
  conceder ownership. Abrir é gesto de cena, e o permissionamento dele é da `46` (DEC-ATR-13).
- **Isto não é a matriz de permissões.** O que cada nível permite fazer continua sendo da `05`;
  aqui só se diz com que mapa o ator nasce.

### DEC-ATR-13 — Faceta descreve papel na mesa, nunca mecânica — e nunca autoriza

Uma faceta serve para a engine e a interface perguntarem "que papéis este ator exerce". Ela
**NÃO DEVE** ser consultada para decidir dano, iniciativa, condição, alcance ou qualquer
resultado de jogo — isso é do sistema, pela API que já existe (`15`). E **NÃO DEVE** autorizar
operação alguma: autorização é `ownership` (`02`) e papel (`05`).

- **Racional:** faceta é um enum de quatro valores fixado pela engine. No instante em que uma
  regra de jogo passar a depender dela, ela vira uma segunda API de sistemas — com vocabulário
  pobre, sem versionamento e sem contract test. O PF2e tem criaturas que não agem e perigos que
  agem; deixar a mecânica ler faceta é ensinar a engine a errar.
- **A fronteira prática, com um caso de cada lado:** a engine **pode** dizer "não mostre a vida
  deste ator a quem não é papel privilegiado" (DEC-CBA-03) — é regra de **mesa**, sobre quem vê
  o quê. **Não pode** dizer "este ator não rola iniciativa" — é regra de **jogo**, e é
  `REQ-SYS-042` quem responde. O teste: se a resposta muda conforme quem está olhando, é mesa;
  se muda conforme a regra do sistema, é jogo.
- **Consequência para a `46`:** "quem pode abrir este recipiente" é permissão, não faceta. A
  faceta diz que há o que abrir; a `46` diz quem abre.

### DEC-ATR-14 — O ator-base é molde quando a presença é desvinculada

Quando a presença numa cena é desvinculada do ator (`actorLink: false`, REQ-DOC-033), os
valores vivos — vida, condições, inventário, facetas adquiridas — são os da **presença**, e os
do ator-base são **molde**. Nenhuma tela deve exibir o valor do ator-base como se descrevesse
alguém.

- **Racional:** é o argumento da DEC-NPC-10, generalizado. Cinco goblins na cena têm cada um a
  sua vida; "a vida do goblin" não descreve nenhum dos cinco. Com facetas adquiridas o caso
  fica mais nítido: **um** dos cinco goblins morre e vira saqueável — os outros quatro não.
- **Consequência para toda tela:** uma lista de atores (`42`), de contatos (`39`) ou um
  resultado de busca (`43`) exibe **identidade e facetas de nascença**, nunca estado vivo.
  Estado vivo aparece onde há presença ou ficha.
- **O ator efetivo já está definido, e esta spec não o redefine:** REQ-DOC-032/033/034 e
  REQ-CNV-090/091 dizem como reconstruí-lo e por qual rota mutá-lo. O que faltava era a regra de
  **leitura**: quando o base é molde, não se lê o base.

### DEC-ATR-15 — Excluir mostra o que cai junto, e é recusado com combate ativo

Excluir um ator DEVE mostrar antes o que a exclusão leva junto, e DEVE ser recusado enquanto o
ator participar de um combate ativo.

- **Generaliza a DEC-NPC-12**, que valia só para a aba NPCs. A regra é do ator, não da aba:
  qualquer porta que venha a excluir um ator responde por ela.
- **O que cai junto, e precisa ser mostrado:** presenças nas cenas, sub-personagens pendurados
  nele por `masterActorId`, o conhecimento registrado sobre ele (`39`), e a participação em
  combates encerrados.
- **Soft reference não é integridade:** a `02` já decidiu que referências entre documents são
  fracas e que o consumidor trata `null`. Mostrar o que cai junto é o que transforma uma
  referência quebrada em decisão informada, e é por isso que o aviso é requisito e não cortesia.
- **Combate ativo é recusa, não aviso:** remover um participante do meio da fila é um estado que
  o `10` não modela, e um encontro corrompido custa mais que uma exclusão adiada.

### DEC-ATR-16 — O vínculo entre atores é livre: qualquer ator aponta para qualquer ator

`masterActorId` (REQ-PET-002) pode apontar para **qualquer** ator, sem restrição de subtype nem
de faceta. Um familiar pode pertencer a uma criatura; um NPC pode estar pendurado num
recipiente; um perigo pode ter dono.

- **Racional:** a mesa inventa relações que nenhuma spec prevê, e travar o alvo do vínculo
  transforma cada invenção num pedido de mudança de engine. O custo de deixar livre é baixo — o
  vínculo é uma referência fraca, e quem o consome já trata a ausência.
- **Rejeitado: exigir que o alvo tenha a faceta `player`.** Era a regra da v0.1 desta spec, e ela
  quebra dois casos reais: familiar de NPC, e familiar sem dono nenhum.
- **O que a derivação do mestre exige, e o que ela não exige:** REQ-PET-003 faz o sub-personagem
  derivar valores do dono. Isso continua sendo responsabilidade do **sistema**, que sabe o que
  derivar de quê e o que fazer quando o dono não tem o dado esperado. A engine não arbitra.
- **Órfão é estado visível, não erro silencioso:** REQ-PET-002 já exige que a ficha sinalize o
  sub-personagem sem mestre válido. Esta spec acrescenta o outro lado: excluir o dono é uma
  exclusão que **leva junto** (DEC-ATR-15) e tem que dizer isso antes.

### DEC-ATR-17 — Esta spec fixa o mecanismo; cada área declara o conteúdo

O que se decide **aqui**: o que é uma faceta, o enum fechado, quem declara as de nascença, como
se ganha e se perde uma adquirida, que `facetsOf` é a única rota, e que acrescentar faceta ao
enum exige emenda nesta spec.

O que se decide **na spec da área**: com quais facetas cada subtype nasce, sob que estado se
ganha ou perde uma faceta, qual gesto na tela faz isso, e qual o permissionamento de cada uma.

- **O teste de corte:** se a resposta muda ao trocar de sistema de jogo ou de aba, **não** é
  desta spec. Se vale para qualquer ator de qualquer sistema, é.
- **Aplicado aos casos abertos:** "criatura morta vira saqueável" e "mercador" são da `46`
  (Recipientes), que é dona do saque e do comércio — não da `42`. A `42` declara apenas que cria
  e lista os subtypes de faceta `creature` e `hazard`.
- **Por que isso precisa estar escrito:** sem a divisão, ou a `45` cresce até decidir regra de
  cada aba, ou cada aba inventa faceta própria. As duas falhas já aconteceram neste repositório.

### DEC-ATR-18 — "Jogável" é posse, não faceta

Um ator ser **controlado por um jogador** é uma questão de `ownership`, não de faceta. Um
familiar vinculado a um personagem é controlado pelo jogador porque ele tem ownership — e
continua sendo criatura.

- **Racional:** faceta e posse respondem perguntas diferentes, e é justamente por confundi-las
  que a derivação por `ownership` foi rejeitada (DEC-ATR-03). Dar `player` a um familiar o faria
  aparecer como membro da mesa na aba Contatos e sujeito às regras de personagem — efeito
  colateral, não intenção.
- **O que o familiar tem de próprio está no subtype:** ações e características específicas vêm
  do subtype `familiar` e da ficha dele (DEC-ATR-07), não de uma faceta.
- **Consequência para a aba NPCs:** o familiar tem faceta `creature` e portanto **aparece** na
  aba (fecha Q-ATR-01 da v0.1 desta spec, emendando REQ-NPC-044 e CA-NPC-007) — inclusive o
  familiar que não pertence a personagem nenhum.

## 5. Requisitos funcionais

### Definição e facetas

- **REQ-ATR-001** [MVP] A engine DEVE tratar como **ator** todo Document `Actor`, e DEVE
  recusar a criação de um `Actor` cujo subtype não tenha um `SystemDataModel` registrado
  (REQ-SYS-011).
- **REQ-ATR-002** [MVP] Todo ator DEVE ter um conjunto **não-vazio** de facetas, com valores em
  `{ player, creature, hazard, container }`.
- **REQ-ATR-003** [MVP] A engine DEVE expor uma função pura `facetsOf(actor): ReadonlySet<Facet>`
  que combina as facetas declaradas pelo sistema com o delta gravado no ator, e DEVE ser a
  **única** rota pela qual engine, servidor e cliente respondem que papéis um ator exerce.
- **REQ-ATR-004** [MVP] A engine DEVE expor `hasFacet(actor, facet): boolean` como atalho de
  `facetsOf`, e as telas DEVEM usá-lo em vez de comparar conjuntos.
- **REQ-ATR-005** [MVP] Nenhum código de engine, servidor ou cliente DEVE comparar o subtype de
  um ator contra um literal de sistema (`"character"`, `"npc"`, `"orador"`) para decidir
  comportamento de mesa; toda decisão desse tipo DEVE consultar `facetsOf`/`hasFacet`.
- **REQ-ATR-006** [MVP] A engine NÃO DEVE consultar faceta para decidir resultado de jogo (dano,
  iniciativa, condição, alcance, aplicabilidade de regra), conforme DEC-ATR-13.
- **REQ-ATR-007** [MVP] A engine NÃO DEVE consultar faceta para autorizar operação alguma;
  autorização é `ownership` (REQ-DOC-028, REQ-DOC-030) e papel (`05`).
- **REQ-ATR-008** [MVP] A ficha exibida para um ator DEVE ser selecionada pelo **subtype**
  (REQ-SYS-010), e NÃO DEVE depender das facetas dele.

### Declaração pelo sistema

- **REQ-ATR-010** [MVP] O `SystemDataModelSpec` (REQ-SYS-010) DEVE ganhar o campo `facets`, uma
  lista não-vazia, **obrigatória** quando `documentType === "Actor"` e **proibida** nos demais
  documentTypes.
- **REQ-ATR-011** [MVP] O contract test da system API DEVE falhar quando um sistema registrar um
  model de `Actor` sem `facets`, com lista vazia, com valor fora do enum, com valor repetido, ou
  declarando `facets` em um documentType que não seja `Actor`.
- **REQ-ATR-012** [MVP] Um sistema PODE declarar mais de um subtype com as mesmas facetas, e NÃO
  DEVE ser obrigado a cobrir as quatro facetas (o Etmos declara apenas `player` e `creature`).
- **REQ-ATR-013** [MVP] Quando o sistema ativo não declara nenhum subtype com uma dada faceta, a
  interface NÃO DEVE oferecer a porta de criação correspondente (DEC-ATR-08) — em vez de oferecer
  um gesto que falharia na validação do servidor.
- **REQ-ATR-014** [MVP] A engine DEVE expor a lista de subtypes de `Actor` do sistema ativo com as
  facetas de cada um, para que as telas de criação e de filtro sejam construídas a partir dela e
  não de uma tabela codificada no cliente.
- **REQ-ATR-015** [MVP] O servidor DEVE entregar ao cliente, junto da informação do mundo e antes
  de qualquer listagem de atores, o mapa `subtype → facetas` do sistema ativo; o cliente NÃO DEVE
  depender do pacote do sistema para resolver facetas (RNF-ATR-03).

### Facetas adquiridas

- **REQ-ATR-020** [MVP] Um ator PODE ganhar e perder facetas em tempo de jogo; o delta DEVE ser
  gravado em `flags.fusion.facets`, com as listas `granted` e `revoked`.
- **REQ-ATR-021** [MVP] `facetsOf` DEVE resolver o conjunto efetivo como
  `(declaradas ∪ granted) − revoked`, e o resultado DEVE continuar não-vazio; o servidor DEVE
  recusar uma escrita que esvazie o conjunto.
- **REQ-ATR-022** [MVP] O servidor DEVE validar `flags.fusion.facets` contra o enum de facetas e
  recusar valores desconhecidos (REQ-DOC-010).
- **REQ-ATR-023** [MVP] Alterar as facetas de um ator DEVE exigir a mesma autorização de
  qualquer escrita nele (`ownership` e papel), e NÃO DEVE ter regra de permissão própria.
- **REQ-ATR-024** [MVP] Quando a presença numa cena é desvinculada (REQ-DOC-033), o delta de
  facetas vivo DEVE ser o da presença, e o do ator-base DEVE ser tratado como molde
  (DEC-ATR-14).
- **REQ-ATR-025** [MVP] Ganhar ou perder uma faceta NÃO DEVE alterar o subtype, a ficha, a
  identidade nem o `ownership` do ator.
- **REQ-ATR-026** [MVP] Esta spec NÃO DEVE definir sob que condição uma faceta é ganha ou
  perdida; isso é da spec da área dona da faceta (DEC-ATR-17).

### Ciclo de vida — criação

- **REQ-ATR-030** [MVP] Criar um usuário DEVE criar, no mesmo gesto, um ator com a faceta
  `player` associado a ele (DEC-NPC-02, emendando REQ-USR-025 e REQ-CFG-051).
- **REQ-ATR-031** [MVP] A criação de atores com faceta `creature` ou `hazard` DEVE acontecer pela
  aba NPCs (`42`), pelas portas que a DEC-NPC-06 fixa.
- **REQ-ATR-032** [MVP] A criação do baú DEVE acontecer pelo gesto que o põe direto numa cena
  (DEC-NPC-08), e um ator cujas facetas de nascença sejam apenas `container` NÃO DEVE aparecer em
  diretório, busca de autoria ou contagem de nenhuma aba.
- **REQ-ATR-033** [MVP] Importar um ator de um pack (REQ-CMP-016, REQ-CMP-021) DEVE produzir um
  ator com a mesma disciplina de qualquer criação: facetas pelo subtype, identidade por
  `sourceId` e ownership pelas facetas.
- **REQ-ATR-034** [MVP] O servidor DEVE recusar a criação de um ator com a faceta `player` que
  não venha acompanhada do usuário a quem ele pertence (REQ-ATR-060).
- **REQ-ATR-035** [MVP] O caminho genérico de criação de document (`doc:create`) DEVE passar a
  recusar subtypes de faceta `player`, e a criação de personagem DEVE migrar para a porta da
  administração de usuários antes de a recusa entrar em vigor.
- **REQ-ATR-036** [V2] Um jogador PODE ter mais de um personagem; o gesto de criar o segundo é
  [V2] (REQ-NPC-055a) e, quando existir, DEVE usar a mesma porta da administração de usuários.

### Ciclo de vida — exclusão

- **REQ-ATR-040** [MVP] Antes de excluir um ator, a interface DEVE apresentar o que a exclusão
  leva junto: presenças nas cenas, sub-personagens vinculados, conhecimento registrado e
  participações em combates encerrados.
- **REQ-ATR-041** [MVP] O servidor DEVE **recusar** a exclusão de um ator que participe de um
  combate ativo, com erro identificável pelo cliente, e a interface DEVE explicar o motivo em vez
  de apenas falhar.
- **REQ-ATR-042** [MVP] Excluir um ator DEVE remover as presenças dele em todas as cenas.
- **REQ-ATR-043** [MVP] Excluir um ator que seja alvo de `masterActorId` NÃO DEVE excluir os
  atores vinculados a ele; eles ficam órfãos e a ficha sinaliza isso (REQ-PET-002).
- **REQ-ATR-044** [MVP] Excluir um ator NÃO DEVE apagar nem reescrever mensagens de chat que o
  citem; a referência fica pendente e o consumidor trata a ausência.
- **REQ-ATR-045** [V2] Excluir um ator de faceta `player` DEVE ter uma porta na interface; hoje
  não tem nenhuma, e isso é aceito (Q-NPC-06).

### Identidade

- **REQ-ATR-050** [MVP] Todo ator DEVE carregar `flags.fusion.sourceId`, preenchido na criação —
  pela origem, quando importado de um pack; por um identificador próprio, quando criado do zero.
- **REQ-ATR-051** [MVP] Nenhuma operação de engine, servidor ou cliente DEVE usar o **nome** de um
  ator como identidade: nem para deduplicar importação, nem para casar ator com presença, nem
  para reconhecer um ator já trazido de um pack.
- **REQ-ATR-052** [MVP] Dois atores com o mesmo `sourceId` no mesmo mundo DEVEM ser tratados como
  duas cópias do mesmo ator de origem, e a interface DEVE poder distingui-los sem depender do
  nome.
- **REQ-ATR-053** [MVP] Renomear um ator NÃO DEVE alterar o `sourceId` nem quebrar qualquer
  vínculo (presença, sub-personagem, conhecimento, participação em combate).
- **REQ-ATR-054** [MVP] Mundos criados antes desta spec DEVEM ser migrados (`03`): atores sem
  `flags.fusion.sourceId` recebem um, e o `ownership` de atores com faceta `player` é conferido
  contra REQ-ATR-060; a migração DEVE relatar o que corrigiu.

### Posse

- **REQ-ATR-060** [MVP] Um ator com a faceta `player` DEVE nascer com `ownership.default = none` e
  `ownership.<userId> = owner`, onde `<userId>` é o usuário com quem ele foi criado — não o
  criador do documento (complementa REQ-DOC-029).
- **REQ-ATR-061** [MVP] Um ator sem a faceta `player` DEVE nascer com `ownership.default = none`.
- **REQ-ATR-062** [MVP] Conceder ownership de um ator a um jogador NÃO DEVE alterar as facetas
  dele: um NPC controlado por um jogador continua sendo criatura, e continua sujeito às regras de
  exibição de criatura (DEC-CBA-03).
- **REQ-ATR-063** [MVP] Um ator PODE existir sem nenhum usuário como owner, inclusive um ator com
  a faceta `player` cujo usuário foi removido, e isso NÃO DEVE ser tratado como erro.

### Ator e presença

- **REQ-ATR-070** [MVP] Uma presença na cena DEVE herdar as facetas do ator que ela manifesta;
  presença NÃO DEVE ter catálogo de facetas próprio.
- **REQ-ATR-071** [MVP] Quando a presença é desvinculada (REQ-DOC-033), nenhuma tela DEVE exibir
  valores vivos do ator-base (vida, condições, inventário, facetas adquiridas) como se
  descrevessem a presença.
- **REQ-ATR-072** [MVP] Listas de atores (diretório, contatos, resultado de busca) DEVEM exibir
  identidade e facetas de nascença, e NÃO DEVEM exibir estado vivo.
- **REQ-ATR-073** [MVP] Um ator PODE existir sem nenhuma presença em cena, e isso NÃO DEVE ser
  tratado como estado incompleto ou erro.

### Vínculo entre atores

- **REQ-ATR-080** [MVP] O alvo de `masterActorId` (REQ-PET-002) PODE ser qualquer ator; o servidor
  NÃO DEVE recusar um vínculo por subtype nem por faceta do alvo (DEC-ATR-16).
- **REQ-ATR-081** [MVP] O vínculo DEVE ser uma soft reference: um `masterActorId` que aponta para
  um ator inexistente NÃO DEVE quebrar a leitura do ator vinculado, e DEVE ser sinalizado
  (REQ-PET-002).
- **REQ-ATR-082** [MVP] A derivação de valores do ator vinculado a partir do alvo (REQ-PET-003) é
  responsabilidade do **sistema**, e o sistema DEVE tratar o caso em que o alvo não tem o dado
  esperado — a engine NÃO DEVE arbitrar.
- **REQ-ATR-083** [MVP] Um ator NÃO DEVE apontar para si mesmo por `masterActorId`, e o servidor
  DEVE recusar ciclos.

## 6. Requisitos não-funcionais

- **RNF-ATR-01** `facetsOf` DEVE ser pura, síncrona e livre de I/O: ela é consultada em laço de
  render de lista e em predicado de redação por payload. Isso é possível porque tanto a
  declaração quanto o delta estão em memória (o registro do sistema e o próprio ator).
- **RNF-ATR-02** Acrescentar uma faceta ao enum DEVE exigir mudança nesta spec e no contract test
  da system API — nunca apenas em um sistema ou em uma spec de aba.
- **RNF-ATR-03** A resolução de facetas NÃO DEVE depender do pacote de nenhum sistema estar
  carregado no cliente: o cliente resolve pelo mapa que o servidor lhe entrega (REQ-ATR-015,
  `REQ-ARQ-005`).

## 7. Modelo de dados e API

A mudança de contrato é em `SystemDataModelSpec` (`15`, REQ-SYS-010):

```ts
type Facet = "player" | "creature" | "hazard" | "container";

interface SystemDataModelSpec<S extends ZodType = ZodType> {
  documentType: DocumentType; // "Actor" | "Item" | ...
  subtype: string; // "character" | "npc" | "orador" | ...
  schema: S; // valida APENAS o campo `system`
  migrations?: MigrationMap;
  defaults?: Partial<z.infer<S>>;
  /** Obrigatório e não-vazio quando documentType === "Actor"; proibido nos demais. */
  facets?: readonly Facet[];
}
```

O delta gravado no ator, dentro do namespace `fusion` que a `02` já prevê (REQ-DOC-009,
REQ-DOC-010):

```ts
// flags.fusion.facets — ausente quando o ator nunca ganhou nem perdeu faceta
interface FacetDelta {
  granted?: readonly Facet[];
  revoked?: readonly Facet[];
}
```

E as funções que a engine passa a expor:

```ts
/** REQ-ATR-003 — a única rota para "que papéis este ator exerce". */
function facetsOf(actor: Actor): ReadonlySet<Facet>;

/** REQ-ATR-004 — atalho para as telas. */
function hasFacet(actor: Actor, facet: Facet): boolean;

/** REQ-ATR-014 — subtypes de Actor do sistema ativo, com as facetas de cada um. */
function actorSubtypes(): ReadonlyArray<{ subtype: string; facets: readonly Facet[] }>;
```

Nenhum campo novo é acrescentado ao `Actor`: as facetas de nascença são resolvidas pelo
subtype e o delta vive em `flags`, que já existe. A `02` fica intocada na forma do documento.

## 8. Dependências

| Spec | O que esta spec depende / não pode contrariar                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| `02` | Forma do `Actor`, `ownership`, `flags` com namespace validável, herança token→actor por delta. Cita; não redefine. |
| `03` | Máquina de migrations, usada por REQ-ATR-054.                                                                      |
| `05` | Papéis e matriz de permissões. Faceta nunca autoriza nada (REQ-ATR-007).                                           |
| `15` | Contrato de declaração de subtypes. Esta spec **acrescenta** um campo (§12) e nada mais.                           |
| `16` | Importação de pack: as facetas vêm do subtype importado, sem segundo caminho.                                      |
| `29` | `masterActorId` e derivação do mestre. Esta spec **liberou** o alvo do vínculo (DEC-ATR-16).                       |
| `39` | "Contato"/"conhecido" continuam sendo recortes de exibição, agora definidos sobre facetas.                         |
| `40` | "Criatura" da DEC-CBA-03 passa a ser a faceta `creature`, com definição.                                           |
| `41` | Reservada. Esta spec diz o que a presença **herda**; o que a presença **é** continua sendo dela.                   |
| `42` | Portas de criação, baú, atitude. Esta spec generaliza as decisões dela e fecha Q-NPC-04 e Q-NPC-05.                |
| `43` | Trazer ator do acervo é criação com campos pré-preenchidos, não uma porta paralela.                                |
| `46` | Reservada. Dona do saque, do comércio e da permissão de abrir um recipiente (DEC-ATR-13).                          |

## 9. Critérios de aceitação

- **CA-ATR-001** Um mundo de Etmos lista os `orador` na seção "na mesa" da aba Contatos e os
  `antagonista` na aba NPCs, sem nenhuma string de PF2e envolvida.
- **CA-ATR-002** Um sistema que registre um model de `Actor` sem `facets`, com lista vazia ou com
  valor fora do enum falha o contract test com mensagem que aponta o subtype.
- **CA-ATR-003** Um mercador declarado com `facets: ["creature", "container"]` aparece na aba
  NPCs, entra em combate e tem estoque — sem caso especial em nenhuma das três telas.
- **CA-ATR-004** Uma criatura que ganha a faceta `container` em jogo passa a ser saqueável sem
  trocar de ficha, sem trocar de subtype e sem sair da aba NPCs.
- **CA-ATR-005** Um dos cinco goblins desvinculados da mesma cena ganha `container`; os outros
  quatro não o ganham, e o ator-base continua sem ele.
- **CA-ATR-006** Criar um usuário produz, na mesma operação, um ator com faceta `player`, com esse
  usuário como `owner` e `default: none`.
- **CA-ATR-007** Um baú posto na cena não aparece na aba NPCs, na busca de autoria nem em contagem
  de aba nenhuma — e abrir a presença dele mostra os itens que ele carrega.
- **CA-ATR-008** Excluir um goblin que está em três cenas mostra as três presenças antes de
  confirmar, e removê-lo limpa as três.
- **CA-ATR-009** Excluir um ator que está numa fila de combate ativo é recusado pelo servidor, e a
  interface explica que há combate em andamento.
- **CA-ATR-010** Dois goblins importados do mesmo pack com o mesmo nome são distinguíveis na
  interface e não se deduplicam entre si.
- **CA-ATR-011** Renomear "Goblin" para "Grubber" não quebra a presença dele na cena, o vínculo do
  familiar, nem o conhecimento registrado sobre ele.
- **CA-ATR-012** Um familiar cujo `masterActorId` aponta para um NPC é aceito pelo servidor, e um
  familiar sem `masterActorId` nenhum também.
- **CA-ATR-013** Dar OWNER de um NPC a um jogador não faz a vida dele aparecer para os outros
  jogadores.
- **CA-ATR-014** Uma escrita que tentasse deixar um ator sem faceta nenhuma é recusada pelo
  servidor.
- **CA-ATR-015** Um mundo criado antes desta spec, ao ser aberto, tem os atores migrados e um
  relatório do que foi corrigido.
- **CA-ATR-016** A regra do `tools/boundary-test` reprova uma comparação de subtype contra literal
  de sistema em engine, servidor ou cliente.

## 10. Questões em aberto

- **Q-ATR-01** "Comerciante" é uma quinta faceta ou é a faceta `container` com regras da `46`?
  _Posição atual: é `container`; comércio é o que a `46` oferece sobre ela, não outro papel. Se a
  `46` provar o contrário, a faceta entra por emenda aqui (RNF-ATR-02)._
- **Q-ATR-02** Um recipiente pode existir fora de uma cena (um baú "de estoque", sem presença)?
  _Posição atual: pode, por REQ-ATR-073, mas nenhuma tela o alcançaria — o que torna a resposta
  acadêmica até a `46` existir._
- **Q-ATR-03** A recusa de exclusão com combate ativo (REQ-ATR-041) vale também para combate
  **encerrado mas ainda arquivado**? _Posição atual: não; encerrado é histórico, e histórico tolera
  referência pendente (REQ-ATR-044)._
- **Q-ATR-04** Quem gera o `sourceId` de um ator criado do zero — o cliente que pede ou o servidor
  que persiste? _Posição atual: o servidor, pela mesma razão de toda autoridade ser dele; falta
  confirmar contra o caminho de criação otimista._
- **Q-ATR-05** `flags.fusion.sourceId` é usado por `31` e `34` e não é definido por spec nenhuma.
  Esta spec fixa a regra para ator; a definição geral (formato, unicidade, quem preenche) segue sem
  dona. _Candidata natural: `16`._
- **Q-ATR-06** O vazamento de vida de criatura pelas barras de recurso da presença (Q-CBA-02,
  REQ-CNV-090) é fechado por redação no servidor. _Posição atual: é da `21` (REQ-SEC-020), que já é
  dona da redação por papel; esta spec entrega o predicado (`hasFacet(actor, "creature")`) e não a
  política._

## 11. Referências

- `specs/02-modelo-de-dados.md` — REQ-DOC-009, REQ-DOC-010, REQ-DOC-018/020/023, REQ-DOC-027..030,
  REQ-DOC-031..035, DEC-DOC-08.
- `specs/15-api-de-sistemas.md` — REQ-SYS-010..015, REQ-SYS-042.
- `specs/39-contatos.md` — DEC-CTT-01, DEC-CTT-02, DEC-CTT-03, DEC-CTT-06, REQ-CTT-060..076.
- `specs/40-aba-combate.md` — DEC-CBA-03, DEC-CBA-06, Q-CBA-02.
- `specs/42-aba-npcs.md` — DEC-NPC-02, DEC-NPC-05..10, DEC-NPC-12, DEC-NPC-13, REQ-NPC-044,
  CA-NPC-007, Q-NPC-04, Q-NPC-05, Q-NPC-06.
- `specs/29-pets-companions-familiars.md` — REQ-PET-002, REQ-PET-003.
- Código consultado (branch `alfa/app`, 2026-08-16): `systems/{pf2e,sf2e,etmos}/src/index.ts`
  (subtypes declarados hoje); `packages/client/src/lib/sheets/pf2e/spellCastCardVM.ts`,
  `packages/client/src/lib/compendium/compendiumBrowser.ts` e
  `packages/client/src/components/actors/ActorDirectory.svelte` (os três lugares onde a pergunta
  desta spec é hoje respondida por string literal).

## 12. Emendas que esta spec obriga

Registradas aqui para que o PR não deixe nenhuma spec contrariada em silêncio
(`CONVENCOES.md` §2):

| Spec            | O que muda                                                                                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONVENCOES.md` | §3 deixa de mapear nível por faixa de número. A faixa vira **sinal histórico**, e o nível passa a ser declarado no cabeçalho da spec. Motivo em DEC-ATR-01.                                                                                                                       |
| `15`            | **REQ-SYS-010** passa a exigir `facets` (lista não-vazia) no `SystemDataModelSpec` quando `documentType === "Actor"`, e a proibi-lo nos demais. O contract test ganha os casos de REQ-ATR-011.                                                                                    |
| `17`            | **REQ-PF2-115** e a tabela de Actor types perdem `vehicle` e `party` (DEC-ATR-10); a tabela ganha a coluna **Facetas**; `familiar` passa de ⏳ V2 para ✅ MVP, alinhando a `17` ao que a `29` e o código já praticam.                                                             |
| `27`            | O marco M6 deixa de listar os actor types `vehicle`/`party` (DEC-ATR-10) e registra que `familiar` é [MVP] pela `29`.                                                                                                                                                             |
| `40`            | **DEC-CBA-03** passa a usar "criatura" como a faceta `creature` desta spec, em vez de uma definição local. A regra não muda; a palavra ganha dona.                                                                                                                                |
| `42`            | O termo **"não-jogável" sai** e a aba passa a listar por faceta (DEC-ATR-06). O **baú é ator** com faceta `container`, permanecendo fora do diretório (DEC-ATR-09) — Q-NPC-04 e Q-NPC-05 fechadas. **REQ-NPC-044 e CA-NPC-007** deixam de excluir `familiar` da aba (DEC-ATR-18). |
| `39`            | "Contato" e "conhecido" passam a ser definidos sobre facetas (DEC-ATR-06), e a `39` deixa de ser a spec que decide quem é personagem.                                                                                                                                             |
| `02`            | Nada muda no modelo. Registra-se que as facetas de nascença são **resolvidas e nunca persistidas** (DEC-ATR-04) e que o delta ocupa `flags.fusion.facets` dentro do namespace já previsto (REQ-DOC-009/010).                                                                      |
| `05`            | Nada muda: **REQ-USR-025a**, que a `42` já obrigou, é exatamente REQ-ATR-030 + REQ-ATR-060. Registra-se que a palavra "personagem" ali passa a significar "ator com a faceta `player`".                                                                                           |
| `29`            | **REQ-PET-002** deixa de ter alvo restrito: o vínculo aceita qualquer ator, e a derivação do mestre (REQ-PET-003) passa a ser explicitamente do sistema (DEC-ATR-16, REQ-ATR-082).                                                                                                |
| `41`            | Nada muda — ela não existe. Registra-se que esta spec entrega a ela o que a presença **herda** (REQ-ATR-070/071), e ela pode se ocupar do que a presença **é**.                                                                                                                   |
| `46`            | Reservada por esta spec: dona do saque, do comércio e da permissão de abrir um recipiente (DEC-ATR-13, DEC-ATR-17).                                                                                                                                                               |
