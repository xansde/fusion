# 44 — Aba Cenas

- **Título:** Aba Cenas — o que está no ar, e o acervo que espera a vez
- **Status:** draft v0.1 (grill rodada 1 concluído em 2026-08-16)
- **Data:** 2026-08-16
- **Spec-mãe:** [`36-gaveta-lateral.md`](36-gaveta-lateral.md) — esta é a spec-filha da aba `scenes` (DEC-GAV-01, grupo GM), e é a aba em que o Mestre **abre o mundo** no primeiro acesso (DEC-GAV-02).
- **Áreas donas do conteúdo:** [`06-canvas-e-renderizacao.md`](06-canvas-e-renderizacao.md) (cena, ativação, initial view) e [`07-visao-iluminacao-fog.md`](07-visao-iluminacao-fog.md) (escuridão, iluminação global, névoa). Esta spec **exibe e comanda**; não redefine.
- **Baseada em:**
  - Protótipo `packages/client/prototypes/scenes-tab.prototype.html` — rodada 1, três variantes (lista · galeria · mesa). Decisão do Alexandre em 2026-08-16: **mesa (C)**.
  - `ScenesSidebar.svelte`, `SceneCreateDialog.svelte`, `ScenePerceptionDialog.svelte`, `lib/scenes/{scenesState,sceneController}.ts` e o handler `world:activeScene` — implementação existente que esta spec formaliza.

> **A aba é a porta de entrada do Mestre.** DEC-GAV-02 faz o papel privilegiado abrir
> o mundo nesta aba. Ela precisa responder "o que a mesa está vendo agora" antes de
> "quais cenas existem" — e é isso que o desenho escolhido faz.

---

## 1. Objetivo

Dar ao Mestre, em um lugar só, o estado da cena que a mesa está vendo, os controles
que ele aperta durante a sessão, e o acervo de cenas para preparar e trocar.

## 2. Escopo

### 2.1 Inclui

- A cabeça **no ar**: qual cena a mesa vê, com que ambiente, e os controles de sessão.
- O acervo: lista de cenas agrupada por pasta, com busca, ordem e ações por cena.
- Pôr uma cena no ar, e o que isso faz com todo mundo.
- **Preparar** uma cena sem levar a mesa junto.
- O que abre em janela (criar, configurar, percepção, excluir).

### 2.2 Não inclui

- O que é uma cena, seus campos, camadas, initial view e o que "ativar" faz no canvas →
  `06` (REQ-CNV-068..071). Esta spec cita.
- Escuridão, iluminação global, névoa e seu reset → `07` (REQ-VIS-044, REQ-VIS-085/086).
  A aba só aciona.
- Edição de paredes, luzes, sons e desenhos → `06`/`07`; são ferramentas do canvas.
- Presenças no mapa (o que hoje se chama token) → futura spec de Token (DEC-CBA-06).
- **Mapa de região** → `34` (DEC-MREG-08): é documento, não cena, e não entra nesta
  lista.
- Minimapa tático → `32` (DEC-MMT-01).
- Geração de miniatura de cena → `06`/`20` (DEC-CEN-04 declara a dependência).

## 3. Conceitos e terminologia

| Conceito      | Definição                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| **No ar**     | A cena ativa: a que **todos** os clientes renderizam. Existe no máximo uma por mundo.                        |
| **Pôr no ar** | O gesto que troca a cena ativa. Vale para a mesa inteira, na hora.                                           |
| **Preparar**  | Abrir uma cena no canvas **do próprio Mestre**, sem alterar o que a mesa vê. É estado local do cliente dele. |
| **Acervo**    | As demais cenas do mundo, agrupadas por pasta.                                                               |
| **Ambiente**  | Escuridão, iluminação global e névoa da cena — parâmetros de `07` que a cabeça expõe.                        |

## 4. Decisões

### DEC-CEN-01 — O painel tem cabeça fixa e acervo abaixo

O topo do painel, fora da área rolável, é a cena **no ar**: identificação, ambiente e
os controles de sessão. Abaixo, rolável, o acervo.

- A cabeça tem **altura fixa**, definida por token de tema, e não muda de altura por
  nome longo, por ambiente ou por falta de imagem.
