# Evidência viva — Onda 0 (2026-09-21)

Worktree: `wt-o0` (branch `ficha3/onda0`, já buildada pela T0.5, HEAD `e8460b3f` → runbook
commitado em `f160594a`, pushado). Data-dir isolado: `scratchpad/data-o0` (fora da worktree,
nunca `~/.fusion`). Servidor testado em `http://localhost:33005`, mundo `teste_xande` (cópia).

## 1. Runbook

Escrito em `docs/design/ficha-nivel3/gate-runbook.md`, commitado sozinho em `ficha3/onda0`
(commit `f160594a`), `prettier --write` aplicado, push feito (`gh auth switch -u xansde`
antes). Cobre: onde os packs de classe são lidos (runtime, `systems/<id>/packs/`, nunca
copiados para dentro do mundo — por isso um mundo antigo serve sem recriação), comando real
de boot, wizard de setup (obrigatório em data-dir novo mesmo com `--world`), login GM/jogador,
e a lacuna de produto que bloqueou o plano original do gate (seção 5 abaixo).

## 2. Achado bloqueante de metodologia — não existe "criar personagem" na UI

A aba Contatos do Mestre só abre fichas de atores `character` **já existentes**; a aba NPCs só
cria `npc`/`hazard`. `packages/client/src/lib/npcs/createNpc.ts` documenta a decisão:
`character` nasce junto com o jogador (DEC-NPC-02), e essa amarração **não está implementada**
como entry point de UI (confere com a memória do projeto sobre a emenda 37/05 pendente).

O mundo `teste_xande` copiado só tinha 2 atores tipo `character` (`Tobias`, nível 5, com 3
classes empilhadas — Bard/Barbarian/Cleric, dado de sessões anteriores; `Novo Ator`, nível 3
Barbarian). Não havia terceiro. Para destravar o teste dos 3 chassis pedidos, resetei os dois
existentes para nível 1 sem classe (mantendo ancestralidade/linhagem/antecedente) e cloneiquei
um terceiro (`GateO0-Guardian`) por escrita direta no `world.db`, com o servidor **parado**
(reiniciado depois) — nunca com o processo rodando. Isso é registrado como workaround de
teste, não como validação de um fluxo de produto (que não existe).

## 3. Confirmação positiva — as 29 classes estão no picker

Abrindo a ficha de `Tobias` (resetado, nível 1, sem classe) e clicando em "Classe —", o
diálogo lista as **29 classes PF2e** (incluindo Necromancer, Runesmith, Guardian, Commander,
Animist etc. — o merge de `feat/classes-necromancer-runesmith` no satélite, T0.1, chegou ao
dado que o servidor serve). Selecionar "Monge Monk" + "Confirmar" grava o item `class: Monk`
no ator (confirmado por leitura direta do `world.db` após o clique).

## 4. Achado central — features de nível 1 do Monge NÃO foram concedidas como item

Depois de escolher a classe Monk no `Tobias` resetado (nível 1), a coluna Plano mostrou, no
bloco "NÍVEL 1", os chips "Sequência de Golpes / Flurry of Blows" e "Punho Poderoso / Powerful
Fist" — exatamente o esperado pela regra do remaster (`classes-core`'s `featuresByLevel` do
Monk lista as duas em nível 1, com `uuid` já local/correto: `WsjMAdbmegii8Kqf` e
`yoqnc3lhyUICfRSB`).

Lendo o `world.db` **depois** dessa interação, os itens embutidos no ator eram:

```
background : Fortune Teller
ancestry   : Elf
heritage   : Ancient Elf
feat       : Oddity Identification   (grant natural do background, esperado)
class      : Monk
```

**Nem Flurry of Blows nem Powerful Fist existem como item do ator** — só a UI as lista, a
concessão de fato não aconteceu. Print: `prints/monk-tobias-nivel1-plano.png` (descrição
abaixo).

### Causa provável (não confirmada por código, é leitura combinada de dado)

- O item de classe `Monk` em `classes-core` tem **zero `system.rules`** — não é ele quem
  concede as features por `GrantItem`.
- `featuresByLevel` só tem consumidor no **client**, dentro do `planVM.ts`/`PlanColumn.svelte`
  — nenhum grep encontrou consumidor server-side. Ou seja, é uma lista de exibição; não achei
  o código que a transforma em `doc:create` de item.
- Analisando os packs estaticamente (`class-features-core` + `feats-core`): **471 regras
  `grant-item` no total, das quais 350 ainda apontam para `Compendium.pf2e.*`** — o MESMO
  número que o `plano.md` diagnosticou como não corrigido. Isso bate com o commit
  `2b16f43` do submodule ("test(pf2e): valida resolução de GrantItem...") ser só um **teste**
  de validação — não achei o commit que de fato reescreve o namespace (T0.3 real). Exemplo
  concreto verificado: o documento "Hunt Prey" (traço `ranger`, nível 1) tem sua própria regra
  `grant-item` apontando para `Compendium.pf2e.actionspf2e.Item.Hunt Prey` — quebrada.
- **Ressalva de metodologia**: cliquei "Classe" → "Confirmar" para atribuir a classe a um ator
  já "nível 1" (por edição direta de banco), **sem** passar pelo botão "Subir de nível". Não
  descartei a hipótese de que o gatilho real da concessão automática de feature de classe seja
  especificamente o fluxo de **level up** (não a simples atribuição de classe a um ator já
  nesse nível) — não tive orçamento de tempo para reabrir o teste variando esse detalhe.
  Registro isso como pendência de re-teste, não como fato resolvido.

