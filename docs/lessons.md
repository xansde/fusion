# Lições do Fusion

Aprendizados que custaram caro para descobrir. Uma seção por lição: o que
aconteceu, por que enganou, e o que fazer diferente da próxima vez.

## Peça implementada ≠ peça alcançável

**Quando:** varredura de código da fase Discovery do card "mapa jogável"
(2026-08-06).

**O que aconteceu:** a varredura procurou pela _cadeia de código_ de cada
funcionalidade do DoD e concluiu que várias já existiam. Duas delas não
existiam para o usuário:

- **Indicador de alvo** — cadeia completa ponta a ponta, com teste
  (`TargetingMarker`, `combatCanvasController`). O único gatilho é um botão do
  `CombatPanel` que exige combate ativo e passa `targeted=true` fixo: nunca
  desmarca, e não há nenhum gesto no mapa que marque alvo.
- **`deleteAsset`** — exportado, testado, e sem nenhum botão na UI que o chame.

**Por que engana:** um `grep` pela função encontra a implementação, os testes
passam, e a cobertura parece honesta. O que falta não é código — é o caminho
que leva o usuário até ele.

**O que fazer:** ao mapear o que já existe, procurar o **gesto do usuário**
(clique, tecla, arraste, campo de formulário), não a cadeia de código que
responde a ele. Só depois de achar o gesto, seguir a cadeia. Funcionalidade sem
gesto é peça de reposição, não funcionalidade.

**Reincidência (2026-08-07), jogando o mundo argiburgo:** mais duas, e piores,
porque tinham suíte verde:

- **`TokenInteractionManager`** — arraste, seleção e movimento por seta, com
  testes de contrato desde o M1-C. Nunca era `new`-ado em produção. Nenhum
  token podia ser movido por ninguém.
- **`RulerStateMachine`** — 18 testes verdes, nenhum handler da tecla R. Como
  nenhuma régua era iniciada, nenhuma era transmitida, e o caminho de
  **recepção** de régua remota (que existia inteiro) também nunca rodava.

Todo teste do repo perguntava _"essa peça funciona?"_. Nenhum perguntava
_"alguém alcança?"_. Daí veio `packages/client/src/lib/canvas/__tests__/canvasWiring.test.ts`:
asserção no fonte do `TableScreen`, feia de propósito, que quebra se a fiação
sumir. Não substitui um teste de integração de verdade — o pacote roda em
ambiente `node`, sem `window` — mas cobre a metade barata.

## `eventMode: "static"` não cria superfície clicável (PIXI)

**Quando:** arrastando token no argiburgo (2026-08-07).

**O que aconteceu:** com toda a fiação correta — manager construído, socket ok,
role 4, camada de tokens em `eventMode: "static"` — nenhum token podia ser
selecionado. Sem erro no console.

**Causa:** o PIXI só faz hit-test de um objeto que tenha `hitArea` **ou** que
implemente `containsPoint` — e só `Sprite`, `Graphics` e `Mesh` implementam.
`TokenSprite.container` é um `Container` puro, e todo filho visual dele é
`eventMode: "none"`, então a recursão do hit-test não desce até ninguém.
`"static"` declara a _intenção_ de receber eventos; não cria o alvo.

**Por que engana:** o clique resolvia para a **camada** de tokens, que o
`TokenInteractionManager` equipa com um `hitArea` pega-tudo. O manager subia a
árvore a partir de `layer:tokens`, não achava label `token:`, e caía no ramo
"clique em área vazia" → desselecionar. Falha 100% silenciosa.

**O que fazer:** `Container` interativo precisa de `hitArea` explícito, mantido
em dia com o tamanho renderizado. E teste de contrato com container falso prova
que o componente **reage** a um evento, nunca que o evento **chega**.

## Não dependa do documento inteiro quando o filho muda

**Quando:** logo depois de o arraste funcionar (2026-08-07). O mapa sumia
enquanto o token era arrastado.

**O que aconteceu:** tokens, walls e lights são _embedded_ no `SceneDocument`.
Cada mudança de posição faz o mirror entregar um documento **novo**, e o
`$effect` de carga de cena dependia do objeto inteiro. Uma arrastada disparava,
por update: destruir o sprite de fundo, re-`await Assets.load()`, refazer o fit
de câmera e recriar orchestrator, TokenLayer, manager e régua. Seis recargas
completas apareceram no console em poucos segundos.

**Por que engana:** o `$effect` estava correto quando foi escrito — nada
conseguia mover um token, então a cena nunca era reescrita por essa via. O bug
nasceu latente e só ficou alcançável quando o arraste passou a funcionar.