- **Racional:** a aba é a primeira coisa que o Mestre vê ao entrar (DEC-GAV-02), e
  durante a sessão ele opera duas ou três cenas, não o acervo. A altura fixa segue o
  mesmo motivo da cabeça de turno (DEC-CBA-02): os controles que se apertam várias
  vezes por sessão não podem mudar de lugar. Substitui a lista plana de hoje, que
  trata a cena ativa como mais uma linha.

### DEC-CEN-02 — Cena ativa é global, tem um escritor só, e isso é normativo

Existe no máximo **uma** cena no ar por mundo. Trocá-la é um evento dedicado, restrito
a papel privilegiado, que grava a fonte única e transmite a todos os clientes. Alterar
`active` por atualização genérica de documento DEVE ser recusado pelo servidor.

- **Racional:** já é o comportamento do servidor (`world:activeScene`, com a recusa no
  handler genérico e a fonte única em `settings`), mas vivia apenas num comentário de
  migration — e regra que só existe no código é regra que a próxima refatoração
  desfaz. Duas fontes de "cena ativa" (o campo do documento e a configuração do mundo)
  divergiriam no primeiro conflito de escrita.

### DEC-CEN-03 — Preparar é local do Mestre; pôr no ar é o gesto separado

O Mestre PODE abrir qualquer cena para preparar. Isso troca a cena renderizada **no
cliente dele**, não altera a cena no ar, não é gravado no servidor e não muda a tela
de ninguém. Enquanto ele estiver preparando, o canvas exibe um aviso persistente com
o nome da cena no ar e a ação de pôr a preparada no ar.

- **Racional:** hoje não existe "olhar sem levar a mesa junto": clicar em ativar
  teleporta todo mundo, inclusive no meio de um encontro na outra cena. A alternativa
  cara seria navegação divergente de verdade, com cena por usuário na presença
  (REQ-USR-032/033 não carrega isso hoje). O preparo local resolve o caso real do
  Mestre por um custo baixo, sem prometer o que o servidor não sabe.
- **Consequência declarada:** o que o Mestre fizer na cena em preparo (mover presença,
  medir, apontar) acontece na cena preparada, e ninguém vê. É o preço aceito.

### DEC-CEN-04 — A cabeça mostra a imagem de fundo da cena; miniatura gerada fica para depois

A cabeça exibe a imagem de **fundo** da cena, escalada pelo cliente. A lista do acervo
não exibe imagem no MVP.

- **Racional:** o campo `thumb` existe no documento e **nada o preenche** — gerar
  miniatura é trabalho de canvas (renderizar e salvar), não de UI. Usar o fundo custa
  banda em uma imagem só (a da cena no ar) e é honesto; espalhar imagens grandes por
  uma lista de 30 cenas não é. Quando a geração existir, a lista pode ganhar imagem
  sem que esta decisão precise mudar de forma.

### DEC-CEN-05 — O acervo agrupa por pasta, e a aba não gerencia pastas

As cenas aparecem agrupadas pela pasta a que pertencem, ordenadas dentro do grupo pela
ordenação manual do documento. A aba **não** cria, renomeia nem apaga pasta: a pasta
de uma cena se escolhe na janela de configuração dela.

- **Racional:** pasta e ordenação já existem no documento e a UI nunca as usou — numa
  campanha real ("Ato 1", "Ato 2", "Rascunhos") a lista plana vira um paredão. Trazer
  o gerenciador de pastas inteiro para 300px repetiria a árvore que a `42` já tem para
  não-jogáveis; aqui basta o agrupamento.

### DEC-CEN-06 — Os controles de ambiente ficam na cabeça, e são atalhos, não uma segunda dona

A cabeça oferece: alternar escuridão, alternar névoa e **resetar a névoa** da cena no
ar. Esses controles acionam os requisitos de `07`; esta spec não define semântica de
iluminação nem de exploração.

- **Racional:** são os três gestos que acontecem no meio da sessão ("apaga a luz",
  "eles voltaram, reseta"). Deixá-los só na janela de percepção obriga a abrir uma
  janela para uma ação de dois segundos. O limite é claro: alternar e resetar ficam
  aqui; ajustar valores (nível de escuridão, limiar, visão por token) fica na janela.

### DEC-CEN-07 — Excluir a cena que está no ar é recusado

A exclusão de cena é recusada enquanto ela estiver no ar, com a razão explícita e o
caminho (pôr outra no ar antes). Excluir uma cena leva junto o que é embutido nela
(presenças, paredes, luzes, sons, desenhos) e **não** leva os atores.

