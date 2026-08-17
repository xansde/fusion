# Spec 41 — Token · registro de decisões

> Insumo de trabalho, não spec. Vira `DEC-TOK-nn` quando a `41` for escrita.
> Companheiro de [`estudo-token.html`](estudo-token.html), que levanta os problemas, e de
> [`prototipo-token.html`](prototipo-token.html), que executa o modelo decidido e verifica
> sozinho um contrato de 18 expectativas. Este arquivo guarda o que foi **decidido**, com o que
> cada decisão obriga.
>
> Decisor: Alexandre · sessões de 2026-08-16 (D1–D30) e 2026-08-17 (D31–D33, revisão de D19/D22).

## Definição de trabalho

> **Token é a manifestação de um ator numa cena: a peça que ocupa um lugar no mapa, que
> pode se mover, que pode ser vista ou ocultada, e que pode servir de ponto de vista para
> quem a controla.**

Os três "pode" são deliberados: cobrem a armadilha que não enxerga, o baú que não anda e a
peça oculta que continua existindo.

Testada contra 12 casos (§ "Testes da definição", abaixo). **Passa em todos** — o único que a
quebrava (peça sem ator) foi proibido por D11, e a definição vale sem exceção. Dois casos
exigem afirmação explícita no texto (cardinalidade, acoplamento de montaria).

---

## Decisões fechadas

### D1 — A arte é sempre herdada do ator; o token não tem campo de arte

O token **não** carrega imagem. A arte exibida é a do **ator efetivo** — o `Actor` base
quando vinculado, base + delta quando desvinculado (o delta já carrega `img?`). Regra única,
sem exceção.

- **Resolve** a contradição das quatro grafias (`img` na `02`, `textureSrc` na `06`,
  `Token.texture.src` na `20`, `texture` no código) — por **eliminação do campo**, não por
  escolha de grafia.
- **Corrige um defeito latente:** hoje `buildTokenFromActorFields` **copia** `actor.img` para
  o token no momento do drop. Trocar a arte do ator não atualiza as peças já postas no mapa.
  Com a arte herdada, o problema não existe.
- **Obriga:**
  - `02` — remover `img` de `TokenData`.
  - `06` — remover `textureSrc` de `TokenView`.
  - `20` — emendar `REQ-AST-043`: o `AssetRef` de arte de criatura vive no `Actor`, não no Token.
  - código — `TokenDocumentSchema.texture` sai; `buildTokenFromActorFields` para de copiar.
- **Sem exceção**, agora que peça sem ator está proibida (D11): toda peça tem ator, logo toda
  peça tem de quem herdar arte.

### D2 — Disposição tem três valores: hostil, neutro, amigo

`secret` **não** é disposição. Ocultar uma peça é assunto de visibilidade, não de atitude.

- **Resolve** a contradição entre `-1 | 0 | 1` (`02` + código) e as quatro strings da `06`.
- **Obriga:**
  - `06` — emendar `REQ-CNV-027` e o tipo `Disposition` (cai `secret`).
  - código — `SECRET_RING_COLOR` sai. Ele é o fallback de "qualquer outro valor" e é o que
    pinta **token sem ator**: D2 apaga o primeiro caso, D11 apaga o segundo.
- **Não é corte de escopo:** ocultação já existe (`hidden` + redação server-side). O que foi
  recusado é misturá-la com atitude. Revisitável muito adiante, se a mesa pedir.

### D3 — Vida é do dono: corte em OWNER, em toda superfície

O jogador vê os pontos de vida dos **seus** personagens e sub-personagens. O Mestre vê os de
todos. O corte é **OWNER (3)** e vale igualmente em toda superfície que mostre vida — não há
regra diferente por tela.

- **Escala:** este é o nível de **exibição de overlay** (`REQ-CNV-031`, `REQ-CNV-089`), que
  consulta a escala de **posse** (`NONE`/`LIMITED`/`OBSERVER`/`OWNER`, `05` `REQ-USR-013`).
  A escala de posse não muda; o que foi decidido é onde o corte cai dentro dela.
- **Reverte a DEC-CNV-15**, que havia escolhido OBSERVER (2) com o argumento de que ler o HP
  do companheiro não exige poder editá-lo. O argumento continua válido em tese; a régua da
  mesa é outra.
- **O que sustentava OBSERVER caiu junto:** o principal motivo da DEC-CNV-15 era não esvaziar
  o painel de **Comitiva** (`28`, `REQ-HUB-043..045`). Esse painel **não existe nesta linha** —
  foi substituído pelas telas de **Combate** (`40`) e **Contatos** (`39`). Sem ele, o corte em
  OWNER não tira nada de ninguém.
- **Obriga:**
  - `06` — emendar a DEC-CNV-15 e o nível `observer` de `REQ-CNV-031`/`REQ-CNV-089`, que passa
    a significar OWNER. **Cuidado de redação:** manter o rótulo `observer` significando OWNER
    seria a pior das saídas; o nível deve ser renomeado junto com a semântica.
  - `28` — ver D-PEND-08: a spec inteira precisa de posição.
- **Segue em aberto (D-PEND-09):** "sub-personagem" é vocabulário novo, sem spec.

### D4 — O campo de visão do token chama-se `vision`

`sight` (nome usado pela `02`) é abandonado. `vision` é o que a `07` e o código já usam.

- **Obriga:** `02` — renomear `sight: TokenSightConfig` para `vision`, satisfazendo
  `REQ-VIS-093`, que já exigia ausência de divergência de tipos entre as duas specs.
- **Custo de implementação:** zero. O código já está correto.

### D5 — Targeting não é desta spec — vai para a TODO de Cenas

A marcação de alvo fica fora da `41`.

- **Ressalva registrada:** "Cenas" hoje é a spec `44`, que é a **aba da gaveta** (vitrine do
  que está no ar). Targeting é gesto de canvas, e não há spec de Cena-como-documento. Para o
  TODO não evaporar, registrar em `CONVENCOES.md` §7 (lacunas conhecidas), que é onde a
  própria `41` está registrada.