**O que fazer:** efeito reativo sobre documento agregado deve depender de uma
**chave derivada** só dos campos que ele consome, e ler o documento em
`untrack()`. Ver `packages/client/src/lib/canvas/sceneReloadKey.ts`. Regra
geral: quem cuida das coleções embedded é o orchestrator, não o loader.

## O servidor serve o `index.html` que leu no boot

**Quando:** tela preta após rebuild do client (2026-08-07).

**O que aconteceu:** o servidor lê `packages/client/dist/index.html` uma vez, ao
subir. O Vite limpa o `outDir` a cada build e gera hashes novos. Depois de um
rebuild com o servidor de pé, o HTML servido apontava para um chunk que não
existia mais — o módulo raiz nunca carregava e a tela ficava preta, sem erro
útil.

**Por que engana:** o sintoma é idêntico a cache de navegador, e `Ctrl+F5` não
resolve — o HTML errado vem do servidor. Custou duas rodadas de diagnóstico
errado.

**O que fazer:** **rebuild do client ⇒ reiniciar o servidor.** Para confirmar em
dois segundos, sem abrir o navegador:

```bash
curl -s http://localhost:33000/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
grep -o 'index-[A-Za-z0-9_-]*\.js' packages/client/dist/index.html
```

Se divergirem, é isso. Regra maior: antes de culpar o cliente, comparar o que o
servidor **entrega** com o que está no disco.

## Teste com teto de tempo absoluto mede a máquina, não o código

**Quando:** fase Validar de `wi-mapa-grid-01` (2026-08-07), rodando a suíte
completa.

**O que aconteceu:** `packages/server/src/update/__tests__/boot-nonblocking.test.ts`
falhou com `expected 2558 to be less than 2000`. O teste prova algo legítimo —
que `boot()` não espera pela checagem de atualização — mas prova comparando a
duração do boot com um **número fixo** de 2000 ms. Rodado isolado, três vezes
seguidas, passou nas três: sob a carga da suíte inteira (237 s, pool de forks),
a máquina estoura o teto sem que nada tenha regredido.

**Por que engana:** a falha é vermelha e nomeia um arquivo real, então parece
regressão. O `CLAUDE.md` já manda re-rodar isolado antes de tratar como tal — e
está certo —, mas isso trata o sintoma todo mês. A causa é que a asserção não
fala sobre o código: `2000` é uma propriedade do hardware que rodou o teste no
dia em que ele foi escrito.

**O que fazer:** quando o que se quer provar é _"não esperou por X"_, comparar
com **X**, não com um número inventado. Aqui, o teto natural é o timeout da
própria checagem (5 s): a asserção honesta é que o boot terminou bem antes dele,
ou melhor ainda, que a promessa da checagem ainda estava pendente quando `boot()`
retornou. Teto absoluto em teste de tempo só é aceitável quando a folga é de
ordem de grandeza, não de 25%.

## Argumento opcional é fiação que some sem quebrar nada

**Quando:** fase Validar de `wi-mapa-alvo-01` (2026-08-07), o item que existe
justamente para consertar uma peça inalcançável.

**O que aconteceu:** o gesto de botão direito recebe a máquina de alvo por uma
porta injetada, `targeting?: TargetingPort` — **opcional**, para o
`TokenInteractionManager` continuar construtível sem ela. A justificativa é boa
e o código funciona. O efeito colateral é que a fiação no `TableScreen` pode ser
apagada sem que nada fique vermelho: o campo é opcional, então `tsc` fica verde,
e `canvasWiring.test.ts` — o guarda mecânico criado no M1 contra exatamente este
defeito — assere cinco fatos do fonte do `TableScreen` e nenhum deles é a porta.
Verificado por mutação: removido o bloco `targeting: { … }`, os 321 testes de
`src/lib/canvas` passam com o gesto virado um no-op silencioso.

**Por que engana:** "peça implementada ≠ peça alcançável" já tinha guarda, e o
guarda foi consultado — o `TokenInteractionManager` É construído, a asserção
existe e está verde. A lacuna mudou de lugar: não é mais a peça que falta, é o
**argumento** que a liga. E argumento opcional não deixa rastro nem no tipo nem
no teste. A cada porta nova, o guarda fica um pouco mais desatualizado sem nunca
ficar vermelho.

**O que fazer:** porta opcional que carrega um gesto de usuário ganha, no mesmo
commit, a linha correspondente no guarda de fiação. Regra mais curta: **se o
código compila e a suíte passa com a fiação removida, a fiação não está
testada** — e a mutação que prova isso custa dois minutos. Onde a opcionalidade
não for necessária de fato, tornar o campo obrigatório é mais barato que o
guarda: aí o compilador vira o teste.

## O papel do usuário virou política de cena — e o flag ficou sem leitor

**Quando:** investigação da issue #80 (2026-08-07), tela do jogador preta na
prova jogada de duas telas do M2.

