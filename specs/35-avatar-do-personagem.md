# 35 — Avatar do Personagem

- **Título:** Avatar do personagem — boneco montável do acervo Waybuilder, no canto da mesa
- **Status:** implementado v0.1 (rodada de 2026-08-08); entrada pela aba Configurações (F5 — DEC-AVT-07)
- **Data:** 2026-08-08
- **Baseada em:**
  - [`igoresramos/waybuilder-avatar`](https://github.com/igoresramos/waybuilder-avatar) — o acervo e o renderer puro que esta feature consome. Pin: `b071c8fd10e79f5cc09af897cff9c9753f4dd790`, catálogo no pin LPC `0f898bb6`.
  - `specs/2026-08-01-avatar-do-personagem.md` do repo do acervo — decisões do recorte (animações, corpos, direção, recolor por paleta).
  - `11-ui-framework-e-fichas.md` — janelas (REQ-UIF-009..016), sistema de fichas, escala de z (REQ-UIF-008).
  - `02-modelo-de-dados.md` — flags namespaced (REQ-DOC-009), semântica de merge e deleteKey (REQ-DOC-037).
  - `26-licencas-e-legal.md` — atribuição obrigatória de arte de terceiros.
  - `37-configuracoes.md` — aba Configurações (REQ-CFG-\*), entry point do avatar a partir da F5 (DEC-AVT-07).

> **Não é o retrato.** O retrato (`doc.img`) é um arquivo de imagem que o dono
> sobe; o avatar é uma **figura montada** peça por peça, que anima e fica no canto
> da tela. As duas coisas convivem na mesma ficha e não se substituem.

---

## 1. Objetivo

Dar identidade visual animada a cada personagem: o jogador monta um boneco no
estilo pixel-art LPC (corpo, cabeça, cabelo, roupa, armadura, chapéu, acessórios,
com cor por canal), o avatar fica guardado no documento do Actor e aparece no
canto inferior direito da mesa do jogador que controla aquele personagem.

## 2. Escopo

### 2.1 Inclui

- Seção Avatar na aba Configurações (entrada via gaveta lateral, não pela ficha — DEC-AVT-07).
- Criador com o acervo completo: 627 peças, 11 grupos, ~100 slots, 6 variantes de
  corpo, recolor em runtime por canal de cor.
- Grade de escolha em que **cada célula compõe o personagem inteiro** com a peça
  candidata no lugar — o jogador julga a peça em contexto, não em boneco vazio.
- Persistência em `flags.fusion.avatar` (só a seleção, nunca pixel).
- Overlay no canto inferior direito com o avatar do próprio personagem, animado.
- Créditos da arte acessíveis dentro do criador.

### 2.2 Não inclui

- Avatar no token do canvas (o token segue usando `texture`).
- Avatar de NPC exibido para os jogadores.
- Giro do boneco: o recorte do acervo tem `frente` e `perfil_dir`; a UI usa
  **frente** apenas.
- Edição/importação de peças novas — o acervo é o pin, não um editor de sprites.

## 3. Requisitos

### Dados

- **REQ-AVT-001** [MVP] O avatar é guardado em `flags.fusion.avatar` do Actor, com
  `{versao, corpo, selecao, pin?}`. `selecao` é indexada por slot; cada entrada é
  `{id, cores?}`, com `cores` indexada por **canal de cor**, não por peça.
- **REQ-AVT-002** [MVP] Nada de pixel, offset de atlas, ordem de camada ou rampa
  de cor entra no documento: tudo é rederivado do catálogo na hora de desenhar.
  Uma peça que muda de lugar no atlas entre bumps do acervo continua funcionando.
- **REQ-AVT-003** [MVP] Animação **não** é persistida — é apresentação, escolhida
  por quem desenha.
- **REQ-AVT-004** [MVP] Toda leitura do flag passa por validação defensiva
  (`readAvatarFlag`): flag ausente, de formato antigo, com seleção vazia ou
  editado à mão resulta em "sem avatar", nunca em erro de renderização.
- **REQ-AVT-005** [MVP] A gravação usa **diff podado**: slot desequipado e canal
  de cor removido viajam como `null` explícito. Sem isso o deep merge do servidor
  preserva a chave omitida e a peça "volta".
- **REQ-AVT-006** [MVP] Peça cujo id não existe mais no acervo é descartada na
  abertura do criador, **com relato ao jogador** — nunca em silêncio, e nunca
  regravada.

### Criador

- **REQ-AVT-010** [MVP] O criador abre na seção Avatar da aba Configurações (REQ-CFG-\*).
  O acesso é pela aba, sem entrada separada por ficha (DEC-AVT-07).
- **REQ-AVT-011** [MVP] Navegação em dois níveis: aba por grupo (rótulo pt-BR do
  próprio catálogo, ordem vinda da árvore de prioridade) e um slot por vez.
- **REQ-AVT-012** [MVP] A ordem de abas e de slots é **determinística**: dois
  clientes com o mesmo acervo mostram a mesma sequência.
- **REQ-AVT-013** [MVP] Cada célula da grade compõe o personagem inteiro com a
  peça candidata; a célula `(nenhum)` mostra o personagem sem nada naquele slot.
- **REQ-AVT-014** [MVP] Peça sem arte para a variante de corpo escolhida aparece
  marcada e não selecionável.
- **REQ-AVT-015** [MVP] O seletor de cor cobre os **dois mecanismos** do acervo:
  faixa de atlas (arte pré-pintada, com a amostra hex do próprio acervo) e paleta
  recolorida em runtime. Valor de paleta é sempre qualificado (`ulpc:tan`) —
  nome solto é ambíguo entre paletas.
- **REQ-AVT-016** [MVP] Canal que o corpo comanda (`segue_cor_do_corpo`) não é
  oferecido na peça que herda: o renderer força a herança e o seletor seria um
  controle que não faz nada. O **corpo** mantém o seu, porque é a fonte do tom.
- **REQ-AVT-017** [MVP] Slot com mais de 12 peças ganha busca por nome.
- **REQ-AVT-018** [MVP] Sem permissão de edição o criador abre em leitura.
- **REQ-AVT-019** [MVP] Os créditos da arte (fonte, pin, autores, licenças) são
  acessíveis dentro do criador — atribuição é obrigação de licença, não enfeite.

### Canto da tela

- **REQ-AVT-030** [MVP] O canto inferior direito mostra **um** avatar: o do
  personagem que o usuário possui **explicitamente** (o mapa de ownership nomeia
  o usuário). Posse por papel não conta — o GM tem OWNER implícito em tudo e o
  canto mostraria um NPC qualquer como se fosse dele.
- **REQ-AVT-031** [MVP] Sem avatar, o overlay não é renderizado (nem moldura, nem
  placeholder).
- **REQ-AVT-032** [MVP] O avatar entra deslizando de baixo com fade; depois disso
  a animação é a do sprite. Clique abre a ficha do personagem.
- **REQ-AVT-033** [MVP] Loop `idle`; enquanto houver combate ativo, `combat_idle`.
- **REQ-AVT-034** [MVP] Fica na banda de z das regiões fixas: qualquer janela
  flutuante cobre o avatar — decoração cede lugar a trabalho.
- **REQ-AVT-035** [MVP] `prefers-reduced-motion` remove a entrada e o loop.
- **REQ-AVT-036** [MVP] O overlay não intercepta clique destinado ao canvas.

### Acervo e distribuição

- **REQ-AVT-040** [MVP] O acervo entra como dependência npm **pinada em commit**;
  atualizar é trocar o SHA. Nenhum arquivo de arte é versionado no Fusion.
- **REQ-AVT-041** [MVP] O acervo é publicado em `/avatar/*`: em dev/preview por
  middleware do plugin Vite lendo o `node_modules`; no build, copiado para
  `dist/avatar/`, que a fase 5 do `build-release.mjs` já empacota no executável.
- **REQ-AVT-042** [MVP] O guarda de traversal do middleware é obrigatório:
  `/avatar/` nunca pode ler fora do `saida/` do pacote.
- **REQ-AVT-043** [MVP] Catálogo (1,7 MB) e atlas são buscados em **runtime**,
  nunca importados — import viraria chunk de JS pago em todo carregamento.
- **REQ-AVT-044** [MVP] O catálogo só é buscado quando há avatar para desenhar.

### Desenho

- **REQ-AVT-050** [MVP] A unidade de cache é o **quadro de 64×64**, não o atlas: o
  atlas de cabelo tem 3072×5696 (~67 MB em RGBA) porque empilha as 90 peças do
  slot. Recolorir por arquivo custaria isso por cor.
- **REQ-AVT-051** [MVP] Todo quadro passa pelo cache, recolorido ou não, para que
  a evicção do LRU de atlas custe no máximo um re-decode e nunca uma camada
  faltando.
- **REQ-AVT-052** [MVP] O tempo da animação é monotônico e compartilhado: todos os
  avatares na tela ficam em fase.
- **REQ-AVT-053** [MVP] A ordem dos frames vem do ciclo do acervo, não de `0..n`:
  `walk` começa no frame 1 (o 0 é pose parada) e `idle` segura cada pose por dois
  ticks. Peça com animação substituída fica travada no frame 0.
- **REQ-AVT-054** [MVP] Falha isolada degrada em vez de derrubar: atlas que não
  carrega perde a camada, cor que não resolve deixa a peça na arte-base, e o
  avatar continua desenhando o resto.

## 4. Decisões

- **DEC-AVT-01 — O acervo é dependência, não vendor.** Pin de commit no
  `package.json` do client + plugin Vite publicando `/avatar/*`. Descarta
  submodule (todo clone/CI precisaria de `--recurse-submodules`) e vendor (2.813
  binários no git, desacoplados do upstream).
- **DEC-AVT-02 — O flag guarda seleção, não render.** Custa algumas centenas de
  bytes por ficha e sobrevive a mudança de empacotamento do atlas.
- **DEC-AVT-03 — Cor por canal, não por peça.** Um elmo tem metal e tecido; a cor
  pertence ao canal. Trocar a peça descarta as cores, porque canal de peça
  diferente é eixo diferente (o `estado.cores` por id do visualizador do acervo
  vazava cor de peça desequipada).
- **DEC-AVT-04 — Posse explícita decide o canto.** Ver REQ-AVT-030.
- **DEC-AVT-05 — Célula da grade compõe o personagem inteiro.** Mais caro que
  desenhar a peça solta, e é o que faz a escolha ser informada. Viabilizado pelo
  cache de quadros: as células reaproveitam os tiles das camadas em comum.
- **DEC-AVT-06 — Frente apenas.** O corte de direção do acervo tira 75% do peso;
  girar o boneco não é possível sem refazer o recorte.
- **DEC-AVT-07 — Repositório próprio, entrada pela aba Configurações (F5).** Motivada por
  DEC-SEP-06 (decisão da separação de repos, fora de `specs/` — ver
  `docs/design/separacao-repos/design.md` § DEC-SEP-06): o avatar nunca entra na alfa por
  merge — nasce como repo `fusion-avatar` a partir do porte existente, e o core o consome
  como pacote (mesmo padrão de "repo externo consumido por artefato"). Entrada de UI:
  **aba Configurações da gaveta** (não mais botão na ficha). O "behind 63" da worktree
  deixa de importar: só o ponto de integração precisa da alfa atual.

## 5. Onde vive

**A partir da F5 (DEC-AVT-07):** este pacote vive no repositório externo `fusion-avatar` (consumido pelo core `fusion` como `@fusion/avatar` por tag git). O contrato do flag continua em `@fusion/shared`.

| Papel                       | Arquivo / Pacote                                                                |
| --------------------------- | ------------------------------------------------------------------------------- |
| Contrato do flag            | `@fusion/shared` / `packages/shared/src/avatar.ts`                              |
| Resolução de paleta/recolor | `@fusion/avatar` / `packages/client/src/lib/avatar/paletas.ts`                  |
| Tempo/ciclo de animação     | `@fusion/avatar` / `packages/client/src/lib/avatar/animacao.ts`                 |
| Carga do acervo (HTTP)      | `@fusion/avatar` / `packages/client/src/lib/avatar/acervo.ts`                   |
| Lógica do criador (pura)    | `@fusion/avatar` / `packages/client/src/lib/avatar/criador.ts`                  |
| Diff de gravação (podado)   | `@fusion/avatar` / `packages/client/src/lib/avatar/patch.ts`                    |
| Desenho em canvas           | `@fusion/avatar` / `packages/client/src/lib/avatar/desenhar.ts`                 |
| Quem é "meu" avatar         | `@fusion/avatar` / `packages/client/src/lib/avatar/meuAvatar.ts`                |
| Sprite reutilizável         | `@fusion/avatar` / `packages/client/src/components/avatar/AvatarSprite.svelte`  |
| Seção Avatar (aba Config)   | `@fusion/avatar` / `packages/client/src/components/avatar/AvatarSection.svelte` |
| Overlay do canto            | `@fusion/avatar` / `packages/client/src/components/avatar/AvatarCorner.svelte`  |
| Publicação de `/avatar/*`   | `@fusion/avatar` / `packages/client/vite-plugins/waybuilder-avatar.ts`          |

## 6. Verificação

Os testes varrem o **acervo real instalado**, não fixture — fixture só provaria
que o código lê o catálogo que ele mesmo inventou (a lição da varredura circular
das 12 classes, `docs/lessons.md`):

- todo canal de toda peça em todo corpo oferece pelo menos uma cor;
- todo recolor que `montarCamadas` emite resolve em duas rampas reais (>300);
- toda opção que o seletor oferece é uma que o renderer aceita;
- a seleção inicial desenha figura visível em todas as 6 variantes de corpo, sem
  aviso;
- o round-trip criador → flag → documento → criador é idêntico;
- no servidor: `flags.fusion.avatar` sobrevive ao schema do Actor, o diff podado
  remove de verdade, e um **teste negativo** mostra a peça voltando quando o diff
  não poda.

## 7. Aberto

- Avatar no token do canvas (usar o sprite montado como textura).
- Fileira de avatares dos outros jogadores conectados.
- Expressão/pose reagindo a estado de jogo (HP baixo, condição).
- Bump do acervo: hoje é manual (trocar o SHA); vale um verificador que compare o
  `pin` gravado nas fichas com o do acervo instalado.
