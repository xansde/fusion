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

**O que fazer:** quando o que se quer provar é *"não esperou por X"*, comparar
com **X**, não com um número inventado. Aqui, o teto natural é o timeout da
própria checagem (5 s): a asserção honesta é que o boot terminou bem antes dele,
ou melhor ainda, que a promessa da checagem ainda estava pendente quando `boot()`
retornou. Teto absoluto em teste de tempo só é aceitável quando a folga é de
ordem de grandeza, não de 25%.