**O que aconteceu:** três lugares do pipeline de fog decidiam "tem névoa?" com
`!isGm` — `TableScreen` criando o `FogState`, o orquestrador passando
`fogEnabled` ao `TokenLayer`, e o `FogState` respondendo `fogActive`. Nenhum
deles lia `scene.tokenVision` / `scene.fogEnabled`, que existem no schema com
default `false` e o comentário explícito _"When false, all players see the
entire scene"_. Com os polígonos de visão vazios (o default de
`vision.enabled` de um token também é `false`), o `LightingRenderer` pinta o
retângulo preto de alpha 1 sobre a cena inteira e o `TokenLayer` esconde todos
os sprites: num mundo novo, nenhum jogador enxerga o mapa.

**Por que engana:** `!isGm` **coincide** com a política certa no único cenário
que alguém exercitou — cena com fog ligado, GM de um lado, jogador do outro.
O proxy e a regra só divergem quando a cena diz que não quer fog, e era
exatamente o estado em que toda cena nasce. Pior: a UI de escrita existia
(`ScenePerceptionDialog` grava os dois campos há tempo) e o teste do
orquestrador _codificava o proxy como se fosse a regra_ — `"player role →
setVisionPolygons called with fogEnabled=true"`, verde, provando o defeito.
E o sintoma mente sobre a causa: o mapa aparece por alguns frames porque o
blackout só entra depois do `await fogState.load()`, o que faz tudo parecer
problema de carga, de textura ou de corrida.

**O que fazer:** **campo de configuração gravável sem consumidor é uma
configuração que mente** — quando um flag entra no schema, o commit que o
cria deve incluir quem o _lê_, ou ele não deve existir ainda. E política de
produto ("esta cena tem névoa?") não se deriva de um proxy de identidade
("quem está olhando?"): o proxy sobrevive a todos os testes até o dia em que
os dois discordam. Ao encontrar um `!isGm` (ou qualquer papel) decidindo
comportamento, perguntar de qual campo aquilo deveria vir.

## Alargar a allowlist alarga todo mundo que passa pelo portão

**Quando:** fase Validar de `wi-mapa-som-01` (2026-08-07), o item que fez o
upload aceitar mp3 e ogg.

**O que aconteceu:** o `FilePicker` é o portão único de três consumidores —
fundo de cena (`SceneCreateDialog`), textura de token (`TokenAddDialog`) e
retrato (`CharacterSheet`) —, e os três querem **só imagem**. O item alargou a
allowlist global (`ALLOWED_TYPES` no servidor, `ALLOWED_EXTENSIONS` no cliente)
e, ciente do risco, criou a prop `kinds` para estreitar o picker por chamador.
Só que `kinds` alimenta **uma** das três entradas do componente:

- **`accept` do diálogo do sistema** — estreitado. É a única que o navegador
  filtra por conta própria.
- **A grade de assets** — `assetStore.filtered` filtra só por texto de busca, e
  `handleSelectAsset` devolve o caminho sem olhar o tipo. Um `.mp3` na
  biblioteca vira card selecionável em todo picker.
- **O arraste** — `handleDrop` ignora `kinds` por decisão documentada; com um
  arquivo só, ainda auto-seleciona o que acabou de subir. Soltar um `.mp3`
  sobre o picker de "criar cena" grava `scene.background = "/assets/….mp3"`.

Nenhuma validação a jusante segura: `validateSceneForm` só cobra o tamanho da
string do caminho. Resultado: cena com fundo que o `Assets.load()` do PIXI não
carrega, em um gesto.

**Por que engana:** o docblock do componente justifica o arraste global dizendo
que "a validação é feita pelo `clientValidation` (e, de verdade, pelo
servidor)". Isso responde _"este arquivo é permitido em algum lugar?"_, e não
_"este arquivo é do tipo certo AQUI?"_. A segunda pergunta era verdadeira **por
acidente**, enquanto não existia asset não-imagem no mundo — o dia em que a
allowlist cresceu foi o dia em que a suposição parou de valer, e nenhum tipo,
teste ou lint fala sobre isso. Pior: a prop `kinds` faz o chamador acreditar que
está protegido. Estreitamento que alcança uma entrada de três é mais perigoso
que estreitamento nenhum.

**O que fazer:** ao alargar uma allowlist compartilhada, listar os **consumidores
dela** e perguntar, um por um, o que cada um faz com um valor da classe nova —
o mesmo movimento de "procure o gesto do usuário", só que na direção contrária:
não "alguém alcança esta peça?", e sim "quem alcança esta peça agora que ela
aceita mais coisa?". E prop de estreitamento tem que cobrir **todas** as
entradas do componente (diálogo, grade, arraste) ou não deve existir: ou o
componente inteiro respeita `kinds`, ou o chamador que precisa de garantia
valida ele mesmo o que recebeu no `onSelect`.

