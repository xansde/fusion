# 43 — Aba Compêndio

- **Título:** Aba Compêndio — a estante do acervo, e o que acontece quando se busca no geral
- **Status:** draft v0.1 (grill rodada 1 concluído em 2026-08-16)
- **Data:** 2026-08-16
- **Spec-mãe:** [`36-gaveta-lateral.md`](36-gaveta-lateral.md) — esta é a spec-filha da aba `compendium` (DEC-GAV-01, grupo "todos os usuários", quarta do trilho).
- **Área dona do conteúdo:** [`16-compendiums-e-importacao.md`](16-compendiums-e-importacao.md) — packs, índice, busca, importação e licença. Esta spec **exibe e comanda**; não redefine.
- **Baseada em:**
  - Protótipo `packages/client/prototypes/compendium-tab.prototype.html` — rodada 1, três variantes (estante · busca · balcão). Decisão do Alexandre em 2026-08-16: **estante (A), e quando a busca for no geral, o resultado da busca (B)**.
  - `CompendiumBrowser.svelte` + `lib/compendium/{compendiumApi,compendiumBrowser}.ts` + `server/src/compendium/{handlers,service}.ts` — implementação existente que esta spec formaliza e reenquadra na gaveta.

> **Esta aba não nasce de tela em branco.** O browser já existe e cumpre
> REQ-CMP-012..018 e REQ-CMP-021. O que esta spec decide é o que muda quando ele
> passa a viver numa gaveta de 300px (DEC-GAV-04), com o acervo real do PF2e
> (~12 mil documentos) e com um **jogador** do outro lado da tela.

---

## 1. Objetivo

Dar a qualquer usuário o caminho mais curto entre "preciso de uma coisa que está
no acervo" e ter essa coisa no mapa, na ficha ou na mesa — sem que ele precise
saber em qual pack ela mora.

## 2. Escopo

### 2.1 Inclui

- Os dois modos do painel (estante e busca) e a regra que troca de um para o outro.
- A linha de resultado: o que ela mostra, o que ela arrasta, o que ela abre.
- A janela de pré-visualização e o que ela é obrigada a exibir.
- Trazer conteúdo para o mundo e para uma ficha, e quem pode fazer cada coisa.
- A **plateia** de um pack (quem pode vê-lo) e onde esse limite é imposto.
- O que sobrevive à troca de aba, e onde isso é gravado.

### 2.2 Não inclui

- Formato de pack, índice, importação, remapeamento de `@UUID` e licença por pack →
  `16` (DEC-CMP-01/02/03, REQ-CMP-012..025). Esta spec cita.
- Contêiner (largura, recolher, persistência de `open`/`activeTab`) → `36`.
- **Autoria de conteúdo**: criar, editar ou excluir documento do mundo → `42`
  (DEC-NPC-01). Esta aba nunca cria documento do zero.
- Escolher conteúdo **de dentro de uma ficha** (o picker do planejador PF2e) →
  `11`/`17`. É outra porta para o mesmo acervo, e continua existindo (DEC-CPD-11).
- Geração do overlay de tradução dos packs → `16`/`31`; aqui só se decide como o
  nome traduzido aparece e como a busca o trata.

## 3. Conceitos e terminologia

| Conceito          | Definição                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Estante**       | Modo de repouso do painel: os packs que o usuário pode ver, agrupados por tipo de documento e colapsáveis.                       |
| **Escopo**        | Onde a busca procura: **o acervo inteiro** (raiz) ou **um pack** (quando um pack está aberto).                                   |
| **Modo busca**    | O que o painel exibe quando há texto ou faceta no escopo raiz: resultado agregado de todos os packs visíveis, agrupado por tipo. |
| **Plateia**       | Quem pode ver um pack (`all` ou `gm`), declarado no manifesto do pack. Não é ownership de documento; é visibilidade de acervo.   |
| **Trazer**        | Verbo único desta aba para "fazer entrar no mundo ou numa ficha". Cobre importar (REQ-CMP-016) e arrastar (REQ-CMP-017/018).     |
| **Selo no mundo** | Marca de que existe, no mundo, um documento originado daquela entrada de pack.                                                   |

## 4. Decisões

### DEC-CPD-01 — Um painel, dois modos, e o escopo é quem decide qual

O painel é a **estante** em repouso e vira **resultado de busca** quando há o que
buscar. Não existe botão de alternar modo: o modo é consequência do escopo.

- **Raiz, busca vazia** → estante: grupos por tipo de documento (Criaturas, Itens,
  Regras), cada um listando seus packs com contagem e licença.