- **Racional:** mesmo princípio da recusa de exclusão com combate ativo (DEC-NPC-12):
  a operação destrutiva não pode ser a que resolve o estado. Sem a recusa, a mesa
  inteira cai na tela de espera por um clique de limpeza.

### DEC-CEN-08 — Sem badge em repouso; ponto de estado só enquanto o Mestre prepara

A aba não tem contador. Ela acende um **ponto de estado** enquanto o Mestre estiver com
uma cena em preparo diferente da que está no ar, e o apaga quando ele sair do preparo
ou puser a preparada no ar.

- **Racional:** cena não tem "coisa nova que você não viu". O único estado que merece o
  trilho é o que o próprio desenho criou: estar olhando algo diferente do que a mesa
  vê é a condição em que se esquece de voltar. É consequência direta de DEC-CEN-03 — se
  o preparo cair, o badge cai junto.

### DEC-CEN-09 — O que não cabe em 300px abre em janela, e a lista fica com cinco verbos

Criar cena, configurar (nome, pasta, dimensões, preenchimento, grade, fundo), percepção
(escuridão, iluminação global, limiar, visão por token) e confirmar exclusão abrem
**janela flutuante** (REQ-UIF-009). Na lista sobram: **pôr no ar · preparar ·
configurar · duplicar · excluir**.

- **Racional:** DEC-GAV-04. Os três diálogos já existem no cliente; o trabalho é
  ligá-los à gaveta, não reescrevê-los dentro dela.

### DEC-CEN-10 — Mapa de região não entra na lista, e a aba diz isso em voz alta

O acervo lista apenas cenas. O painel exibe, no rodapé, uma linha curta informando que
o mapa de região vive no Hub.

- **Racional:** os dois são "o mapa" no vocabulário da mesa, e DEC-MREG-08 já decidiu
  que região é documento. Uma linha barata evita a busca frustrada; sem ela, a pergunta
  volta a cada sessão.

### DEC-CEN-11 — A aba é do Mestre, e a fronteira é o servidor

A aba pertence ao grupo GM (DEC-GAV-01) e não aparece no trilho do jogador; a proteção
real é o predicado do servidor, não a ausência do ícone.

- **Racional:** REQ-GAV-034 sem exceção. Listar cenas revela nomes de lugares que a
  campanha ainda não mostrou.

## 5. Requisitos funcionais

> Blocos de dezena por tema: 001–009 identidade e badge; 010–019 cabeça no ar;
> 020–029 ambiente e controles de sessão; 030–039 acervo, pastas e busca; 040–049 pôr
> no ar; 050–059 preparar; 060–069 criar, configurar, duplicar e excluir; 070–079
> permissão e redação; 080–089 estado vazio e limites; 090–099 acessibilidade.
> Lacunas são reserva.

### 5.1 Identidade e badge

- **REQ-CEN-001** [MVP] A aba DEVE se registrar por `registerSidebarTab`
  (REQ-GAV-030) com `id: "scenes"`, `group: "gm"`, ícone próprio e rótulo por chave
  i18n, no bloco intermediário do trilho (REQ-GAV-003).
- **REQ-CEN-002** [MVP] A aba DEVE ser a aba de primeiro acesso do papel privilegiado
  (REQ-GAV-015, DEC-GAV-02).
- **REQ-CEN-003** [MVP] A aba DEVE fornecer badge do tipo **ponto de estado**
  (REQ-GAV-021) e NÃO DEVE usar contador.
- **REQ-CEN-004** [MVP] O ponto DEVE acender enquanto houver cena em preparo diferente
  da cena no ar, e apagar ao sair do preparo ou ao pôr a preparada no ar.
- **REQ-CEN-005** [MVP] Abrir a aba NÃO DEVE alterar o ponto (REQ-GAV-022).

### 5.2 Cabeça no ar

- **REQ-CEN-010** [MVP] O painel DEVE exibir no topo, fora da área rolável, a cena no
  ar, com altura fixa definida por token de tema (DEC-CEN-01).
- **REQ-CEN-011** [MVP] A cabeça DEVE exibir nome da cena, dimensões, tamanho da grade
  e a imagem de fundo da cena escalada (DEC-CEN-04).