- **Estado atual, para quem pegar:** `REQ-CNV-039` (canvas) e `REQ-CBT-053/054` (combate)
  especificam o mesmo gesto sem citação cruzada; o código implementou pela `10`
  (`packages/server/src/combat/target-handler.ts`). Alvo marcado fora de combate — caso normal
  em exploração — não tem dona.

### D6 — O termo é **token**; o prefixo é `REQ-TOK-`

A `41` consagra a palavra "token" como termo canônico, e absorve "presença na cena" como a
tradução de mesa dela, não como sinônimo concorrente.

- **Por quê, e não o contrário:** as três specs que adotaram "presença na cena" (`42`, `44`,
  `45`) o fizeram **explicitamente porque a `41` não existia** — a `42` escreve, no glossário:
  _"O termo evita 'token', cujo conceito só será definido pela spec `41`"_. Não foi preferência
  de vocabulário; foi contorno de ausência de dono. Quando a dona existe, a razão do contorno
  desaparece.
- **Peso do outro lado:** 121 requisitos em 21 áreas já dizem "token"; o protocolo tem
  `token:move`, `token:preview`, `token:targeted` **no wire e implementados**; o código tem
  `TokenDocument`, `TokenSprite`, `TokenLayer`, `packages/client/src/lib/canvas/tokens/`; o
  número reservado já se chama "41 — Token" no `README.md` e no `CONVENCOES.md` §7. Consagrar
  "presença" obrigaria a renomear tudo isso ou a conviver com dois vocabulários — exatamente o
  defeito que a `45` veio corrigir.
- **Sem colisão técnica:** token de autenticação vive em `REQ-USR-`/`REQ-SEC-`; design token
  não tem requisito algum (é `--fusion-*` em CSS). Nenhum id muda.
- **Obriga:** `README.md` — acrescentar a linha `REQ-TOK-` ao registro de prefixos (regra
  `registro-de-prefixos` do `spec-lint`) **no mesmo commit** que criar a spec. As citações de
  "presença na cena" em `42`/`44`/`45` permanecem válidas e passam a apontar para a `41`.

### D7 — O tamanho da peça é herdado do ator; a conversão é do sistema

O footprint **não** é dado do token. O ator sempre carrega o requisito de tamanho, e a
conversão de tamanho para células é **definição do sistema de jogo**:

- PF2e: Médio = 1x1, Grande = 2x2, e assim por diante.

- **Obriga:**
  - `15` — ponto de extensão novo: o sistema declara o mapeamento tamanho → células. A engine
    não arbitra (mesma disciplina de `REQ-SYS-004` para barras e iniciativa).
  - `06` — `REQ-CNV-023` (snapping multi-célula) continua valendo; o que muda é **de onde vem**
    o número de células.
  - código — issue #167.
- **Consequência coerente com D1:** identidade e forma vêm ambas do ator; o token guarda
  posição e estado de peça. Reforça a definição de trabalho ("token é endereço, não identidade").
- **Fica em aberto:** o que acontece quando a criatura muda de tamanho em jogo (magia de
  crescimento). Se o footprint é sempre derivado, muda sozinho — o que provavelmente é o
  comportamento certo, mas precisa ser afirmado.

### D8 — Vínculo é **configuração da peça**, não regra do tipo de ator

Token é **representação**. O caso dos seis goblins (cada peça com a própria vida) é o
**default**, não a lei: pode calhar de um jogador ter duas peças que dividem a mesma vida, e
isso tem de ser alcançável configurando a peça.

- **Consequência:** `REQ-DOC-061` (NPC nasce desvinculado, o resto vinculado) continua válido
  **como default de criação** — e nada mais. A regra não pode ser derivada do subtype em tempo
  de leitura, nem travada depois de criada.