## 5. Anomalia secundária encontrada (não investigada a fundo — pendência)

Depois do reset direto no banco (`system.details.level = {value: 1}`, itens de classe/feat
removidos) e reboot do servidor, a ficha de `Tobias` ainda renderizou **"Nível 5"** no
cabeçalho, **PV 51/51** e **5 blocos de nível (1 a 5)** na coluna Plano — mesmo o `world.db`
confirmando `system.details.level.value === 1` na hora da leitura. Não localizei, no tempo
disponível, o campo que ainda carrega "5" (não é `system.details.level`; pode ser algo
derivado, cacheado em outro lugar do documento, ou uma característica intencional do
componente que não reobtive contexto suficiente para afirmar). **Não é o achado central desta
lane, mas pode contaminar qualquer teste que reaproveite atores existentes em vez de nascer
do zero** — relevante para quem for reabrir este teste.

## 6. Ranger e Guardian — não testados ao vivo (tempo esgotado)

Não cheguei a repetir o fluxo (seleção de classe + inspeção de itens) para Ranger e Guardian
nos outros dois atores preparados (`Novo Ator`, `GateO0-Guardian`) — ambos ficaram prontos
(nível 1, sem classe, mesmo chassi Elfo/Elfo Ancestral) mas o teste não foi executado. A
evidência estática da seção 4 (Hunt Prey com `grant-item` quebrado) é um indício forte de que
o Ranger sofre o mesmo problema, mas **não é confirmação ao vivo** — registrar como pendência,
não como veredito.

## 7. Prints

- `prints/monk-tobias-nivel1-plano.png` — ficha de Tobias, coluna Plano aberta, mostrando
  Ancestralidade Elfo / Linhagem Elfo Ancestral / Antecedente Adivinho / Classe Monge, bloco
  "NÍVEL 1" com "Monge 1" marcado (✓) e os slots seguintes (Dádivas de Atributo, Talento de
  Ancestralidade, Treinamento de Perícias) ainda vazios. **Prova visualmente que a classe foi
  atribuída e que a UI apresenta o nível 1 como iniciado** — não prova a concessão de feature
  (isso só a leitura do banco, seção 4, resolve). Nota: o cabeçalho da janela mostra "Nível 5"
  / PV 51/51, a anomalia da seção 5 — visível no próprio print.

## 8. Processo do servidor

Subido 2x nesta sessão (reboot entre os dois para aplicar o reset de atores feito com o
processo parado). Ambos encerrados por `taskkill //PID <pid> //F` depois de conferir com
`netstat`. Nenhum processo órfão restante (confirmado: porta 33005 sem LISTENING ao final).

## 9. Veredito da onda 0 (nesta lane)

**Gate NÃO passa, com ressalva de metodologia.** Evidência ao vivo mostra classe Monk
selecionável e atribuível (dataset das 29 classes chegou), mas as duas features de nível 1
(Flurry of Blows, Powerful Fist) não apareceram como itens reais do ator depois da atribuição
de classe — batendo com o diagnóstico estático (350/471 `grant-item` ainda quebrados) mas sem
eu ter isolado se o gatilho certo é "subir de nível" em vez de "atribuir classe a ator já no
nível". Ranger e Guardian não foram testados ao vivo por falta de tempo; a mesma classe de
defeito (Hunt Prey com `grant-item` quebrado) foi confirmada estaticamente para o Ranger.

## Pendências para issue

1. **Repo `xansde/fusion-systems-2e`** — título: "GrantItem: 350/471 regras ainda apontam
   `Compendium.pf2e.*` (T0.3 não aplicada apesar do commit 2b16f43 de teste)". Corpo: contagem
   reproduzida nesta sessão (`node` script sobre `class-features-core/documents.json` +
   `feats-core/documents.json`, contando `system.rules[].kind === "grant-item"` e filtrando
   `uuid` iniciando com `Compendium.pf2e.`); exemplo concreto "Hunt Prey" (Ranger, nível 1)
   quebrado; commit `2b16f43` só adiciona teste de validação, não a correção de namespace.
2. **Repo `xansde/fusion`** — título: "Fusion: não existe entry point de UI para criar
   personagem-jogador (`character`)". Corpo: `packages/client/src/lib/npcs/createNpc.ts`
   documenta DEC-NPC-02 ("character nasce com o jogador") como não implementada; aba Contatos
   só abre fichas existentes, aba NPCs só cria `npc`/`hazard`; bloqueia qualquer gate ou fluxo
   de produto que dependa de criar um personagem do zero pela UI.
3. **Repo `xansde/fusion` (ou onde vive `class-features-core`)** — título: "Verificar se
   atribuir classe a um ator já em nível N concede as features desse nível, ou só o botão
   'Subir de nível' faz isso". Corpo: nesta sessão, atribuir Monk a um Tobias já "nível 1" (por
   edição direta de banco, não pelo fluxo de criação) não gerou os itens de feature de nível 1;
   não foi isolado se a causa é o namespace quebrado (pendência 1) ou se o gatilho de concessão
   só dispara no clique de "Subir de nível" a partir de um estado anterior.
4. **Repo `xansde/fusion`** — título: "Ficha: cabeçalho/coluna Plano mostram nível e PV
   desatualizados após edição direta de `system.details.level` no banco + reboot do servidor".
   Corpo: reproduzido nesta sessão (seção 5); pode ser cache legítimo de outro campo ou bug de
   derivação — não investigado a fundo.