- **REQ-CEN-012** [MVP] Cena sem imagem de fundo DEVE exibir a cor de fundo da própria
  cena, sem alterar a altura da cabeça.
- **REQ-CEN-013** [MVP] A cabeça NÃO DEVE mudar de altura por nome longo, por ambiente
  ou por ausência de imagem; o que não couber DEVE ser truncado de forma legível.
- **REQ-CEN-014** [MVP] Sem cena no ar, a cabeça DEVE dizê-lo explicitamente e oferecer
  pôr uma cena no ar, informando que os jogadores estão na tela de espera.
- **REQ-CEN-015** [MVP] A cabeça DEVE refletir a troca de cena no ar feita por qualquer
  origem, sem recarregar a aba.
- **REQ-CEN-016** [V2] A cabeça PODE exibir quantos usuários estão vendo aquela cena,
  quando a presença carregar essa informação (Q-CEN-05).

### 5.3 Ambiente e controles de sessão

- **REQ-CEN-020** [MVP] A cabeça DEVE oferecer alternar a **escuridão** da cena no ar
  entre o valor configurado e nenhuma escuridão (REQ-VIS-044).
- **REQ-CEN-021** [MVP] A cabeça DEVE oferecer alternar a **névoa** da cena no ar
  (REQ-VIS-085).
- **REQ-CEN-022** [MVP] A cabeça DEVE oferecer **resetar a névoa** da cena no ar para
  todos os usuários (REQ-VIS-086), com confirmação, por ser irreversível.
- **REQ-CEN-023** [MVP] Os controles de ambiente DEVEM refletir imediatamente o estado
  vindo do servidor e NÃO DEVEM manter estado otimista divergente.
- **REQ-CEN-024** [MVP] Esses controles NÃO DEVEM aparecer para cena que não esteja no
  ar; ajustar ambiente de outra cena se faz na janela de percepção (REQ-CEN-062).
- **REQ-CEN-025** [MVP] A aba NÃO DEVE definir semântica de iluminação, visão ou
  exploração: ela aciona os requisitos de `07`.

### 5.4 Acervo, pastas e busca

- **REQ-CEN-030** [MVP] Abaixo da cabeça, o painel DEVE listar as demais cenas do mundo,
  agrupadas pela pasta de cada uma (DEC-CEN-05).
- **REQ-CEN-031** [MVP] Dentro de cada grupo, as cenas DEVEM seguir a ordenação manual
  do documento; cena nova DEVE entrar ao fim do seu grupo.
- **REQ-CEN-032** [MVP] Cenas sem pasta DEVEM aparecer em um grupo próprio, sempre por
  último.
- **REQ-CEN-033** [MVP] O estado recolhido/expandido de cada grupo DEVE ser gravado no
  aparelho, por mundo e usuário (DEC-UIF-10).
- **REQ-CEN-034** [MVP] O painel DEVE oferecer busca por nome de cena e de pasta quando
  o mundo tiver mais cenas do que couber sem rolagem, e a busca DEVE ocultar grupos sem
  resultado.
- **REQ-CEN-035** [MVP] Cada linha DEVE exibir nome, dimensões e marcas de ambiente
  (escuridão, névoa) da cena.
- **REQ-CEN-036** [MVP] A cena no ar NÃO DEVE ser repetida no acervo: ela vive na cabeça.
- **REQ-CEN-037** [MVP] O papel privilegiado DEVE poder reordenar cenas dentro de um
  grupo por arraste, e a nova ordem DEVE ser gravada no documento.
- **REQ-CEN-038** [V2] A lista PODE exibir miniatura por cena quando a geração de
  `thumb` existir (DEC-CEN-04).
- **REQ-CEN-039** [MVP] O painel DEVE exibir, no rodapé, a linha que aponta o mapa de
  região para o Hub (DEC-CEN-10), sem oferecer navegação para dentro dele nesta aba.

### 5.5 Pôr no ar

- **REQ-CEN-040** [MVP] O papel privilegiado DEVE poder pôr qualquer cena no ar a partir
  da linha do acervo e a partir do aviso de preparo.
- **REQ-CEN-041** [MVP] Pôr no ar DEVE usar o evento dedicado de cena ativa, DEVE gravar
  a fonte única e DEVE transmitir a troca a todos os clientes (DEC-CEN-02, REQ-CNV-070).