- **Raiz, busca preenchida (ou faceta aplicada)** → resultado **agregado de todos os
  packs visíveis**, agrupado por tipo, cada linha nomeando sua fonte.
- **Pack aberto** → índice daquele pack; a busca ali filtra **só aquele pack**, e o
  painel oferece explicitamente ampliar a mesma busca para o acervo inteiro.
- **Racional:** navegar por fonte é o que o Mestre faz quando está preparando ("o que
  tem no Monster Core?"); buscar no geral é o que qualquer um faz durante o jogo
  ("me dá um goblin"). Obrigar a escolher o modo antes de saber o que se quer é
  cobrar uma decisão que o usuário ainda não tem. Substitui o drill-down obrigatório
  de hoje, em que a busca só existe dentro de um pack.

### DEC-CPD-02 — Buscar no acervo inteiro é requisito novo, e é do servidor

A busca agregada NÃO DEVE ser implementada como N buscas no cliente sobre índices
baixados. O servidor é dono do índice de busca de todos os packs visíveis ao
solicitante e responde com um resultado já limitado.

- **Racional:** REQ-CMP-013 é busca **dentro** do pack; o acervo do PF2e tem ~12 mil
  documentos em ~17 packs (equipamento sozinho tem mais de 5 mil), e REQ-CMP-049 já
  dá 1,5 s só para indexar um pack grande. Baixar tudo para o cliente para poder
  buscar contraria DEC-CMP-02 (índice leve, lazy). É a emenda que esta spec obriga
  na `16` (§12).

### DEC-CPD-03 — A pré-visualização abre em janela, não em lâmina dentro do painel

Pré-visualizar um documento abre uma **janela flutuante** (REQ-UIF-009), fora da
gaveta. O painel nunca troca a lista por um detalhe.

- **Racional:** DEC-GAV-04 diz que o que não cabe abre janela; um stat block com
  traços, resumo e licença não cabe em 300px sem virar rolagem infinita. E a lista
  precisa continuar visível: comparar duas criaturas é o uso normal, e hoje a lâmina
  interna torna isso impossível. Duas janelas de preview abertas ao mesmo tempo são
  legítimas.

### DEC-CPD-04 — Pack tem plateia, e o bestiário não nasce aberto ao jogador

Todo pack declara `audience: "all" | "gm"` no manifesto. Pack de plateia `gm` não é
listado, não é buscável e não é legível para quem não é papel privilegiado — e a
regra é imposta **no servidor**, não na tela.

- Os packs de **criaturas e perigos** do sistema nascem `gm`. Os demais (equipamento,
  magias, talentos, ancestralidades, antecedentes, regras, tabelas) nascem `all`.
- **Racional:** hoje o servidor libera `list`/`search`/`get` a qualquer papel e só
  `import` é privilegiado — ou seja, o jogador pode abrir o stat block do monstro da
  sessão de hoje. Ninguém decidiu isso; é o default de quem implementou. A mesa
  precisa que sigilo seja explícito, como já é para vida de criatura (DEC-CBA-03) e
  para contato oculto (DEC-CTT-04). A plateia é do **pack** porque licença e origem
  também são (DEC-CMP-03), e porque decidir documento a documento seria um segundo
  sistema de ownership.

### DEC-CPD-05 — O jogador não importa para o mundo, mas traz para a própria ficha

Trazer para o **mundo** (o que REQ-CMP-016 chama de importar) é ação de papel
privilegiado. Trazer para uma **ficha** é permitido a quem tem `OWNER` daquele ator
(REQ-DOC-027/028), e o servidor executa a importação em nome do usuário, com o ator
como destino.

- **Racional:** montar a própria ficha é o trabalho normal do jogador no PF2e —
  escolher magias, talentos e equipamento. O picker dentro da ficha já faz isso hoje;
  proibir na aba criaria duas regras para o mesmo gesto. O predicado que protege não
  é o papel, é o ownership do **destino**.

### DEC-CPD-06 — Dois nomes, e a busca casa os dois

A linha de resultado exibe o nome traduzido em destaque e o nome original abaixo,
quando existirem os dois. A busca casa contra ambos, sem acento e sem caixa.

- **Racional:** o overlay pt-BR já existe em produção e não está em spec nenhuma. A
  mesa fala "Bola de Fogo", o material de referência e o pack falam "Fireball" — quem
  digita qualquer um dos dois tem que achar. Esconder o nome original quebraria a
  conferência com o livro.

### DEC-CPD-07 — Licença aparece na estante e na janela, e nunca é opcional

Cada pack exibe sua licença na estante, e a janela de pré-visualização traz um bloco
de licença com a do pack e o override do documento quando houver.

- **Racional:** licença é a razão de o projeto ser clean-room (`26`). Ela é dado do
  pack (DEC-CMP-03) e é a única informação que não pode ser truncada por falta de
  espaço.

### DEC-CPD-08 — Sem badge em repouso; ponto de estado só enquanto uma importação corre

A aba não tem contador. Ela acende um **ponto de estado** (REQ-GAV-021) enquanto uma
importação em lote está em andamento, e o apaga ao terminar.

- **Racional:** compêndio não tem "coisa nova que você não viu" — o acervo é estável
  e é o usuário que vai até ele. O único evento que merece o trilho é trabalho em
  curso que ele iniciou e que continua rodando com a gaveta recolhida.

### DEC-CPD-09 — O escopo e a busca sobrevivem à troca de aba, no aparelho

REQ-GAV-017 desmonta o painel ao trocar de aba. Esta spec grava, **no aparelho**, por
mundo e por usuário: o pack aberto, o texto de busca e as facetas ativas — e os
restaura ao voltar. A validade é a **sessão do navegador**: fechar a aba do navegador
zera.

- **Racional:** DEC-UIF-10 já manda ergonomia local morar no cliente. Perder a busca
  por ter ido responder uma pergunta no Chat é o atrito que a gaveta cria e cabe a
  esta spec pagar. Persistir para sempre seria pior: voltar no dia seguinte a um
  filtro esquecido é mais confuso do que começar limpo.

### DEC-CPD-10 — Fixados são do usuário e moram no aparelho

O usuário pode fixar entradas; os fixados aparecem no topo da estante, junto de uma
lista curta de usados recentemente. Fixados e recentes moram no aparelho, por mundo.

- **Racional:** mesmo modelo dos dados favoritos do Chat (DEC-ACH-05) e das
  categorias de Contatos (DEC-CTT-08): preferência pessoal não é documento de mundo.

### DEC-CPD-11 — Esta aba não é a única porta do acervo, e não tenta ser

O picker dentro da ficha (`CompendiumPickerDialog`) continua existindo e é a porta
certa quando a pergunta nasce dentro de uma ficha. Esta aba é a porta para quando a
pergunta nasce na mesa.

- **Racional:** o mesmo acervo com duas portas não é duplicação se cada porta nasce
  de um contexto diferente; forçar tudo pela gaveta faria o jogador sair da ficha
  para voltar a ela.

### DEC-CPD-12 — O selo "no mundo" informa, e não promete atualização

A linha marca quando já existe no mundo um documento originado daquela entrada. O
selo NÃO promete que os dois estejam iguais: importar clona com `_id` novo
(REQ-CMP-021) e o clone não acompanha o pack.

- **Racional:** o selo evita import duplicado, que é o erro comum. Fingir que ele
  significa "atualizado" seria mentir: a `16` não define nenhum caminho de atualização
  de conteúdo já importado, e esta spec não o inventa (§11).

## 5. Requisitos funcionais

> Blocos de dezena por tema: 001–009 identidade e badge; 010–019 modos e escopo;
> 020–029 estante; 030–039 busca e facetas; 040–049 linha de resultado; 050–059
> pré-visualização; 060–069 trazer para o mundo e para a ficha; 070–079 plateia,
> permissão e redação; 080–089 estado que sobrevive, fixados e recentes; 090–099
> estado vazio, erro e acessibilidade. Lacunas são reserva.

### 5.1 Identidade e badge

- **REQ-CPD-001** [MVP] A aba DEVE se registrar por `registerSidebarTab`
  (REQ-GAV-030) com `id: "compendium"`, `group: "all"`, ícone próprio e rótulo por
  chave i18n, na quarta posição do grupo de todos (REQ-GAV-003).
- **REQ-CPD-002** [MVP] A aba DEVE fornecer badge do tipo **ponto de estado**
  (REQ-GAV-021), e NÃO DEVE usar contador.
- **REQ-CPD-003** [MVP] O ponto DEVE acender enquanto houver importação em lote em
  andamento iniciada por aquele usuário, e apagar quando ela terminar ou falhar.
- **REQ-CPD-004** [MVP] Abrir a aba NÃO DEVE alterar o ponto (REQ-GAV-022); só o fim
  do trabalho o apaga.
- **REQ-CPD-005** [MVP] Fora desse caso, a aba NÃO DEVE exibir badge algum.

### 5.2 Modos e escopo

- **REQ-CPD-010** [MVP] O painel DEVE ter exatamente dois modos de corpo — **estante**
  e **resultado de busca** — e o modo DEVE ser derivado do escopo e do conteúdo da
  busca, nunca de um controle de alternância.
- **REQ-CPD-011** [MVP] Com escopo raiz e busca vazia sem facetas, o corpo DEVE ser a
  estante (§5.3).
- **REQ-CPD-012** [MVP] Com escopo raiz e busca preenchida **ou** faceta ativa, o
  corpo DEVE ser o resultado agregado (§5.4).
- **REQ-CPD-013** [MVP] Abrir um pack DEVE mudar o escopo para aquele pack, limpar o
  texto de busca e exibir o índice do pack (REQ-CMP-012).
- **REQ-CPD-014** [MVP] Com um pack aberto, a busca DEVE filtrar apenas aquele pack, e
  o painel DEVE oferecer uma ação explícita de **ampliar para o acervo inteiro** que
  preserva o texto digitado e volta o escopo para a raiz.
- **REQ-CPD-015** [MVP] O painel DEVE exibir permanentemente qual é o escopo corrente
  em texto, e oferecer o caminho de volta à estante.
- **REQ-CPD-016** [MVP] A barra de busca DEVE ficar fora da área rolável, visível nos
  dois modos e em qualquer escopo.
- **REQ-CPD-017** [MVP] Trocar de modo NÃO DEVE alterar a largura da gaveta
  (REQ-GAV-012).

### 5.3 Estante

- **REQ-CPD-020** [MVP] A estante DEVE agrupar os packs visíveis por tipo de documento
  (REQ-CMP-012), com grupos colapsáveis e contagem de packs por grupo.
- **REQ-CPD-021** [MVP] Cada pack DEVE exibir rótulo, contagem de documentos e
  **licença** (DEC-CMP-03).
- **REQ-CPD-022** [MVP] Pack de plateia `gm` DEVE ser marcado como tal na estante do
  papel privilegiado, para que ele saiba o que o jogador não vê.
- **REQ-CPD-023** [MVP] O estado recolhido/expandido de cada grupo DEVE ser gravado no
  aparelho, por mundo e usuário (DEC-UIF-10).
- **REQ-CPD-024** [MVP] Com busca preenchida no escopo raiz, a estante NÃO DEVE ser
  exibida em paralelo ao resultado: o resultado a substitui.
- **REQ-CPD-025** [MVP] Packs do mundo (criados pelo próprio mundo) DEVEM aparecer nos
  mesmos grupos dos packs de sistema, distinguíveis pela licença exibida.

### 5.4 Busca e facetas

- **REQ-CPD-030** [MVP] A busca DEVE ser servida pelo servidor sobre todos os packs
  visíveis ao solicitante (DEC-CPD-02) e DEVE ser incremental, sem acento e sem caixa
  (REQ-CMP-013).
- **REQ-CPD-031** [MVP] O resultado DEVE vir agrupado por tipo de documento, com
  contagem por grupo, e cada linha DEVE nomear o pack de origem.
- **REQ-CPD-032** [MVP] O resultado DEVE ser limitado por grupo, e cada grupo truncado
  DEVE dizer quantos ficaram de fora e oferecer abrir aquele pack no escopo dele.
- **REQ-CPD-033** [MVP] O painel DEVE oferecer facetas de tipo de documento, faixa de
  nível e raridade, e uma faceta de **fonte** que aparece quando o resultado vem de
  mais de um pack.
- **REQ-CPD-034** [MVP] Facetas DEVEM ser combináveis entre si e com o texto, e cada
  faceta ativa DEVE ser removível individualmente.
- **REQ-CPD-035** [MVP] Os filtros específicos de sistema (traços, subtipo) DEVEM ser
  declarados pelo sistema de jogo, não codificados nesta aba (REQ-CMP-014).
- **REQ-CPD-036** [MVP] Busca sem resultado DEVE dizer em que escopo procurou e
  oferecer ampliar o escopo quando houver um mais amplo.
- **REQ-CPD-037** [V2] O usuário PODE salvar uma combinação de facetas como filtro
  nomeado (é REQ-CMP-019, que já é [V2] na área dona).

### 5.5 Linha de resultado

- **REQ-CPD-040** [MVP] Cada linha DEVE exibir imagem ou ícone de tipo, nome traduzido
  e, quando houver, nome original (DEC-CPD-06).
- **REQ-CPD-041** [MVP] A linha DEVE exibir os campos de índice que o pack declarar
  como relevantes (REQ-CMP-012), sem carregar o documento completo (DEC-CMP-02).
- **REQ-CPD-042** [MVP] A linha DEVE destacar o trecho que casou com a busca.
- **REQ-CPD-043** [MVP] A linha DEVE exibir o **selo no mundo** quando existir
  documento do mundo originado daquela entrada, com a ressalva de DEC-CPD-12
  disponível ao apontar.
- **REQ-CPD-044** [MVP] A linha DEVE ser arrastável quando o tipo do documento tiver
  destino definido (§5.7), e NÃO DEVE ser arrastável quando não tiver.
- **REQ-CPD-045** [MVP] Imagem quebrada ou placeholder conhecido DEVE cair para ícone
  de tipo sem deixar espaço vazio nem quebrar o alinhamento da lista.
- **REQ-CPD-046** [MVP] A linha NÃO DEVE exibir vida, CA ou qualquer estatística de
  criatura no papel não privilegiado — o que a plateia do pack já garante (§5.8), e
  que aqui é reafirmado como regra de tela.

### 5.6 Pré-visualização

- **REQ-CPD-050** [MVP] Pré-visualizar DEVE abrir janela flutuante (REQ-UIF-009) e
  NÃO DEVE substituir a lista dentro do painel (DEC-CPD-03).
- **REQ-CPD-051** [MVP] A janela DEVE carregar o documento completo sob demanda
  (REQ-CMP-015) e exibir estado de carregamento, erro com nova tentativa, e fechar
  sem afetar a lista.
- **REQ-CPD-052** [MVP] A janela DEVE exibir bloco de licença com a licença do pack e
  o override do documento quando houver (DEC-CPD-07).
- **REQ-CPD-053** [MVP] A janela DEVE oferecer as mesmas ações de trazer da linha
  (§5.7), respeitando as mesmas permissões.
- **REQ-CPD-054** [MVP] Mais de uma janela de pré-visualização PODE ficar aberta ao
  mesmo tempo; fechar a gaveta NÃO DEVE fechá-las.
- **REQ-CPD-055** [V2] A janela PODE oferecer navegação para o documento seguinte do
  mesmo resultado sem voltar à lista.

### 5.7 Trazer para o mundo e para a ficha

- **REQ-CPD-060** [MVP] Papel privilegiado DEVE poder trazer uma entrada para o mundo
  (REQ-CMP-016), com retorno visível de sucesso e de falha.
- **REQ-CPD-061** [MVP] Usuário com `OWNER` de um ator DEVE poder trazer uma entrada
  de tipo compatível para a ficha daquele ator (DEC-CPD-05), e o servidor DEVE
  executar a operação validando o ownership do **destino**.
- **REQ-CPD-062** [MVP] Arrastar uma entrada de ator para a cena DEVE trazê-la para o
  mundo antes de criar a presença no mapa (REQ-CMP-018), e essa criação é regida pela
  spec da cena e pela futura spec de Token — esta aba não a define.
- **REQ-CPD-063** [MVP] Arrastar uma entrada que não seja ator sobre a cena NÃO DEVE
  criar presença; o painel DEVE recusar com mensagem, sem importar nada.
- **REQ-CPD-064** [MVP] Trazer a mesma entrada duas vezes DEVE ser possível e criar um
  segundo documento (REQ-CMP-021); o painel NÃO DEVE bloquear pela existência do selo.
- **REQ-CPD-065** [MVP] Importação em lote DEVE exibir progresso e permitir cancelar,
  e o cancelamento NÃO DEVE deixar o mundo em estado parcial sem aviso (REQ-CMP-016).
- **REQ-CPD-066** [MVP] O painel NÃO DEVE oferecer criar documento do zero nem editar
  documento de pack — autoria é da `42` (DEC-NPC-01).

### 5.8 Plateia, permissão e redação

- **REQ-CPD-070** [MVP] O manifesto do pack DEVE declarar `audience` com valores
  `"all"` ou `"gm"`; ausência DEVE ser tratada como `"all"`.
- **REQ-CPD-071** [MVP] O servidor NÃO DEVE listar, buscar nem entregar documento de
  pack `gm` para usuário que não satisfaça `isRolePrivileged` (`05`), e a recusa DEVE
  ser indistinguível de "não existe" (REQ-GAV-034, REQ-SEC-020).
- **REQ-CPD-072** [MVP] Os packs de criaturas e perigos do sistema PF2e DEVEM ser
  publicados com `audience: "gm"`.
- **REQ-CPD-073** [MVP] Trazer para o mundo DEVE exigir `isRolePrivileged`; trazer
  para ficha DEVE exigir `OWNER` do ator de destino (REQ-DOC-027/028).
- **REQ-CPD-074** [MVP] Nenhuma decisão de visibilidade desta aba DEVE ser implementada
  apenas no cliente: esconder na tela não é proteger (REQ-GAV-034).
- **REQ-CPD-075** [V2] O mundo PODE reabrir um pack `gm` para os jogadores por
  configuração de mundo (`37`), sem alterar o manifesto do pack.

### 5.9 Estado que sobrevive, fixados e recentes

- **REQ-CPD-080** [MVP] Pack aberto, texto de busca e facetas ativas DEVEM ser
  restaurados ao voltar à aba dentro da mesma sessão do navegador (DEC-CPD-09).
- **REQ-CPD-081** [MVP] Esse estado DEVE ser gravado no aparelho, por mundo e usuário,
  e NÃO DEVE virar documento no servidor (DEC-UIF-10).
- **REQ-CPD-082** [MVP] O usuário DEVE poder fixar e desafixar uma entrada; os fixados
  DEVEM aparecer no topo da estante, em bloco próprio (DEC-CPD-10).
- **REQ-CPD-083** [MVP] A estante DEVE exibir um bloco curto de **usados recentemente**,
  alimentado por trazer e por pré-visualizar, com teto fixo e sem configuração.
- **REQ-CPD-084** [MVP] Fixado cujo pack deixou de ser visível (plateia, pack removido)
  DEVE sumir da lista sem erro e sem apagar os demais.

### 5.10 Estado vazio, erro e acessibilidade

- **REQ-CPD-090** [MVP] Sem pack algum visível, o painel DEVE explicar que o mundo não
  tem compêndio disponível para aquele papel, sem oferecer ação que ele não possa
  executar.
- **REQ-CPD-091** [MVP] Falha ao listar packs, ao buscar ou ao abrir um pack DEVE
  aparecer como mensagem com nova tentativa, nunca como lista vazia silenciosa.
- **REQ-CPD-092** [MVP] Toda ação da linha DEVE ser alcançável por teclado
  (REQ-UIF-064), incluindo pré-visualizar e trazer; arrastar DEVE ter equivalente por
  ação explícita.
- **REQ-CPD-093** [MVP] O resultado DEVE ser navegável por teclado com foco visível, e
  a contagem por grupo DEVE ser anunciável por leitor de tela.
- **REQ-CPD-094** [MVP] Nenhuma informação desta aba DEVE ser transmitida só por cor.

## 6. Requisitos não-funcionais

- **RNF-CPD-01** [MVP] A busca agregada DEVE responder em menos de 300 ms no acervo
  completo do PF2e em máquina de referência, medida no servidor, coerente com
  REQ-CMP-049/050.
- **RNF-CPD-02** [MVP] Digitar na busca NÃO DEVE disparar uma requisição por tecla: as
  chamadas DEVEM ser agrupadas, e uma resposta atrasada NÃO DEVE sobrescrever um
  resultado mais novo.
- **RNF-CPD-03** [MVP] A lista DEVE permanecer fluida com o maior pack do PF2e
  (equipamento, mais de 5 mil documentos) sem materializar todas as linhas.
- **RNF-CPD-04** [MVP] O painel NÃO DEVE baixar índice de pack que o usuário não abriu.

## 7. Onde cada coisa é gravada

| Coisa                        | Onde                                | Por quê                            |
| ---------------------------- | ----------------------------------- | ---------------------------------- |
| Packs, índices, documentos   | `pack.db` de cada pack (DEC-CMP-01) | acervo é conteúdo, não estado      |
| Plateia do pack (`audience`) | manifesto do pack                   | acompanha a origem, como a licença |
| Documento trazido            | `world.db`, com `_id` novo          | REQ-CMP-021                        |
| Escopo, busca e facetas      | aparelho, por mundo/usuário, sessão | ergonomia local (DEC-UIF-10)       |
| Fixados e recentes           | aparelho, por mundo/usuário         | preferência pessoal (DEC-CPD-10)   |
| Grupos recolhidos            | aparelho, por mundo/usuário         | idem                               |

## 8. Contrato da spec-mãe (§7 da 36), item a item

1. **Identidade** — `id: "compendium"`, grupo `all`, quarta do grupo, rótulo por chave
   i18n, ícone próprio (REQ-CPD-001).
2. **Badge** — ponto de estado, aceso só enquanto uma importação em lote do próprio
   usuário estiver correndo; abrir a aba não o altera (REQ-CPD-002..005).
3. **Cabeçalho do painel** — escopo corrente, caminho de volta à estante e, para papel
   privilegiado, a ação de importação em lote; sem ✕ (REQ-CPD-015, REQ-CPD-065).
4. **Estado vazio** — nenhum pack visível para aquele papel, e busca sem resultado com
   o escopo nomeado (REQ-CPD-090, REQ-CPD-036).
5. **O que abre fora da gaveta** — a pré-visualização de documento, em janela
   flutuante, uma ou várias (REQ-CPD-050..054).
6. **Permissão de conteúdo** — `isRolePrivileged` para pack `gm` e para trazer ao
   mundo; `OWNER` do ator de destino para trazer à ficha (REQ-CPD-071..073).

## 9. Dependências (specs irmãs)

- `36` — contêiner: registro (REQ-GAV-030), ordem (REQ-GAV-003), largura
  (REQ-GAV-012), badge (REQ-GAV-021/022), desmontagem ao trocar de aba (REQ-GAV-017),
  fronteira de segurança (REQ-GAV-034).
- `16` — dona do acervo: packs (DEC-CMP-01), índice leve (DEC-CMP-02), licença
  (DEC-CMP-03), browser e filtros (REQ-CMP-012..015), importar e arrastar
  (REQ-CMP-016..018), clone com `_id` novo (REQ-CMP-021/022), desempenho
  (REQ-CMP-049..051). Emendas em §12.
- `05` — `isRolePrivileged` como único predicado de privilégio.
- `02` — `ownership` e `getUserLevel` (REQ-DOC-027/028) para o destino da ficha.
- `11` — janela flutuante (REQ-UIF-009), arraste (REQ-UIF-044), teclado (REQ-UIF-064),
  fronteira de persistência (DEC-UIF-10).
- `21` — recusa indistinguível de inexistência (REQ-SEC-020).
- `42` — autoria de não-jogáveis: criar do bestiário é lá (DEC-NPC-06, REQ-NPC-042), e
  esta aba não duplica esse caminho.
- `26` — clean-room e obrigações de licença que sustentam DEC-CPD-07.
- `31` — base canônica e overlay de tradução, que alimentam DEC-CPD-06.
- Futura spec de **Token** — dona do que nasce na cena quando um ator é arrastado
  (REQ-CPD-062); esta aba não define presença no mapa (DEC-CBA-06).

## 10. Critérios de aceitação

| ID         | Critério                                                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-CPD-001 | Com a aba aberta em repouso, o corpo é a estante; digitar "fogo" troca o corpo para o resultado agregado, agrupado por tipo, com a fonte em cada linha; apagar o texto devolve a estante.                       |
| CA-CPD-002 | Com o pack Magias aberto, buscar "fogo" filtra só aquele pack; acionar "buscar em todo o acervo" mantém o texto, volta o escopo à raiz e mostra também criaturas e itens.                                       |
| CA-CPD-003 | Buscar "fireball" encontra "Bola de Fogo"; buscar "bola" encontra a mesma entrada; as duas grafias aparecem na linha.                                                                                           |
| CA-CPD-004 | O jogador abre a aba: nenhum pack de criaturas ou perigos aparece na estante, buscar "goblin" não retorna criatura alguma, e uma chamada forjada ao servidor pelo uuid da criatura é recusada como inexistente. |
| CA-CPD-005 | O Mestre vê os mesmos packs mais os de criaturas, marcados como visíveis só a ele.                                                                                                                              |
| CA-CPD-006 | Pré-visualizar abre janela fora da gaveta; a lista continua visível e navegável, e uma segunda janela pode ser aberta ao mesmo tempo.                                                                           |
| CA-CPD-007 | A janela de pré-visualização exibe a licença do pack; para um documento com `publication` próprio, exibe o override.                                                                                            |
| CA-CPD-008 | O jogador arrasta "Bola de Fogo" para a ficha do próprio personagem e a magia entra; ao tentar o mesmo em ficha de outro jogador, o servidor recusa.                                                            |
| CA-CPD-009 | O jogador não tem, em lugar nenhum da aba, ação de trazer para o mundo.                                                                                                                                         |
| CA-CPD-010 | O Mestre arrasta um ator de pack para a cena: o ator é trazido para o mundo antes de a presença existir; arrastar uma magia para a cena é recusado sem importar nada.                                           |
| CA-CPD-011 | Digitar "goblin", ir ao Chat, voltar ao Compêndio: o texto e as facetas continuam lá; fechar a aba do navegador e reabrir devolve a estante limpa.                                                              |
| CA-CPD-012 | Uma importação em lote em andamento acende o ponto no ícone da aba com a gaveta recolhida; ao terminar, o ponto apaga sem intervenção.                                                                          |
| CA-CPD-013 | Buscar no acervo completo do PF2e devolve resultado em menos de 300 ms e a lista rola sem travar no pack de equipamento.                                                                                        |
| CA-CPD-014 | Uma entrada já trazida mostra o selo "no mundo"; trazê-la de novo cria um segundo documento, e o painel não bloqueia.                                                                                           |
| CA-CPD-015 | Todas as ações da linha são alcançáveis por `Tab`/`Enter`, incluindo o equivalente do arraste.                                                                                                                  |

## 11. O que esta spec ainda NÃO decide

| Assunto                                            | Por que ainda não                                                         | Onde vai ser decidido      |
| -------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| Atualizar no mundo o que o pack mudou              | Depende de identidade estável entre clone e origem, que a `16` não define | `16`                       |
| Editar documento de pack de mundo                  | É autoria, e a autoria de não-jogável acabou de nascer na `42`            | `42`, spec futura de ficha |
| O que exatamente nasce na cena ao arrastar um ator | Token não tem spec dona                                                   | futura spec de Token       |
| Filtros compostos salvos                           | Já é [V2] na área dona                                                    | REQ-CMP-019                |
| Import de pack inteiro / pasta                     | Já é [V2] na área dona                                                    | REQ-CMP-020                |

## 12. Emendas que esta spec obriga

Registradas para que o PR não deixe nenhuma spec contrariada em silêncio
(`CONVENCOES.md` §2):

| Spec | O que muda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `16` | **REQ-CMP-013** já ganhou irmã: além da busca dentro do pack, o servidor DEVE oferecer busca **sobre todos os packs visíveis ao solicitante** (DEC-CPD-02, REQ-CPD-030). **O manifesto do pack já declara `audience`** (DEC-CPD-04, REQ-CPD-070), ao lado de `license`. O **overlay de nome traduzido**, que já existe em produção e não estava em spec, já é exigência de exibição e de busca (DEC-CPD-06) — emenda aplicada na `16` em 2026-08-16: REQ-CMP-004a (plateia no manifesto, ausência = `all`), REQ-CMP-010a (plateia imposta no servidor), REQ-CMP-013a (busca agregada), REQ-CMP-007a/012a/013b (dois nomes no índice, na exibição e na busca) e CA-CMP-14/15. |
| `11` | **REQ-UIF-002** já teve sua lista de abas substituída pela DEC-GAV-01; registra-se que o painel de compêndio é definido aqui, e que o picker de ficha continua válido como segunda porta (DEC-CPD-11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `05` | Nada muda no modelo de papéis. Registra-se um segundo consumidor de `isRolePrivileged` fora de escrita: **visibilidade de acervo** (REQ-CPD-071).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `17` | Os packs de criaturas e perigos publicados pelo sistema PF2e já DEVEM nascer com `audience: "gm"` (REQ-CPD-072); é mudança de publicação, não de conteúdo — emenda aplicada na `17` em 2026-08-16: REQ-PF2-140 (`audience` no manifesto de todo pack), REQ-PF2-141 (criaturas `gm`), REQ-PF2-142 (perigos `gm`, prospectivo — o sistema ainda não publica pack de perigos), REQ-PF2-143 (demais packs `all`), REQ-PF2-144 (proibido compensar a plateia mexendo no conteúdo) e REQ-PF2-145 (trocar plateia é edição de manifesto).                                                                                                                                           |

## 13. Questões em aberto

- **Q-CPD-01** — A plateia `gm` do bestiário atrapalha o jogador que **quer** consultar
  a criatura que o personagem dele conhece (um familiar, um aliado)? A saída provável é
  a reabertura por mundo (REQ-CPD-075), mas isso vira exceção por pack inteiro, não por
  criatura.
- **Q-CPD-02** — Trazer para a ficha do próprio personagem deveria deixar rastro para o
  Mestre (o jogador acaba de puxar uma magia de nível 9)? Hoje não deixa.
- **Q-CPD-03** — O bloco de recentes é por usuário ou por mundo compartilhado? Está no
  aparelho, então é por usuário — mas na mesa presencial o Mestre e os jogadores usam o
  mesmo acervo e talvez quisessem "o que a mesa acabou de usar".
- **Q-CPD-04** — Quantos resultados por grupo antes de truncar (REQ-CPD-032)? O número
  só sai de uso real; o protótipo não o fixou.
- **Q-CPD-05** — A aba deveria mostrar packs **desabilitados** no mundo (existentes, mas
  fora de uso) ou eles simplesmente não existem para ela?

## 14. Referências

- `packages/client/prototypes/compendium-tab.prototype.html` — rodada 1 do grill, três
  variantes; a decisão foi A com o resultado de B ao buscar no geral.
- `packages/client/src/components/compendium/CompendiumBrowser.svelte` e
  `packages/client/src/lib/compendium/` — implementação existente.
- `packages/server/src/compendium/` — handlers de list/index/search/get/import.