## Função pura testada não prova que o dado certo chega na ponta

**Quando:** implementação do som ambiente da mesa, item `wi-mapa-som-01`
(2026-08-08).

**O que aconteceu:** o player de áudio do cliente nasceu com 41 testes verdes e
não tocava uma faixa sequer. O contrato define `src` como o **nome puro** do
asset (`tavern.mp3`, sem barra — o regex do schema recusa qualquer path). O
player pegava esse nome e passava por `resolveAssetUrl()`, que só reescreve
string já no formato `/assets/<nome>` e **devolve qualquer outra coisa
intacta**. O Howler recebia `tavern.mp3`, uma URL relativa à página, e tomava 404. Nenhum teste viu, porque todos exercitavam as funções puras extraídas
(`loopOffsetSeconds`, `shouldRestart`) e nenhum olhava o argumento que chega ao
construtor do `Howl`.

No mesmo arquivo, um segundo defeito da mesma família: no desbloqueio de
autoplay o player só dava `seek()`. Lendo o `dist/howler.js`, o `_unlockAudio`
apenas **emite** o evento `unlock` — nunca retoma a reprodução. O som bloqueado
ficou `_paused/_ended`, e um play parado em `once('resume')` ainda carrega o
seek capturado **antes** do bloqueio. O jogador que abrisse a aba com autoplay
bloqueado clicaria na tela e continuaria no silêncio, para sempre.

**Por que enganou:** extrair a lógica pura e testá-la é a recomendação certa, e
foi seguida à risca. O problema é que ela desloca a verificação para onde o
código é fácil de testar — e o defeito mora exatamente onde ela **não** foi: na
fronteira com a biblioteca externa. "Sem AudioContext no Node" justifica não
testar o áudio de verdade; não justifica deixar sem teste **o valor que se
entrega à biblioteca**, que é um objeto JavaScript comum.

**O que fazer:** quando um módulo existe para conversar com uma biblioteca
externa, teste também **a conversa** — mocke a biblioteca e afirme sobre o que
chega no construtor/na chamada. É barato (`vi.mock`) e é a única coisa que pega
uma URL malformada, um flag invertido ou um campo faltando. E ao usar um helper
de outro módulo, confira o que ele faz com uma entrada **fora** do formato que
ele espera: `resolveAssetUrl` não falha com nome puro, ela devolve o nome puro
— o silêncio dela é que virou o bug. Helper que degrada devolvendo a entrada
intacta é uma armadilha: dá certo no teste e erra em produção.

## Aba que não cabe não fica apertada: ela some, e leva a vizinha junto

**Quando:** primeira abertura do painel de som pelo dono, item `wi-mapa-som-01`
(2026-08-08).

**O que aconteceu:** a aba **Som** foi adicionada à barra lateral, o código estava
correto, o componente montava, o teste de tipo e o lint passavam — e ela
simplesmente não existia na tela. A aba **Compêndio**, que funcionava antes,
tinha sumido junto.

A `.sidebar__tabs` é um `display: flex` sem `flex-wrap` e sem `overflow`, dentro
de uma sidebar de **280 px fixos**. As seis abas (Cenas, Combate, Chat, Atores,
Compêndio, Som) somam cerca de **465 px**. O flex encolheu os itens até abaixo
do texto e o que sobrou saiu pela borda — **sem barra de rolagem, sem
reticências, sem qualquer indício de que havia mais coisa ali**. Não é um
elemento cortado pela metade, que se notaria: é um elemento que desaparece
inteiro e em silêncio.

**Por que enganou:** todo instinto de verificação estava apontado para o
comportamento — o evento chega? o estado sincroniza? o servidor recusa quem não
pode? Nada disso responde "o usuário consegue ver o botão". Pior: a aba nova
levou junto uma aba **antiga e funcionando**, ou seja, o dano apareceu num lugar
que ninguém pensaria em conferir depois de adicionar um item de menu.

**O que fazer:** ao acrescentar um item a um container de largura fixa (barra de
abas, toolbar, breadcrumb), some as larguras antes de assumir que cabe, e trate
o transbordo explicitamente — `flex-wrap` para quebrar linha, ou truncamento
visível. Nunca deixe o default, que é sumir calado. E prefira **quebrar linha a
`overflow-x: auto`** em painel estreito: rolagem horizontal escondida é um gesto
que ninguém descobre, o que recai na lição "peça implementada ≠ peça alcançável"
— só que agora a peça inalcançável é o próprio caminho até ela.