- **Promove `REQ-CNV-093` a requisito de verdade:** o controle de vínculo na tela ("usar ficha
  própria para esta peça" / "vincular à ficha do ator") deixa de ser refinamento — sem ele, a
  configuração decidida aqui é inalcançável da mesa. Ele também já exige que religar **não**
  apague o delta: religar é reversível, e apagar na passagem tornaria a decisão irreversível
  em silêncio.
- **A confirmar na redação:** "duas fichas que compartilham o HP" foi lido como **duas peças
  do mesmo ator, ambas vinculadas** — que é o comportamento natural do vínculo. Se a intenção
  era **dois atores distintos** com pool de vida comum, isso é outro mecanismo (vínculo
  ator↔ator, na vizinhança de `masterActorId`) e não é `actorLink`.

### D9 — A spec descreve o modelo certo; a `build/app` está fora de escopo

A `41` é escrita contra o **modelo pretendido**, não contra o que roda hoje na `alfa/app`. O
que faltar vira issue de implementação.

- **Fundamento:** `specs/README.md` — _"A spec é a definição do objetivo. Se o comportamento
  não a cumpre, ou a spec está desatualizada, ou a funcionalidade não foi cumprida
  corretamente — nunca 'é assim mesmo'."_
- **`build/app` sai da conta:** é esteira paralela de desenvolvimento e não colide com esta
  linha. O §6 do estudo fica como registro histórico — útil para quem implementar, irrelevante
  para o que a spec decide. **Nenhum requisito da `41` deve mencionar branch.**

### D30 — Forma persistida: herda o adiamento do banco, e escreve o gatilho

A peça continua **embutida na cena** (JSON na linha do pai, `03` DEC-PER-02). A `41` **não**
decide tabela própria — herda a decisão da sessão de banco de dados, que é o próprio
adiamento.

- **O que a sessão de banco decidiu** (`docs/design/banco-de-dados/tasks.md`): a forma do
  estado quente está em "Adiado com gatilho explícito", e o princípio que rege o plano inteiro
  é textual: _"decisão irreversível só onde o conceito está fechado. Onde não está — token,
  forma do estado quente —, faz-se o reversível e prepara-se o terreno para a decisão futura
  sair barata."_
- **O gatilho registrado lá:** destrava quando _"a spec de Token existir **e** os números de
  T016 estarem na mão"_. **A primeira metade é esta spec.** A segunda falta: há medição de
  bancada (~58× com 1 peça, ~1000× projetado com 30 —
  [#169](https://github.com/xansde/fusion/issues/169)), não de sessão real.
- **A `D2` do banco já rebaixou a urgência:** mundo enxuto (regras no compêndio, mídia fora do
  banco) mantém `world.db` pequeno. E D24 desta sessão encolhe mais: sem paredes e luzes, a
  linha da cena fica bem menor. O problema diminui — não some, porque toda peça continua sendo
  reescrita a cada movimento.
- **O que a `41` escreve:** que a forma é embutida hoje, que a revisão está condicionada, e
  **qual é a condição** — medir uma sessão real com o número de peças que a mesa usa de
  verdade. Escrever o gatilho é o que impede o adiamento de virar esquecimento, que é
  exatamente o que produziu esta lacuna.

### D31 — O nome não é nível de exibição: é conhecimento

Quem vê a peça sabe o nome do ator **se conhece aquele ator**. Se não conhece, não recebe o nome.
O corte é o modelo de conhecimento da `39` (par contato × personagem), não um campo da peça.

- **A consequência mais forte é uma subtração:** a `41` deixa de ter **qualquer** regra de nome.
  O nome é herdado do ator (D16); o que o cliente sabe do ator é decidido pela `39` e redigido
  pela `21`. A peça não participa. Some o `displayName`, some o enum, some a pergunta "qual o
  default".
- **A redação muda de objeto.** Hoje a `41` redige a **peça** (`hidden`, D21). Isto redige o
  **ator**: o mesmo `Actor` chega nomeado para uns e anônimo para outros. É superfície nova, e
  não é desta spec — é da `21`. A `41` só afirma que herda o que chegou.
- **Não conflita com D16, conclui-a.** D16 alertava que nome de peça e conhecimento seriam dois
  mecanismos concorrentes de "você não sabe quem é este". Com D31 sobra um só: o conhecimento
  decide o que você pode saber, e o rótulo na peça é o que o Mestre escreve por cima
  ("Encapuzado"). Papéis distintos, sem disputa.
- **Registrar a fronteira do que isso esconde:** a arte é herdada e sempre visível (D1). Esconder
  o nome "Kobold" de quem está vendo o desenho de um kobold não esconde grande coisa. Onde a
  regra ganha é no NPC nomeado — "Lorde Vashra" contra uma figura encapuzada. Vale a spec dizer
  isso, para ninguém supor que o nome protege identidade sozinho.
- **Duas perguntas abertas**, ambas no protótipo:
  - **Conhecimento de quem?** O modelo da `39` é por par contato × personagem; quem olha a cena é
    o **usuário**. Proposta: conhece se **qualquer** personagem dele conhece.
  - **Qual o default?** O protótipo assume **fechado** — e por isso o baú aparece sem nome, o que
    provavelmente não é o desejado. A alternativa é abrir por faceta: criatura fecha, objeto abre.

### D32 — Exibir nome e barra na cena é preferência do usuário

Separadas as três camadas: o **servidor** decide o que você *pode* ver (posse para vida,
conhecimento para nome), a **peça** guarda posição e vínculo, e o **usuário** escolhe, em
configurações, se quer aquilo desenhado na tela.

- **A preferência só subtrai.** Ela nunca revela o que a redação não mandou — desligar limpa a
  tela, ligar não abre nada. Isso precisa estar escrito, ou alguém vai implementá-la como um
  filtro que "mostra tudo" no cliente.
- **Não é dado da peça nem do mundo:** é preferência de usuário, do mesmo tipo das de acesso
  (`23`). Some `displayName`/`displayBars` do modelo da peça — que é o que estava puxando a
  `41` para uma decisão que nunca foi dela.
- **Custo zero de rede:** o payload é idêntico com a preferência ligada ou desligada. O
  protótipo verifica isso automaticamente (E8) justamente para impedir que vire filtro de
  servidor por engano.
- **Obriga:** `06` — `REQ-CNV-031` e `REQ-CNV-089` perdem o enum e passam a citar posse e
  conhecimento; o bloco TypeScript da própria spec cai junto.

### D33 — Mover é pelas setas

O gesto de movimento é o **teclado**: setas movem a peça selecionada, uma célula por vez. A
permissão continua sendo a de D27 — só move quem é OWNER do ator —, e a checagem é do servidor.

- **A `23` ganha acessibilidade de graça.** `REQ-A11-036` exige alternativa não-arraste para toda
  ação de arraste. Com as setas como gesto canônico, a alternativa não é um acréscimo: é o
  caminho principal.
- **Sobra decidir o que acontece com o arraste.** Se ele deixa de mover, a `41` fica com um gesto
  só e o arraste concorrente (D26) some como problema desta superfície. Se fica, são dois
  caminhos para o mesmo efeito. **Pendente.**
- **Diagonal, pendente.** Quatro direções numa grade quadrada dobram o número de teclas para
  atravessar uma sala. A saída natural é duas setas simultâneas — decidir antes de escrever.
- **Não confundir com passo de regra.** "Uma célula por tecla" é gesto de interface. Quanto a
  criatura *pode* andar é do sistema (`15`) e do combate (`10`); a `41` não conta deslocamento.

### D27 — Controlar é ser dono do ator. Só isso.

A peça **herda a posse do ator** que ela manifesta. Quem é OWNER do ator, controla a peça — e
não existe conceito próprio de "controle de token".

- **Não é conceito novo, é uma afirmação única.** O mecanismo (ownership do `Actor`,
  `REQ-DOC-025`, DEC-CNV-15) já existe e já funciona. O que faltava era um lugar dizendo isso
  em vez de três telas re-derivando — e uma delas derivou errado
  ([#164](https://github.com/xansde/fusion/issues/164)).
- **Sobrou um consumidor só: mover.** Visão saiu (D24); minimapa não existe; e o chat deixa de
  perguntar (abaixo). O "cinco telas consomem" que motivava a pergunta encolheu para uma.
- **Emenda obrigada na `09`:** `REQ-CHT-022` hoje resolve o `speaker` de uma mensagem por
  "token controlado pelo usuário na cena ativa". **Quem fala é o jogador, nunca a peça** — o
  requisito precisa ser reescrito. Ficam pendurados no mesmo fio os chat bubbles
  (`REQ-CHT-041`/`043`), que existem para aparecer acima da peça de quem falou; se o falante
  não é a peça, eles perdem a âncora. _Não é decisão da `41` — é sinalização para a `09`._

### D28 — Ícones de status ficam fora da peça

A `41` não define ícones de condição na peça. A direção é um espaço dedicado na **HUD**, e a
decisão fica para quem for dono dessa tela.

- **Obriga:** `06` — `REQ-CNV-029` (ícones de status agrupados num canto do token) perde a
  base e precisa ser emendado ou aposentado.
- **Não afeta o registro de condição:** `REQ-SYS-043` (`15`) continua registrando `img`,
  `tone` e `help` — o que muda é **onde** isso aparece, não que exista.

### D29 — O sistema pode declarar dado próprio de peça, via `flags` namespaced

Um sistema — e, no futuro, um addon — pode pendurar dado próprio numa peça. O mecanismo é o
que já existe: `flags` com namespace (`REQ-DOC-009`).

- **Nada de campo novo no schema.** `flags` é exatamente o ponto de extensão para isso, é
  namespaced por design, e a engine **não interpreta** o que está lá dentro — o que também é
  a garantia de que um addon não quebra o núcleo.
- **A `41` afirma duas coisas:** que a peça aceita, e que a engine não lê. Nada além.
- **Tensão registrada, não resolvida:** `REQ-ESC-012` (`00`) fixa sistemas como pacotes
  compilados e trata plugin dinâmico como [V2], e a **API de Módulos/Mods** é lacuna sem número
  no `CONVENCOES.md` §7. "Tudo facilmente modificável por addon" é uma diretriz maior que esta
  spec; a `41` só garante que a peça não fecha a porta.

### D24 — A `41` não fala de visão nem de névoa; só deixa o lugar pronto

Visão, campo de visão, névoa e iluminação **saem do escopo desta spec**. A peça declara que
**pode** ter visão e luz; o que isso faz é de uma spec de visão que hoje não vale.

- **O que a `41` faz:** mantém `vision` e `light` no modelo como declaração inerte (D4 já fixou
  o nome), sem definir comportamento, sem citar `REQ-VIS-*` como requisito seu, e sem herdar a
  frase "pode servir de ponto de vista" como se fosse mecanismo. _"Deixa pronto para quando
  isso existir."_
- **Reformula a definição de trabalho.** O terceiro "pode" passa a ser declaração de lugar
  reservado, não de funcionalidade viva.
- **Alcance maior que esta spec — decisão à parte.** Visão/névoa está escrita como **[MVP]** em
  três lugares: a spec `07` inteira, o MVP global de `00` (`REQ-ESC-006/007`), o marco M2 de
  `27` — e no `CLAUDE.md` do projeto. Tirar de verdade significa emendar os quatro, e o defeito
  [#164](https://github.com/xansde/fusion/issues/164) (visão do jogador nunca abre) deixa de
  ser defeito e vira código a remover. **Isso não é decisão da `41`** e fica registrado aqui
  como pendência de escopo do projeto, não desta spec.

### D25 — Movimento valida permissão; colisão sai

A `41` define **quem pode mover** e nada mais sobre validação. Colisão com parede sai junto com
D24.

- **O que sobra no `token:move`:** a checagem de permissão (quem controla — P13) e a posição
  final. Sem parede, sem elevação, sem distância máxima.
- **Consequência nas issues:** [#166](https://github.com/xansde/fusion/issues/166) (colisão
  ignora footprint) deixa de ser defeito a corrigir e passa a ser código a remover, junto com
  D24. **A confirmar** antes de fechar a issue.

### D26 — Concorrência de escrita não é desta spec

Arraste simultâneo, trava efêmera e last-writer-wins são problema de **servidor e rede**, não
de token.

- **Onde vive:** Q5 da `04` (aberta desde a primeira redação) e o plano de banco
  ([#169](https://github.com/xansde/fusion/issues/169)). A `41` não a herda nem a cita como
  requisito seu.

### D21 — Ocultação é por usuário

Uma peça pode estar oculta para uns e visível para outros: só um personagem enxerga aquela
armadilha. Abre espaço para percepção passiva no futuro.

- **Forma proposta:** `hidden: boolean` permanece como "está oculta", e ganha ao lado a lista
  de exceções — quem, apesar disso, a enxerga. Aditivo: o predicado de redação passa de
  "é privilegiado?" para "é privilegiado **ou** está na lista?", e nada mais muda.
- **Custo baixo por sorte de arquitetura:** a emissão de `Scene` já é **por socket**
  (`broadcastToWorld` redige individualmente), então redigir por usuário não exige caminho
  novo — só um predicado que conhece o `userId`, que o socket já tem.
- **A lista é escrita por gesto do Mestre hoje, e por regra de sistema amanhã.** É o gancho da
  percepção passiva: quem passou no teste entra na lista. O mecanismo precisa nascer aberto a
  um escritor que não seja humano — mas a `41` **não** define teste, CD nem automação: isso é
  do sistema (`15`) e da futura regra de percepção.
- **Ocultar ≠ não estar vendo, e a diferença é de segurança:** `hidden` é decisão, redigida no
  **servidor** — a peça não chega ao cliente. Estar fora do campo de visão é cálculo do
  **cliente** (DEC-VIS-02): a peça **chega** e é escondida na tela. São mecanismos diferentes,
  com garantias diferentes, e a spec precisa dizer isso — senão alguém vai supor que o fog
  protege posição de inimigo, e ele não protege.

### D22 — Três níveis de exibição · **REVOGADA por D31/D32**

> **Superada em 2026-08-17.** O enum de níveis por peça deixou de existir: nome passou a ser
> governado por **conhecimento** (D31) e vida por **posse** (D3), e o que o usuário quer ver na
> tela virou **preferência de cliente** (D32). Nenhum dos dois é campo da peça. O registro abaixo
> fica como histórico do caminho — e a razão de tê-lo percorrido continua válida: os cinco níveis
> do Foundry não sobrevivem a nenhuma pergunta.

Os cinco níveis herdados do Foundry viram **três**, aplicados a nome e barras:

| Nível | Quem vê |
| --- | --- |
| `never` | ninguém — nem o Mestre |
| `owner` | quem é dono do ator (D3), mais papel privilegiado |
| `always` | todos que enxergam a peça |

- **O rótulo acompanha a semântica** (risco registrado em §10 do estudo): como D3 moveu o corte
  para OWNER, o nível chama-se `owner`. Manter `observer` significando OWNER seria a pior
  saída.
- **Caem os dois níveis de _hover_** (`hoverObserver`, `hoverAll`): herança do Foundry sem
  argumento próprio em spec nenhuma do Fusion, e dois estados a mais em cada superfície que
  desenha overlay.
- **Defaults propostos:** nome `always`, barras `owner`. Ou seja: quem vê a peça sabe como ela
  se chama; a vida é do dono.
- **Obriga:** `06` — `REQ-CNV-031` e `REQ-CNV-089` passam de cinco para três níveis, com o
  bloco TypeScript da própria spec corrigido junto (é onde a emenda da DEC-CNV-15 parou da
  última vez).

### D23 — Sub-personagem herda a autoria do personagem-pai; ganha spec própria

A posse de um sub-personagem é a **mesma do ator-pai**, herdada. Logo "os meus" (D3) resolve-se
por posse simples: os atores de que sou OWNER — sem regra nova de vínculo.

- **Confirma a saída barata** apontada em D-PEND-09: familiar, pet e companion entram em "os
  meus" porque **já nascem** com a ownership do jogador. _Falta verificar no código que nascem
  mesmo._
- **Número de spec reservado** para o conceito. **A confirmar antes de reservar:** a `29`
  (Pets, Companions e Familiars) já existe e cobre familiar/pet/companion/mount. Se
  "sub-personagem" é esse mesmo conjunto, o lugar é a `29` e não há número novo; se é um
  conceito mais amplo (qualquer ator subordinado a um personagem, com posse derivada), aí sim
  toma o próximo livre — hoje o **47** (33, 41 e 46 já estão reservados).

### D18 — Não há ajuste visual por peça

`scale`, `mirrorX`, `mirrorY`, `tint` e `alpha` **saem do modelo**. A peça mostra a arte do
ator como ela é; quem quiser um goblin maior e mais escuro faz outro ator.

- **Obriga:** `06` — emendar `REQ-CNV-026` e o tipo `TokenView` (DEC-CNV-07 perde a metade da
  "escala visual independente do footprint"; o footprint em si continua, derivado do ator por
  D7).
- **Custo zero de implementação:** nenhum dos cinco campos existe no código hoje.
- **Coerente com D1:** a arte é do ator, inteira. Um campo de ajuste seria uma segunda fonte
  de verdade sobre aparência, e a primeira coisa a divergir.

### D19 — Ring dinâmico fica para protótipo; a borda por disposição permanece

O **ring estilizado** (camadas subject/ring/background dirigidas por estado de jogo — turno,
saúde) sai desta rodada e volta como protótipo visual mais adiante. `REQ-CNV-033` já o marcava
[V2]; isto confirma.

- **A borda colorida por disposição continua** (`REQ-CNV-027`, [MVP], já implementada). Sem
  ela, a disposição decidida em D2 vira dado sem nenhuma exibição — hostil e amigo ficariam
  indistinguíveis no mapa. **Confirmado em 2026-08-17:** a borda fica; o ring dinâmico não volta
  nesta rodada.

### D20 — Peças sobrepostas desenham em FIFO

Ordem de criação: a mais antiga embaixo, a mais recente por cima. **Sem campo de ordenação** —
a ordem é a da própria coleção.

- **Nada muda no schema:** é o comportamento atual (ordem de array), agora afirmado em vez de
  acidental. Tiles e drawings seguem com `sort` próprio; peça não ganha um.
- **Aceita o custo:** o Mestre não tem como trazer uma peça para frente sem recriá-la. Trocado
  de propósito por simplicidade.
- **A afirmar na redação:** a ordem tem de ser **estável e igual em todos os clientes**. Como
  a coleção é persistida como array, isso já vale — mas o caminho genérico de `doc:update`
  substitui a coleção inteira com a ordem que o requisitante mandar (T031, em andamento). A
  regra de FIFO é uma razão a mais para aquela guarda existir.

### D16 — O nome é herdado do ator e pode ser sobrescrito na peça

Naturalmente herdado; a peça pode carregar um nome próprio que prevalece. Confirma o que D10
já previa (`name` entre os campos sobrescrevíveis).

- **O nome próprio é rótulo, NÃO é ocultação — e a spec precisa dizer isso.** Escrever
  "Encapuzado" no nome da peça é uma escolha de exibição, visível a quem vê a peça; **não**
  protege a identidade do ator por trás. Quem decide o que o jogador sabe sobre quem é aquele
  ator continua sendo o modelo de conhecimento da `39` (par contato×personagem) com a redação
  da `21`.
- **Sem isso, nascem dois mecanismos concorrentes** de "você não sabe quem é este" — o nome da
  peça e o conhecimento — e eles divergem no primeiro caso em que o Mestre renomear achando
  que está escondendo. Registrar a fronteira é o que impede a duplicação.
- **Não conflita com o "???" do combate** (`REQ-CBT-041`): aquilo é combatente marcado como
  oculto, decisão da `10`, e não passa pelo nome da peça.

### D17 — Distinção entre peças do mesmo ator é configuração do Mestre

O Mestre escolhe se peças do mesmo ator ganham **numeração** ("Esqueleto 1..6") ou ficam
**todas com o mesmo nome**.

- **É um setting**, não regra fixa da engine. Candidato natural: setting de **mundo**, na `37`
  — mesmo tratamento que a regra variante recebeu.
- **Age no nascimento** (D10): a numeração é o **valor inicial** do nome derivado, não um
  campo separado. Como o nome é sobrescrevível (D16), o Mestre renomeia depois se quiser.
- **A definir na redação:** a numeração é por cena ou por mundo, e o que acontece com o número
  quando uma peça some — se o Esqueleto 3 morre, o próximo nasce 3 (reaproveita o buraco) ou 7
  (contador só cresce)? A segunda é mais barata e não confunde a mesa com dois "Esqueleto 3"
  ao longo da sessão.

### D12 — A peça não some sozinha; morrer é assunto do ator

Quando um personagem morre ou foge, a peça dele **some ou vira recipiente de saque**. Nos dois
casos, **não é a peça que decide** — a `41` não faz nada acontecer por conta própria.

- **Virar recipiente já está resolvido pela `45`:** o corpo caído ganha a faceta `container`
  sem deixar de ser a criatura que era (DEC-ATR-03/05, facetas adquiridas). **A peça não
  muda** — o mesmo token continua no mapa; o que mudou foi o ator. É a confirmação mais forte
  da definição de trabalho: token é endereço, não identidade. O que se **faz** com o
  recipiente é da `46`.
- **Sumir é gesto**, não consequência automática: alguém remove a peça. A `41` não apaga peça
  por morte.
- **A fila de iniciativa é da `10`/`40`, e esta spec não a toca.** Fica registrado apenas que
  a referência `Combatant → tokenId` é soft (DEC-DOC-11): sumir a peça **não pode** quebrar o
  encontro; quem decide o que a fila faz é a spec de combate.
- **O chat é histórico e não se reescreve.** As mensagens que a peça originou seguem
  existindo com o estado que ela tinha **no momento da mensagem** — o `speaker` da `09` já
  guarda `alias` (o nome de então) além do `tokenId`. Apagar a peça deixa a referência
  pendente, e isso é o comportamento correto: é literalmente o exemplo que a DEC-DOC-11 usa
  para justificar soft reference.

**Resíduo aberto:** *quem* pode excluir uma peça. Proposta: **quem pode criá-la** — papel
privilegiado, mais o dono do ator sobre as peças do próprio ator. Corrigir se a régua for
outra.

### D13 — Excluir o ator apaga as peças dele

Excluído o ator, **todas as peças dele somem** — em todas as cenas.

- **Decorre de D11:** peça sem ator é proibida, logo peça órfã não é um estado possível.
  Deixá-la apontando para o nada criaria por construção o caso que D11 acabou de banir.
- **É uma exceção deliberada à DEC-DOC-11**, e precisa ser escrita como tal. A regra geral do
  projeto é soft reference com degradação graciosa — e ela **continua valendo para o chat**
  (D12). A peça é diferente da mensagem: a mensagem é histórico de algo que aconteceu; a peça
  é uma afirmação presente de que aquele ator está ali. Com o ator fora, a afirmação é falsa.
- **Custo de implementação a registrar:** a exclusão passa a varrer as cenas do mundo, não só
  a ativa, e cada cena tocada emite broadcast. Não é uma deleção de linha só.
- **Não conflita com a `45`:** `REQ-ATR-041` já recusa excluir ator com combate ativo — a
  cascata só roda no caso em que a exclusão é permitida.

### D14 — Duas cópias: crua e idêntica

Duplicar uma peça tem **dois modos**:

| Modo | Gesto sugerido | O que copia |
| --- | --- | --- |
| **Crua** | `Ctrl` + arrastar | a peça como se acabasse de nascer — estado vivo zerado (vida cheia) |
| **Idêntica** | `Ctrl` + `Alt` + arrastar | a peça como está, estado vivo incluído |

- **Refina `REQ-CNV-041`**, hoje [V2] e prevendo só um gesto.
- **O gesto é da `06`; os dois modos são desta spec.** Mesma disciplina de D10: a `41` diz que
  existem duas cópias e o que cada uma leva; qual tecla as invoca é da tela. E a `23`
  (`REQ-A11-036`) exige alternativa não-arraste para toda ação de arraste — agora são duas.
- **A distinção só existe para peça desvinculada.** Uma peça vinculada não tem estado vivo
  próprio: a cópia lê o mesmo ator, com a mesma vida. "Cópia crua" de peça vinculada não tem
  como nascer com vida cheia sem curar o ator inteiro. A spec precisa dizer o que faz nesse
  caso — a saída natural é os dois gestos colapsarem em um só quando a peça é vinculada.

### D15 — `locked` não existe

Peça travada sai do modelo.

- **Obriga:** `02` — remover `locked` de `TokenData`. O campo nunca chegou ao código, então
  não há nada a migrar.

### D11 — Toda peça exige ator (por ora)

Peça sem ator **sai do escopo desta rodada**. `actorId` é obrigatório: `null` é recusado.

- **Não é recusa definitiva, é adiamento deliberado.** A liberdade do Mestre criar uma peça
  avulsa ("token rápido" com vida, imagem e posição, para montar combate sem cerimônia) é
  desejável e será decidida com calma depois — fora da pressa desta spec.
- **O que fez adiar:** o "HP" da peça avulsa é o nó. Sem ator, a vida não tem onde morar
  senão dentro da `Scene`, que é estado compartilhado que todo jogador recebe — exatamente o
  problema que obrigou o `REQ-DOC-062` a redigir o `actorDelta` do payload. Junto com isso
  caem iniciativa (a fórmula roda sobre o ator), condições (são items/effects do ator),
  facetas (são do ator) e metade do `Combatant` (`REQ-CBT-002` referencia `tokenId` **e**
  `actorId`). São cinco mecanismos paralelos para um caso classificado como "não incentivado".
- **Quando voltar, a saída provável é o ator descartável:** o gesto de mesa é "criar rápido"
  — vida, imagem, pronto —, e por baixo nasce um ator mínimo com a peça vinculada a ele. O
  Mestre não vê diferença; o modelo não ganha exceção. A `45` já sabe tratar ator que não
  aparece em diretório (DEC-ATR-09, o baú).
- **Obriga:** o `TokenAddDialog` — hoje o caminho que cria peça sem ator — passa a exigir um
  ator, ou é substituído pelo arraste do diretório, que já cria vinculado. Vira issue quando
  a spec existir.
- **Destrava:** D1 (arte sem exceção), D2 (`SECRET_RING_COLOR` sai de vez), D7 (tamanho sem
  exceção) e o obrigatório de D10.

### D10 — Nascimento: herda tudo do ator por padrão; a origem pode sobrescrever

Ao nascer, a peça **herda as informações do ator**. A **origem** — a porta por onde ela é
invocada — pode **sobrescrever** o que precisar (o Mestre que prepara uma emboscada faz o
goblin entrar oculto).

**A `41` não define quem sobrescreve nem como.** Se a porta oferece um toggle, um diálogo ou
nada, é da spec daquela porta (`16`, `39`, `42`, `06`). A `41` define **o contrato de
invocação**: o que uma peça TEM que receber para existir, o que ela aceita como sobrescrita,
e o que ela recusa.

- **Encerra a dúvida "molde no ator vs. derivação na hora"**: nenhuma das duas. `prototypeToken`
  deixa de ser pré-requisito da `41` — se um dia existir, é fonte de defaults **do lado da
  origem**, não obrigação do contrato. A `16` (`REQ-CMP-018`) fica livre para citá-lo ou não.
- **Ainda registra a lacuna:** `PrototypeTokenData` é citado pela `02` (campo do `ActorDocument`)
  e duas vezes pela `16`, e **definido por spec nenhuma** — a `02` diz que ele é detalhado
  "nas specs de canvas/visão", a `06` não o define, e não existe no código. Não bloqueia mais
  a `41`, mas segue como citação que não resolve.

#### Contrato de invocação (proposto — a validar)

**Obrigatório — sem isto não há peça:**

| Dado | Por quê |
| --- | --- |
| `actorId` | quem está sendo manifestado. Obrigatório sempre (D11); `null` DEVE ser recusado. |
| `x`, `y` | onde. |
| cena | em qual — vem do embedding, não do payload. |

**Aceito como sobrescrita — se ausente, herda:**

| Dado | Herda de |
| --- | --- |
| `actorLink` | default por subtipo (`REQ-DOC-061`), configurável (D8) |
| `hidden` | default visível — a emboscada sobrescreve |
| `disposition` | do ator |
| `name` | do ator |
| `rotation`, `elevation` | zero |
| visão, luz | do ator |
| `bar1`, `bar2` | do sistema (`REQ-SYS-004`: `primaryBarAttribute`/`secondaryBarAttribute`) |

**Derivado — o servidor calcula e NÃO aceita do requisitante:**

| Dado | Regra |
| --- | --- |
| footprint (tamanho) | do ator, convertido pelo sistema (D7) |
| arte | do ator efetivo (D1) — o campo nem existe |
| ownership | não existe na peça; deriva do ator |

**Recusado explicitamente:**

| Dado | Por quê |
| --- | --- |
| `actorDelta` | só entra por `token:updateActor` (`REQ-DOC-034`), nunca pela criação |

> **Recusar, não ignorar em silêncio.** Vale aqui a lição da T025 registrada no plano de banco:
> _"o servidor lê" ≠ "o requisitante não escreve"_. Um campo derivado que o servidor recalcula
> mas aceita no payload é um campo que alguém vai escrever — e o teste que prova a derivação
> passa verde enquanto isso acontece. Os campos derivados e o recusado precisam de rejeição
> explícita e de teste que reproduza a escrita indevida.

---

## Defeitos registrados como issue

Levantados no `estudo-token.html` §5 e abertos em `xansde/fusion` em 2026-08-16. Nenhum é
tarefa da spec resolver; vários existem **porque** não há um lugar único que diga o que é
verdade.

| # | Defeito | Gravidade |
| --- | --- | --- |
| [#164](https://github.com/xansde/fusion/issues/164) | Visão do jogador nunca abre: "controle de token" tem duas implementações e a errada decide | alta |
| [#165](https://github.com/xansde/fusion/issues/165) | Barra de HP desenhada sempre cheia como placeholder (viola `REQ-CNV-090`) | alta |
| [#166](https://github.com/xansde/fusion/issues/166) | Colisão de parede ignora o footprint: peça grande atravessa | média |
| [#167](https://github.com/xansde/fusion/issues/167) | Token nasce sempre 1x1 e neutro: tamanho e disposição não herdados (fechado por D7) | média |
| [#168](https://github.com/xansde/fusion/issues/168) | `token:preview` (`REQ-NET-044`, MVP) só existe como literal no protocolo | baixa |
| [#169](https://github.com/xansde/fusion/issues/169) | `token:move` reescreve a coleção inteira: ~58x de amplificação medida | média |
| [#170](https://github.com/xansde/fusion/issues/170) | `ActorDragPayload.uuid` carrega um `_id`, não um UUID | baixa |
| [#171](https://github.com/xansde/fusion/issues/171) | `REQ-NPC-061` contradiz DEC-ATR-09: a emenda do baú não desceu ao requisito | baixa |

---

## Decisões pendentes

### D-PEND-08 — A referência órfã à Comitiva, herdada pela `40`

**Metade resolvida.** O painel de **Comitiva** (`28`, `REQ-HUB-043..045`) não existe nesta
linha — foi substituído pelas telas de Combate (`40`) e Contatos (`39`). Duas specs vivas se
apoiavam nele:

- `39:471` — Contatos **deixou de exibir vida** para não disputar com a Comitiva.
  **→ Fechado: está correto assim.** Vida de personagem aparece em combate e na ficha, não no
  diretório de contatos. A `39` não precisa de emenda.
- `40:104` e `40:478` — Combate cita a Comitiva como **referência** de que vida de personagem
  é exibida. **→ Segue pendente**, e é da `40`.

A `40` está adiada por falta de pré-requisitos. A pendência foi anotada onde será encontrada
na retomada: `docs/design/gaveta-lateral/tasks.md`, cabeçalho da **Fase 4 — Aba Combate**.
São duas coisas a resolver lá: a referência órfã (quem é dona da regra de exibição de vida) e
o corte que mudou para OWNER por D3, que afeta `combatVisibility.ts` e a Q-CBA-02.

**Resíduo para a `41`:** ela pretendia citar `REQ-HUB-045` como precedente do corte
server-side. O precedente **não está de pé nesta linha** — o argumento continua correto (o
recorte vem do ownership do Actor e é feito no servidor), mas a `41` deve citá-lo pelo que ele
é: uma decisão da `28`, cuja superfície não existe aqui. Melhor ancorar em `REQ-NET-096` e
`REQ-DOC-062`, que estão vivos e implementados.

### D-PEND-09 — "Sub-personagem" precisa de definição

Vocabulário novo, introduzido em D3, sem spec. O modelo mais próximo é o companion com
`masterActorId` (`29`, `REQ-PET-002`). Duas formas de mecanizar:

- **Por posse (simples):** "os meus" = os atores de que sou OWNER. Familiar, pet e companion já
  entram, **desde que nasçam com ownership do jogador** — o que precisa ser verificado.
- **Por vínculo (regra nova):** "os meus" = OWNER do ator **ou** OWNER do `masterActorId` dele.
  Só necessário se o companion puder existir sem ownership do dono.

Recomendação: a primeira, se a verificação confirmar. Regra nova só se o modelo obrigar.

### D-PEND-10 — Três níveis de exibição bastam? · **RESPONDIDA: nenhum nível**

Fechada por D31/D32: não há enum. Nome sai por conhecimento, vida por posse, e o resto é
preferência do cliente. Os cinco níveis do Foundry saem inteiros — não por corte, por não haver
onde encaixá-los.

### D-PEND-11 — O arraste continua movendo? · aberta

D33 fez das setas o gesto de mover. Falta decidir se o arraste sobrevive como atalho. Ver a
pendência 1 do protótipo.

### D-PEND-12 — As setas andam na diagonal? · aberta

Quatro direções ou oito. Ver a pendência 2 do protótipo.

### D-PEND-13 — Conhecimento: de quem, e qual o default? · aberta

As duas perguntas registradas em D31. O protótipo assume "qualquer personagem do usuário" e
default fechado, e mostra o efeito colateral do fechado no baú sem nome.

### D-PEND-02 — Cardinalidade

Quantas peças do mesmo ator por cena? (seis esqueletos dizem "várias"). Ator sem peça é normal
(`45`, `REQ-ATR-073`). O mesmo ator com peça em três cenas é normal. Nada disso está afirmado
em requisito.

### D-PEND-03 — Forma persistida: embedded na cena ou tabela própria?

A `03` (DEC-PER-02) decidiu embedded como JSON no pai. O plano de banco adiou a revisão **com
gatilho explícito nesta spec**, e metade do gatilho chegou: a T016 mediu ~58x de amplificação
de escrita por `token:move` com 1 token, projetando ~1000x com 30 (issue #169). Falta a outra
metade — números de uma sessão real.

### D-PEND-05 — Ícones de status: onde vivem?

`REQ-CNV-029` manda exibir, `REQ-SYS-043` registra a condição com `img`/`tone`/`help`, e
`TokenData` não tem campo nenhum. Se derivam das condições do ator, o token desvinculado
(cujas condições são do ator base enquanto `REQ-DOC-035` for [V2]) mostra as de quem?

### D-PEND-06 — Ordem de desenho entre peças sobrepostas

Tiles e drawings têm `sort`; tokens não têm nada, e `elevation` hoje só pinta um badge. Duas
peças na mesma célula desenham em ordem de array.

### D-PEND-07 — Arraste concorrente: trava efêmera ou last-writer-wins?

Q5 da `04`, aberta desde a primeira redação e delegada "ao time de canvas". Com o array inteiro
de tokens reescrito a cada `token:move`, dois jogadores movendo tokens **diferentes** na mesma
cena já disputam a mesma linha do banco.

---

## Testes da definição

| Caso | Veredito | Nota |
| --- | --- | --- |
| Corpo caído / saqueável | ✅ | Melhor caso a favor: o ator ganha a faceta `container` e **a peça não muda**. Token é endereço, não identidade. |
| Baú | ✅ | É ator com faceta `container` (`45`, DEC-ATR-09). Contradição viva encontrada → issue #171. |
| Perigo / armadilha | ✅ | Tem ficha e ocupa lugar. Prova que ser fonte de visão é **opcional**, não constitutivo. |
| Familiar / companion | ✅ | Ator completo com peça própria; o vínculo (`masterActorId`) é entre **atores**, não entre peças. |
| Montaria | ✅ | Duas criaturas, duas peças. O **acoplamento de movimento** fica em aberto ([V2] pela `29`). |
| Veículo | ✅ | Eliminado de graça: "veículo não existe no Fusion" (`42`, DEC-NPC-05). |
| Invocação temporária | ✅ | Criatura como outra qualquer. |
| Mesmo ator, várias peças na cena | ✅ | Passa, mas exige afirmação de cardinalidade (D-PEND-02). |
| Mesmo ator em várias cenas | ✅ | Normal. Confirma que a peça é **por cena**, não do ator. |
| Parede, luz, som, desenho, template, nota, overlay, tile | ✅ | Têm posição, não manifestam ator. Corte limpo. |
| POI de mapa de região (`34`), avatar LPC (`35`) | ✅ | Fora. A `35` já se declara fora explicitamente. |
| Chat bubble, turn marker, retícula de alvo | ✅ | Não são peças — são adornos ancorados numa. |
| **Token sem ator** | 🚫 | Único caso que quebrava a definição — **proibido por D11**, adiado para decisão com calma. Com ele fora, a definição vale sem exceção. |