- **REQ-CEN-042** [MVP] O servidor DEVE recusar alteração de `active` por atualização
  genérica de documento, de qualquer origem (DEC-CEN-02).
- **REQ-CEN-043** [MVP] Pôr no ar NÃO DEVE pedir confirmação; a troca DEVE ser
  imediatamente visível na cabeça e no canvas de todos.
- **REQ-CEN-044** [MVP] Pôr no ar a cena que está em preparo DEVE encerrar o preparo
  (DEC-CEN-03).
- **REQ-CEN-045** [MVP] Falha ao pôr no ar DEVE aparecer como mensagem no painel, sem
  deixar a cabeça em estado divergente do servidor.
- **REQ-CEN-046** [MVP] Pôr no ar DEVE aplicar a initial view da cena de destino
  (REQ-CNV-068).
- **REQ-CEN-047** [V2] O painel PODE oferecer pré-carregar os assets de uma cena antes
  de pô-la no ar (REQ-CNV-071).

### 5.6 Preparar

- **REQ-CEN-050** [MVP] O papel privilegiado DEVE poder abrir qualquer cena do acervo
  em **preparo**, e isso NÃO DEVE alterar a cena no ar (DEC-CEN-03).
- **REQ-CEN-051** [MVP] O preparo DEVE ser estado do cliente do Mestre e NÃO DEVE ser
  gravado no servidor nem transmitido a outro cliente.
- **REQ-CEN-052** [MVP] Enquanto houver preparo, o canvas DEVE exibir aviso persistente
  com o nome da cena no ar e as ações de pôr no ar e de sair do preparo.
- **REQ-CEN-053** [MVP] Sair do preparo DEVE devolver o canvas do Mestre à cena no ar.
- **REQ-CEN-054** [MVP] Se a cena em preparo for posta no ar por outra origem, o preparo
  DEVE terminar sozinho, sem aviso de erro.
- **REQ-CEN-055** [MVP] Se a cena em preparo for excluída, o preparo DEVE terminar e o
  canvas DEVE voltar à cena no ar.
- **REQ-CEN-056** [MVP] O acervo DEVE distinguir visualmente a cena em preparo, sem
  depender apenas de cor.

### 5.7 Criar, configurar, duplicar e excluir

- **REQ-CEN-060** [MVP] O cabeçalho do painel DEVE oferecer criar cena, e a criação DEVE
  abrir janela flutuante (DEC-CEN-09).
- **REQ-CEN-061** [MVP] Configurar uma cena (nome, pasta, dimensões, preenchimento,
  grade, fundo) DEVE abrir janela flutuante, e NÃO DEVE acontecer dentro da gaveta.
- **REQ-CEN-062** [MVP] A percepção da cena (escuridão, iluminação global, limiar, visão
  por token) DEVE abrir janela flutuante, alcançável a partir da janela de configuração
  e da cabeça (REQ-VIS-044, REQ-VIS-085).
- **REQ-CEN-063** [MVP] Excluir DEVE abrir confirmação que nomeia o que cai junto
  (presenças, paredes, luzes, sons, desenhos) e o que não cai (atores) — DEC-CEN-07.
- **REQ-CEN-064** [MVP] Excluir a cena que está no ar DEVE ser recusado, com a razão e o
  caminho para resolver (DEC-CEN-07).
- **REQ-CEN-065** [MVP] Criar cena NÃO DEVE pô-la no ar automaticamente.
- **REQ-CEN-066** [V2] O painel PODE oferecer **duplicar** uma cena, criando cópia com
  `_id` novo, mesma configuração e mesma pasta (Q-CEN-02).
- **REQ-CEN-067** [MVP] O cabeçalho NÃO DEVE conter ✕ de fechar (DEC-GAV-03) nem
  controle de largura.

### 5.8 Permissão e redação

- **REQ-CEN-070** [MVP] Toda ação desta aba DEVE exigir `isRolePrivileged` no servidor
  (`05`), e não apenas a ausência do ícone no trilho (REQ-GAV-034).
- **REQ-CEN-071** [MVP] O servidor NÃO DEVE entregar a lista de cenas a usuário não
  privilegiado; a recusa DEVE ser indistinguível de inexistência (REQ-SEC-020).