**Corolário de verificação:** foi um humano abrindo a tela que achou isso, no
primeiro passo do roteiro. Depois disso, dirigir um navegador de verdade
(Playwright) e afirmar sobre o que está **renderizado** — não sobre o que está
no DOM ou no bundle — passou a fazer parte da prova destes itens de UI.

## `emit` sem ack transforma rejeição do servidor em silêncio

**Quando:** item de tokens (2026-08-08), ao descobrir por que arrastar uma
ficha para o canvas não criava token nenhum.

**O que aconteceu:** `handleCanvasDrop` montava o envelope de `doc:create` à
mão, com `embedded` e `documents` onde o `DocCreatePayloadSchema` espera
`parent` e `data`. O servidor recusava com `VALIDATION_FAILED` em todo drop —
mas a chamada era `sock.emit("op", …)` sem callback de ack, então a recusa não
tinha para onde ir. Nada no console, nada na tela: o token simplesmente não
nascia. O mesmo erro de chave já havia sido corrigido meses antes no botão de
criar ficha, e o comentário dessa correção continuava no repo, a dois arquivos
de distância.

**Por que engana:** o caminho _parece_ implementado — há handler de dragover,
há conversão de coordenada, há snap ao grid, há um `emit` no fim. Todo o
trabalho visível está lá; só o contrato com o servidor está errado. E como
`emit` sem ack não tem valor de retorno, não existe caminho de código onde a
falha apareça: nenhum `catch`, nenhum log, nenhum teste vermelho. O bug
sobrevive a qualquer leitura que pergunte "isso está escrito?" em vez de
"isso chegou?".

**O que fazer:** duas regras que se reforçam. **Op que muda estado vai por
`sendOp` (com ack), nunca por `emit` cru** — a rejeição precisa de um lugar
para aterrissar, mesmo que esse lugar seja um `console.warn`. E **payload de
rede não se monta à mão em componente**: extrair para função pura e, no teste,
validar o resultado contra o schema do `shared` (`Schema.parse(payload)`).
Assim o teste falha no dia em que o contrato muda, em vez de o recurso morrer
calado em produção. Duplicar o shape em dois lados sem um validador comum é
combinar uma divergência para depois.

## Durante `dragover` o dado do arrasto não existe — só o tipo

**Quando:** item de tokens (2026-08-08), no teste manual do próprio conserto do
drop de ficha no canvas: a suíte estava verde, o payload estava certo, e
arrastar uma ficha para o mapa continuava não fazendo nada.

**O que aconteceu:** `handleCanvasDragOver` decidia se o canvas aceitava o
arrasto chamando `dataTransfer.getData("application/fusion-actor")`. Pelo
HTML drag-and-drop spec, durante `dragenter`/`dragover` o drag data store fica
em **modo protegido**: `getData()` devolve string vazia por mais que o
`dragstart` tenha escrito lá; só a lista `types` é legível. O dado real só
volta no `drop`. Como o `getData()` vinha vazio, o handler concluía "não é um
arrasto meu" e saía sem chamar `preventDefault()` — e sem isso o elemento
nunca vira alvo de soltura, o browser mostra o cursor de bloqueio e **o evento
`drop` nunca dispara**.

**Por que engana:** o código do `drop` estava correto e testado — inclusive
com teste validando o payload contra o schema do servidor. O defeito não
estava em nenhum dos dois lados que alguém pensaria em olhar; estava no
guarda que decide se o `drop` chega a existir. Pior: `getData()` é a mesma
chamada, no mesmo objeto, com a mesma assinatura nos dois handlers — funciona
num, devolve vazio no outro, sem erro, sem aviso. E o único sintoma é
ausência: nada acontece. Uma suíte de unidade não vê isso porque não existe
um browser aplicando o modo protegido; foi preciso arrastar com o mouse.

**O que fazer:** em `dragover`/`dragenter`, decidir **só por
`dataTransfer.types`** — nunca pelo conteúdo. E a lição mais larga: quando um
recurso passa por um gesto do usuário no browser (arrastar, colar, soltar
arquivo, foco), a suíte de unidade prova o cálculo, não o gesto. **Fix de
interação só está verificado depois de alguém — pessoa ou browser
automatizado — fazer o gesto de verdade.** Foi o teste manual do usuário que
pegou este, com a suíte inteira verde.

## Zod `.extend()` sem `.passthrough()` apaga o campo que ninguém declarou

**Quando:** implementação do grid calibrável (2026-08-08).

**O que aconteceu:** o `SceneSchema` do servidor
(`packages/server/src/documents/types.ts`) declarava `name`, `width`,
`height`, `padding`, `background`, `tokens`, `walls`, `lights`… e **não
declarava `grid`**. Como o schema é montado com `.extend()` e sem
`.passthrough()`, o Zod remove toda chave não declarada. Resultado: o grid
inteiro da cena era descartado em **toda** escrita. O GM ajustava o tamanho da
célula, o ack voltava `ok: true`, e a cena recarregava com os 100 px do
default. Não havia erro em lugar nenhum — o dado simplesmente não existia do
outro lado da validação.