- **REQ-CEN-072** [MVP] O jogador DEVE continuar recebendo os dados da cena no ar
  necessários para renderizá-la, com a redação por papel já definida em `02`
  (REQ-DOC-058) e `07`.
- **REQ-CEN-073** [MVP] O nome de cena que não está no ar NÃO DEVE aparecer em nenhum
  payload destinado a usuário não privilegiado.

### 5.9 Estado vazio e limites

- **REQ-CEN-080** [MVP] Mundo sem cena alguma DEVE exibir estado vazio que explique o
  que é uma cena e ofereça criar a primeira, e a cabeça DEVE indicar que não há nada no
  ar (REQ-CEN-014).
- **REQ-CEN-081** [MVP] Busca sem resultado DEVE dizê-lo sem esconder a cabeça.
- **REQ-CEN-082** [MVP] Falha ao listar cenas DEVE aparecer como mensagem com nova
  tentativa, nunca como acervo vazio silencioso.
- **REQ-CEN-083** [MVP] O acervo DEVE permanecer utilizável com pelo menos 50 cenas em
  10 pastas, sem alterar a largura da gaveta.

### 5.10 Acessibilidade

- **REQ-CEN-090** [MVP] Todas as ações da linha e da cabeça DEVEM ser alcançáveis por
  teclado com foco visível (REQ-UIF-064).
- **REQ-CEN-091** [MVP] O estado "no ar" e o estado "em preparo" NÃO DEVEM ser
  transmitidos só por cor.
- **REQ-CEN-092** [MVP] A troca de cena no ar DEVE ser anunciável por leitor de tela.

## 6. Requisitos não-funcionais

- **RNF-CEN-01** [MVP] Pôr uma cena no ar DEVE refletir na cabeça de todos os clientes
  em menos de 200 ms na rede local, descontado o carregamento de assets.
- **RNF-CEN-02** [MVP] A imagem de fundo exibida na cabeça NÃO DEVE ser baixada em
  resolução plena para servir de miniatura quando o navegador puder pedir versão menor.
- **RNF-CEN-03** [MVP] Entrar e sair do preparo NÃO DEVE emitir escrita alguma ao
  servidor.

## 7. Onde cada coisa é gravada

| Coisa                       | Onde                               | Por quê                           |
| --------------------------- | ---------------------------------- | --------------------------------- |
| Cena e seus embutidos       | `world.db`, documento `Scene`      | conteúdo de mundo                 |
| Qual cena está no ar        | configuração de mundo, fonte única | DEC-CEN-02, um escritor só        |
| Pasta e ordem da cena       | campos do próprio documento        | é dado de mundo, compartilhado    |
| Ambiente (escuridão, névoa) | campos da cena (`07`)              | a aba só aciona                   |
| Cena em preparo             | memória do cliente do Mestre       | DEC-CEN-03, não é estado de mundo |
| Grupos recolhidos           | aparelho, por mundo/usuário        | ergonomia local (DEC-UIF-10)      |

## 8. Contrato da spec-mãe (§7 da 36), item a item

1. **Identidade** — `id: "scenes"`, grupo `gm`, bloco intermediário, rótulo por chave
   i18n, ícone próprio; aba de primeiro acesso do Mestre (REQ-CEN-001/002).
2. **Badge** — ponto de estado, aceso só enquanto houver cena em preparo diferente da
   que está no ar (REQ-CEN-003..005).
3. **Cabeçalho do painel** — contagem de cenas e a ação de criar; sem ✕
   (REQ-CEN-060, REQ-CEN-067).
4. **Estado vazio** — mundo sem cenas, com o convite a criar a primeira; e "nada no ar"
   na cabeça (REQ-CEN-080, REQ-CEN-014).
5. **O que abre fora da gaveta** — criar, configurar, percepção e confirmação de
   exclusão, todas em janela flutuante (REQ-CEN-060..063).
6. **Permissão de conteúdo** — `isRolePrivileged` no servidor para listar e para toda
   ação; recusa indistinguível de inexistência (REQ-CEN-070/071).

## 9. Dependências (specs irmãs)

- `36` — contêiner: registro (REQ-GAV-030), ordem (REQ-GAV-003), largura (REQ-GAV-012),
  primeiro acesso (REQ-GAV-015), badge (REQ-GAV-021/022), fronteira de segurança
  (REQ-GAV-034).
- `06` — dona da cena e da ativação: initial view (REQ-CNV-068), parâmetros de ambiente
  (REQ-CNV-069), ativar (REQ-CNV-070) e abrir sem ativar (REQ-CNV-070a), preload [V2]
  (REQ-CNV-071).
- `07` — dona do ambiente: escuridão e iluminação global (REQ-VIS-044), flag de névoa e
  visão por token (REQ-VIS-085), reset de névoa (REQ-VIS-086/087).
- `05` — `isRolePrivileged`; presença de usuários (REQ-USR-032/033), que hoje não carrega
  cena — o que sustenta DEC-CEN-03 e Q-CEN-05.
- `11` — janela flutuante (REQ-UIF-009), teclado (REQ-UIF-064), fronteira de persistência
  (DEC-UIF-10).
- `02` — documento `Scene` e redação por papel (REQ-DOC-058).
- `21` — recusa indistinguível de inexistência (REQ-SEC-020).
- `34` — mapa de região é documento e não entra nesta lista (DEC-MREG-08).
- `32` — minimapa consome a cena no ar; não é definido aqui (DEC-MMT-01).
- `20` — origem da imagem de fundo exibida na cabeça.
- Futura spec de **Token** — dona das presenças que a cena carrega (DEC-CBA-06).

## 10. Critérios de aceitação

| ID         | Critério                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-CEN-001 | O Mestre entra no mundo pela primeira vez: a gaveta abre nesta aba, com a cena no ar na cabeça e o acervo abaixo.                                                       |
| CA-CEN-002 | A cabeça mantém a mesma altura com cena de nome curto sem fundo e com cena de nome longo com fundo; nenhum controle muda de posição.                                    |
| CA-CEN-003 | O Mestre põe outra cena no ar: o canvas de todos os clientes troca, a cabeça atualiza, e nenhuma confirmação foi pedida.                                                |
| CA-CEN-004 | Uma tentativa forjada de alterar `active` por atualização genérica de documento é recusada pelo servidor, e a cena no ar não muda.                                      |
| CA-CEN-005 | O Mestre abre uma cena em preparo: o canvas dele troca, o dos jogadores não; o aviso mostra o nome da cena no ar; o ícone da aba acende o ponto com a gaveta recolhida. |
| CA-CEN-006 | A partir do preparo, pôr no ar leva a mesa para lá, o aviso some e o ponto apaga.                                                                                       |
| CA-CEN-007 | Enquanto o Mestre prepara, um jogador que entra no mundo cai na cena que está no ar, não na preparada.                                                                  |
| CA-CEN-008 | Excluir a cena que está no ar é recusado com a razão; excluir outra cena mostra o que cai junto e não apaga ator nenhum.                                                |
| CA-CEN-009 | Resetar a névoa pede confirmação; confirmado, a exploração dos jogadores volta ao início naquela cena.                                                                  |
| CA-CEN-010 | Alternar escuridão na cabeça muda o ambiente da cena no ar para todos, e o controle reflete o estado do servidor mesmo se a mudança vier de outra origem.               |
| CA-CEN-011 | Com 50 cenas em 10 pastas, o acervo agrupa, rola e busca sem alterar a largura da gaveta; a cena no ar não aparece duplicada na lista.                                  |
| CA-CEN-012 | Configurar uma cena abre janela fora da gaveta; a gaveta continua com a mesma largura e a lista continua visível.                                                       |
| CA-CEN-013 | O jogador não tem o ícone desta aba, e uma chamada forjada à listagem de cenas é recusada como inexistente.                                                             |
| CA-CEN-014 | Mundo sem cenas: a cabeça diz que não há nada no ar, o corpo convida a criar a primeira, e o jogador vê a tela de espera.                                               |
| CA-CEN-015 | O rodapé informa onde fica o mapa de região, e o mapa de região não aparece em nenhum grupo do acervo.                                                                  |

## 11. O que esta spec ainda NÃO decide

| Assunto                                            | Por que ainda não                                         | Onde vai ser decidido  |
| -------------------------------------------------- | --------------------------------------------------------- | ---------------------- |
| Navegação divergente de verdade (cena por usuário) | Exige cena na presença, que `05` não carrega              | Q-CEN-05, `05`         |
| Miniatura gerada da cena                           | Precisa de pipeline de render e armazenamento             | `06`/`20`, REQ-CEN-038 |
| Gerenciar pastas (criar, renomear, mover)          | O agrupamento resolve o MVP; o gerenciador é outro escopo | Q-CEN-01               |
| Duplicar cena                                      | Não existe no controller e não é obrigatório para jogar   | Q-CEN-02, REQ-CEN-066  |
| Pré-visualizar o fog de um jogador                 | Já é [V2] na área dona                                    | REQ-VIS-089            |