**Por que engana:** existiam **dois** schemas de Scene, um no `@fusion/shared`
(completo, com `grid`) e outro no servidor (parcial). Todo mundo que olhou o
tipo `SceneDocument` viu `grid` como campo obrigatório com default — o
TypeScript concordava, a UI mandava o diff certo, o handler expandia
`"grid.size"` corretamente, e o teste do `applyDotPathDiff` passava. A perda
acontecia uma camada abaixo, no `validateDocument()`, que é justamente onde
ninguém procura um dado sumindo.

Havia pistas: `scene.grid?.size ?? 100` aparece com comentário defensivo em
pelo menos três arquivos do canvas, cada um explicando que "o tipo diz que
sempre existe, mas em runtime pode faltar". Três pessoas contornaram o
sintoma; ninguém perguntou **por que** faltava.

**O que fazer:**

- Schema duplicado é dívida com juros. Quando o servidor precisa validar um
  documento que o `shared` já descreve, **importar o schema compartilhado** —
  como já era feito com `WallDocumentSchema` e `AmbientLightDocumentSchema`.
- Um `?? default` defensivo sobre um campo que o tipo garante não é um
  contorno: é o relatório de um bug ainda não investigado. Da próxima vez que
  escrever um, rastreie até a origem antes de commitar.
- Ao ligar validação onde antes não havia, **os campos obrigatórios sem
  default viram rejeição**. Aqui, quatro testes E2E que mandavam
  `{ type, size }` sem `distance`/`units` passaram a falhar — o correto foi dar
  default a esses campos, não exigi-los: quem manda `{ size: 140 }` está
  declarando um tamanho de célula, não recusando ter uma distância.

## Esconder no cliente não é esconder

**Quando:** cena composta por várias imagens (2026-08-08).

**O que aconteceu:** ao modelar as imagens extras da cena (`tiles`), a opção
barata era mandar todas para todo mundo e deixar o cliente não desenhar as
marcadas como `hidden`. O mapa do porão, a versão "depois da explosão" do
pátio, a sala atrás da porta — tudo entregue ao navegador do jogador,
esperando que ele se comporte.

**Por que engana:** visualmente é idêntico. A imagem não aparece na tela, o
GM vê "escondida" no painel, e o comportamento parece correto em qualquer
teste que se faça pela interface. A diferença só existe no DevTools do
jogador — e no fato de que o produto **prometeu** ao GM que estava escondido.

**O que fazer:** conteúdo oculto sai do payload no servidor, pelos **quatro**
caminhos de emissão (`buildSnapshot`, `broadcastToWorld`, `filterOpsForRole`,
`redactAckResultForNonPrivileged`), usando o `redaction.ts` canônico. Foi o
que já custou duas rodadas de correção no M1-C com token oculto: três
caminhos fechados e o quarto — o eco do ack de volta para quem pediu —
vazando a Scene inteira. E o gate de papel também muda: `tile` é GM-only, não
TRUSTED+ como token, porque quem pode revelar uma imagem pode estragar a cena
que o GM montou.

## As coordenadas da cena não começam em (0,0)

**Quando:** primeira vez que uma imagem extra (tile) foi colocada numa cena
real, jogando o argiburgo (2026-08-08).

**O que aconteceu:** a imagem nova foi criada em `x: 0, y: 0` com o tamanho da
cena — o que parece obviamente "cobrir o mapa" — e apareceu deslocada 250 px
para cima e para a esquerda. O `sceneLoader` desenha o background em
`(padX, padY)`, onde `padX = round(scene.width * scene.padding)`: a cena tem
uma borda de padding em volta do mapa (0.25 por default), e o mapa começa
depois dela. `(0,0)` é o canto do **padding**, não o canto do mapa.

**Por que engana:** `width`/`height` da cena são as dimensões do MAPA, não do
espaço de coordenadas — o espaço total é `width * (1 + 2*padding)`. Então
`{x: 0, y: 0, width: scene.width, height: scene.height}` mistura duas origens
diferentes e lê como correto em qualquer revisão de código. Nenhum teste pega:
o valor é internamente consistente, só não é o mesmo que o do background. E
com padding 0 — que é o que um fixture de teste tende a usar — o bug some.

**O que fazer:** qualquer coisa posicionada "sobre o mapa" parte de
`(padX, padY)`, não da origem. Existe `defaultTileRect()` em
`tileController.ts` devolvendo esse retângulo; use-o em vez de recalcular. E a
lição mais larga: quando dois subsistemas põem coisas no mesmo espaço, o
segundo tem que **ler de onde o primeiro colocou**, não deduzir de onde
deveria ser.