## 12. Emendas que esta spec obriga

Registradas para que o PR não deixe nenhuma spec contrariada em silêncio
(`CONVENCOES.md` §2):

| Spec | O que muda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `06` | **REQ-CNV-070** ("o cliente DEVE permitir navegar entre cenas e ativar uma cena") já foi rachado nas duas metades que esta spec exige: **ativar** é global, com escritor único e recusa de `active` no caminho genérico (DEC-CEN-02, REQ-CEN-040/041/042), e **navegar sem ativar** virou **REQ-CNV-070a**, preparo local de papel privilegiado, estado do cliente e nunca navegação por usuário (DEC-CEN-03, REQ-CEN-050/051/052/044/053) — emenda aplicada na `06` em 2026-08-16, junto da nota sob o requisito, da linha de `44` na tabela de dependências da `06` e da segunda metade de **CA-CNV-16**. |
| `07` | Nada muda na semântica. Registra-se que escuridão (REQ-VIS-044), névoa (REQ-VIS-085) e reset (REQ-VIS-086) ganham um acionador fora do canvas, na cabeça desta aba, restrito à cena no ar (DEC-CEN-06).                                                                                                                                                                                                                                                                                                                                                                                                     |
| `11` | **REQ-UIF-002** já teve sua lista de abas substituída pela DEC-GAV-01; registra-se que o painel de cenas é definido aqui e que os diálogos existentes de cena passam a ser janelas do window manager (DEC-CEN-09).                                                                                                                                                                                                                                                                                                                                                                                          |
| `05` | Nada muda. Registra-se que a presença (REQ-USR-032/033) **não** carrega cena, e que é por isso que o preparo é local (DEC-CEN-03); se um dia carregar, Q-CEN-05 reabre a decisão.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `02` | Nada muda no modelo. Registra-se que `folder` e `sort` de `Scene`, que existiam sem consumidor de UI, passam a ter um (DEC-CEN-05).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 13. Questões em aberto

- **Q-CEN-01** — Gerenciar pastas (criar, renomear, mover, excluir) fica onde? A `42` tem
  árvore de pastas para não-jogáveis; repetir o gerenciador aqui duplicaria a UI, e não
  ter nenhum lugar deixa a pasta só editável pela janela de configuração de cada cena.
- **Q-CEN-02** — Duplicar cena entra no MVP? É o pedido mais óbvio de quem prepara
  sessão (mesmo grid, mesmo fundo), e não existe no controller de hoje.
- **Q-CEN-03** — Resetar a névoa por usuário (REQ-VIS-086 permite) deveria estar na
  cabeça, ou só na janela? Aqui só existe o reset para todos.
- **Q-CEN-04** — O aviso de preparo deveria impedir alguma ação (mover presença, medir)
  na cena preparada, já que ninguém mais vê o que acontece nela?
- **Q-CEN-05** — Quando a presença carregar a cena de cada usuário, o preparo local vira
  navegação de verdade — e aí "quantos estão vendo esta cena" (REQ-CEN-016) passa a
  significar alguma coisa. Vale antecipar isso, ou esperar a `05` mudar?
- **Q-CEN-06** — Pôr no ar durante um encontro ativo em outra cena: recusar, avisar ou
  deixar passar? A `10` é dona do encontro e não trata de troca de cena.

## 14. Referências

- `packages/client/prototypes/scenes-tab.prototype.html` — rodada 1 do grill, três
  variantes; a decisão foi a variante C (mesa).
- `packages/client/src/components/scenes/` — `ScenesSidebar`, `SceneCreateDialog`,
  `ScenePerceptionDialog`, `SceneDeleteConfirm`, `NoSceneOverlay`.
- `packages/server/src/net/handlers/sync-handlers.ts` e
  `packages/server/src/db/migrations/008_scene_active.ts` — cena ativa com fonte única e
  escritor único, que DEC-CEN-02 promove a normativa.