## Nenhum gate deste repo alcança um arquivo `.svelte`

**Quando:** porte da System Window para o client (2026-08-08).

**O que aconteceu:** ao rodar os gates sobre componentes novos, os dois que
cobririam estilo e erro de código simplesmente não olharam para eles:

- `eslint.config.js` lista `**/*.svelte` entre os arquivos **ignorados**
  (linha 19). Rodar `npx eslint <pasta com .svelte>` não reprova nada — pior,
  quando a pasta só tem `.svelte`, o ESLint aborta com "all of the files
  matching the glob pattern are ignored", que soa como erro de invocação.
- `format:check` roda `prettier --check "**/*.{ts,tsx,json,md}"`. `.svelte` e
  `.css` estão fora do glob, e o Prettier deste repo nem tem o plugin de
  Svelte instalado: pedir `--check` num `.svelte` falha com "No parser could be
  inferred for file".

**Por que engana:** a suíte fica verde, o `format:check` diz "All matched files
use Prettier code style!" e o gate parece ter passado sobre o componente. O
"matched" da mensagem é a palavra que ninguém lê. O mesmo vale para `.css`:
`base.css` **também** difere do Prettier hoje e nunca foi reprovado.

**O que fazer:** o único gate que enxerga `.svelte` é o `svelte-check`
(`pnpm --filter @fusion/client typecheck`) — e ele checa tipo e a11y, não
estilo. Então: (a) rode `svelte-check` sempre que mexer em componente, e leia
os WARNINGS, não só os ERRORS; (b) mantenha em `lib/*.ts` toda lógica que
mereça teste, porque o client roda Vitest com `environment: "node"` e não monta
componente — um `.svelte` gordo é código sem lint, sem format e sem teste; (c)
ao afirmar "gates limpos", diga sobre quais arquivos, já que a resposta honesta
hoje exclui todo `.svelte` e todo `.css`.

## O servidor serve o `index.html` que leu no boot, não o que está no disco

**Quando:** demonstração da System Window no mundo `isekai` (2026-08-08) —
tela preta para o usuário.

**O que aconteceu:** o servidor subiu, e depois o client foi reconstruído para
incluir uma correção. O Vite esvazia `dist/` e regera os bundles com hash novo.
O servidor continuou entregando o `index.html` do boot, que aponta para
`assets-client/index-<hash-antigo>.js` — arquivo que não existe mais. Resultado:
`GET /` responde **200**, o `<script>` seguinte responde **404**, nada monta e a
página fica preta.

**Por que engana:** o único sintoma é "tela preta". O `/health` responde,
`GET /` responde 200, o log não tem nenhum erro — só um 404 solitário no meio de
dezenas de 200, que passa batido. E `curl` na raiz parece confirmar que está
tudo certo, porque o HTML volta íntegro; ele só aponta para o lugar errado.

**Como diagnosticar em 10 segundos:** compare o que o servidor entrega com o
que existe no disco.

```
curl -s http://<host>:33000/ | grep -o 'assets-client/index-[^"]*\.js'
ls packages/client/dist/assets-client/ | grep -E '^index-.*\.js$'
```

Nomes diferentes = servidor obsoleto. Confirme pedindo o arquivo que o HTML
cita e vendo o 404.

**O que fazer:** rebuild do client com o servidor no ar **exige reiniciar o
servidor**. E, ao reiniciar, matar o processo antigo de verdade: o mundo tem
lock por PID, então o novo morre com `WorldLockedError: World "isekai" is
already in use by process <pid>` se o anterior ainda estiver vivo. Vale também
para o navegador do outro lado: `Ctrl+Shift+R`, porque o `index.html` antigo
pode estar no cache dele.

## O renderer que inicializa e não desenha

**Quando:** "o narrador não consegue ver o mapa" — tela preta na mesa, com
imagem de cena também sumindo (2026-08-08).

**O que aconteceu:** duas falhas empilhadas, e a de cima escondia a de baixo.

1. O CSP servido em `boot.ts` tinha `connect-src 'self'`. O PIXI v8 testa
   suporte a worker rodando `fetch()` sobre um `data:image/png;base64,…`
   inline (`checkImageBitmap`). `data:` estava liberado em `img-src`, mas
   `fetch` responde a **`connect-src`** — bloqueado. Único sintoma: um erro de
   CSP no console.
2. Com o CSP corrigido, o asset passou a ser baixado (`200 OK`) e a tela
   continuou preta. O `FusionCanvas` inicializava com `preference: "webgpu"`,
   e o fallback do PIXI só dispara quando o WebGPU **falha ao inicializar**.
   No Chromium/Edge em Windows ele inicializa com sucesso e depois não
   desenha nada — background, grid e tokens, todos ausentes, sem uma única
   exceção. Como nada falha, nada cai para o WebGL.

**Por que engana:** o sintoma ("o GM não vê o mapa") aponta para permissão,
fog ou visibilidade — foram três caminhos investigados antes (redação do
snapshot, `isGm`, overlay de darkness) e todos estavam corretos. Um renderer
que inicializa e devolve tela preta é invisível para o JS: não há erro para
logar, não há teste unitário que pegue (o PIXI é mockado), e a request do
asset aparece verde no DevTools.

**O que fazer:** quando a tela está preta e **o grid também não aparece**, o
problema não é o asset nem permissão — é o renderer ou a câmera. O corte que
resolve em um minuto: desabilitar `navigator.gpu` no browser e recarregar; se
a cena aparece, é o WebGPU. O `preference` está fixo em `"webgl"` desde então,
com o porquê registrado no próprio `FusionCanvas.init()`. E o mais geral: um
`200 OK` na aba Network prova que o byte chegou, não que ele foi desenhado.

## Um documento que muda tem dois caminhos de escrita no store — e três de leitura no servidor

**Quando:** verificação adversarial da revelação de rolagem secreta
(`chat:reveal`, spec 09 / DEC-CHT-10), 2026-08-09.

**O que aconteceu:** o chat sempre tratou `ChatMessage` como append-only. A
revelação foi a primeira operação a **mudar** uma mensagem já entregue, e cada
lugar que assumia "mensagem nova" virou um defeito silencioso:

- **No cliente**, `insertMessage` deduplicava por `_id` e retornava. O servidor
  persistia a revelação, reemitia o documento certo, e a tela não mudava. Bug
  invisível em qualquer teste de servidor.
- **Ainda no cliente**, o store tem **dois** caminhos de escrita:
  `insertMessage` (broadcast ao vivo) e `prependMessages` (`chat:history`, o
  F5). Consertar só o primeiro deixa o reload mostrando a versão que o store
  pegou primeiro. E o segundo escondia um bug anterior: ele ordenava a página
  em ordem crescente e fazia `unshift` de cada item, o que **inverte** a página
  — a lista é documentada (e consumida por `chatGrouping`, que não reordena)
  como mais antiga primeiro. Passou a delegar para `insertMessage`.
- **No servidor**, a visibilidade era decidida por três cópias quase idênticas
  do mesmo predicado (broadcast, `chat:history`, snapshot de entrada) mais o eco
  do ack. Elas só concordam sobre uma mensagem revelada se concordarem em geral;
  viraram uma função só.

**Por que engana:** a feature parece pronta na demonstração — o GM clica, a
mesa vê. O que quebra é o F5, o cliente que entra depois e o restart, que
ninguém confere durante a demo. E o defeito do store fica **fora** do alcance de
qualquer teste de servidor: o servidor está certo o tempo todo.

**O que fazer:** ao introduzir a primeira mutação de um documento que já foi
entregue, listar **todos** os caminhos de leitura antes de codar e escrever um
teste por caminho — ao vivo, histórico, snapshot de entrada e reabertura do
arquivo do banco. E, quando a visibilidade for reescrita no próprio documento
(aqui: `whisper` volta a `[]`, `blind` a `false`), preferir isso a um terceiro
campo de visibilidade: um predicado novo teria que ser replicado nos mesmos
caminhos que já divergiam.

## Commitar arquivo de subagente ainda vivo derruba o CI no `format:check` (2026-08-12)

**O que aconteceu:** um subagente construía o editor rico (`RichText.svelte` +
`richText.ts` + teste). Antes de ele terminar, a sessão principal fechou o
trabalho do quadro de missões com `git add -A` e pushou. Os arquivos do
subagente entraram no commit **na versão anterior ao `prettier --write` que ele
ainda ia rodar**, e o CI reprovou em `format:check` — não em teste, não em
lint, em formatação.

**Por que engana:** o `pnpm format:check` local passava, porque a árvore de
trabalho JÁ tinha a formatação que o subagente aplicou depois do commit. O que
estava errado era o _commit_, não a árvore. Rodar o gate localmente responde
"tudo formatado" e o CI responde "não", e as duas respostas estão certas.

**O que fazer:** o `CLAUDE.md` já manda não escrever no arquivo que um
subagente está escrevendo; isto é o corolário — **não commite o arquivo de um
subagente que ainda não reportou**. Se o trabalho paralelo precisa entrar no
mesmo commit, espere a notificação de conclusão. E, antes de qualquer push,
`git status` + `git diff --stat`: um diff cosmético pendente logo depois de um
`git add -A` é sinal de que alguém escreveu no arquivo depois de você.
