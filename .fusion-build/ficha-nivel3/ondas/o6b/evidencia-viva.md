# Evidência viva — Onda 6b (gatilho de UI para criar personagem)

Worktree: `wt-d` (core branch `ficha3/o6b`). Servidor real (`node packages/server/dist/cli/index.js
serve`), porta 33020, data-dir isolado em `scratchpad/data-o6b` (fora da worktree, mundo
`teste_xande` copiado de `~/.fusion/worlds/`, nunca alterado o original). Browser real via
Playwright CLI (`playwright-cli`), duas sessões nomeadas (`o6b-gm`, `o6b-player`) — nenhum uso da
extensão Claude in Chrome.

## O que foi provado

A lane anterior desta mesma onda (`T6.5-criar-personagem.md`) já tinha estabelecido, por
investigação de spec + testes automatizados, que **o gatilho real de "criar personagem" é criar
um usuário de papel não-privilegiado em Configurações → Usuários** (REQ-USR-025): a criação do
usuário já cria, na mesma transação, um Actor `character` do qual o novo usuário é `OWNER`. Esta
lane executou essa cadeia **ao vivo**, servidor e browser reais, e **subiu dois personagens de
nível 1 a 3** por esse caminho — um representando o fluxo "jogador", outro o fluxo "Mestre
escolhe o dono".

### 1. GM cria usuário → nasce o Actor (nível "vivo", verificado no `world.db`)

- Logado como `MestreO6b` (Mestre), Configurações → Usuários → "Criar usuário" → nome
  `JogadorO6b`, papel Jogador, senha.
- Consulta direta ao `world.db` (better-sqlite3, fora da UI) confirma: Actor
  `3yVcijuzpV7STeCb` nome `"JogadorO6b"`, `flags.fusion.playerId = "yCDgop1neNUq9gl3"` (id do
  usuário recém-criado), `ownership["yCDgop1neNUq9gl3"] = 3` (OWNER).
- Repetido para um segundo usuário `JogadorGMCriado` (representa "o Mestre também cria um e
  escolhe o dono" — o dono é implicitamente o usuário que o Mestre está criando, já que
  REQ-USR-025 não oferece campo de dono separado: escolher/criar o usuário **é** escolher o
  dono). Actor `uPI...` renomeado internamente para `JogadorGMCriado`, ownership
  `["ptoE56HaYAEvuLSd"] = 3`, confirmado no `world.db`.
- Prints: `01-gm-logado-hub.png`, `02-gm-criar-usuario-form.png`,
  `03-gm-usuario-jogadoro6b-criado.png` (lista de Usuários com Gamemaster/MestreO6b/Tobias/
  JogadorO6b).

### 2. Personagem 1 — Mago (Elfo Ancestral / Erudito), montado pelo Mestre, nível 1→3

Construído pela coluna Plano da ficha, todas as escolhas via diálogo real (sem atalho de dados):
Ancestralidade Elfo → Linhagem Elfo Ancestral → Antecedente Erudito → Classe Mago → Dádivas de
Atributo → Escola da Teoria Mágica Unificada → Tese Arcana (Fusão de Magias) → Talento de
Ancestralidade (Linguística Ancestral) → Talento de Classe (Familiar) → 3 Idiomas Bônus →
Treinamento de Perícias (Natureza/Ocultismo/Religião/Sociedade/Furtividade) → nível 2 (Talento de
Classe Expansão de Truques, Talento de Perícia Sensibilidade Arcana) → nível 3 (Talento Geral
Iniciativa Incrível, Aumento de Perícia Arcanismo→Especialista).
- Prints: `04` (ficha em branco) → `05`/`06` (nível 1 completo) → `07` (nível 2) → `08` (nível 3,
  coluna Plano) → `09` (aba Magias: CD Mago 18, Ataque +8, Tradição Arcana, 5 slots de Patamar 1
  visíveis — spellcasting entry do Mago existe e responde à progressão do nível).
- Verificação **direta no `world.db`** (não só UI): `system.level.value = 3`,
  `system.build.choices` lista 24 entradas cobrindo todos os slots de nível 1-3 (incluindo os 5
  `skillTraining` que corrigi depois de um erro de UX — ver seção Defeitos), e `items` (18 no
  total) inclui `class:Wizard`, `classFeature:School of Unified Magical Theory`,
  `classFeature:Spell Blending`, `spellcastingEntry:arcane Spells`, `classFeature:Arcane Bond`,
  `feat:Cantrip Expansion`, `feat:Arcane Sense`, `feat:Incredible Initiative`.

### 3. Personagem 2 — Guerreiro (Anão da Forja / Combatente), montado pelo Mestre, nível 1→3

Mesmo processo, classe não-conjuradora, ancestralidade e antecedente diferentes: Anão → Anão da
Forja → Combatente → Guerreiro → Dádivas de Atributo → Talento de Ancestralidade (Familiaridade
com Armas Anãs) → Talento de Classe (Golpe Violento) → Treinamento de Perícias
(Atletismo/Natureza/Sobrevivência/Furtividade) → nível 2 (Talento de Classe Aparo em Duelo,
Talento de Perícia Rastreador Experiente) → nível 3 (Talento Geral Iniciativa Incrível, Aumento
de Perícia Atletismo→Especialista) → Idioma Bônus (Jotun, completando os 3 idiomas).
- Prints: `13` (nível 3, PV 46/46, CD 17) → `14` (idiomas completos: common, dwarven, jotun).
- Verificação no `world.db`: `system.level.value = 3`, `items` inclui `class:Fighter`,
  `classFeature:Reactive Strike`, `classFeature:Shield Block`, `classFeature:Bravery`,
  `feat:Vicious Swing`, `feat:Dueling Parry`, `feat:Experienced Tracker`,
  `feat:Incredible Initiative`, `ownership["ptoE56HaYAEvuLSd"] = 3`.

### 4. O JOGADOR entra, vê só o próprio personagem, abre a própria ficha

- Segunda sessão de browser (`o6b-player`), login como `JogadorO6b` (papel Jogador).
- Aba Contatos → "Na mesa 1" mostra **apenas** `JogadorO6b`, marcado "você" — confirma a
  redação de visibilidade (o jogador não vê `JogadorGMCriado`, `Novo Ator`, `Tobias` que o
  Mestre vê). Print `11-player-contatos-so-o-proprio.png`.
- Clique em "Abrir a ficha de JogadorO6b" → ficha abre normalmente, nível 3, Mago, todos os
  atributos e a coluna Plano visíveis e editáveis pelo dono. Print
  `12-player-ficha-propria-nivel3.png` (PV 27/27, CD 18, FOR+1/DES+2/CON+1/INT+3/SAB+1/CAR+1 —
  batendo com as dádivas escolhidas).

## Defeito encontrado (registrado, não corrigido)

**Cenário concreto:** ao escolher, no slot "Talento de Classe" do Mago nível 1, o talento
**"Familiar"** (que tem as tags `magus, feiticeiro, taumaturgo, mago` — compartilhado entre
quatro classes), a ficha do personagem passa a exibir, permanentemente, no card do próprio
talento: **"É talento de classe Magus e você não tem níveis de Magus."** — mesmo o personagem
sendo Mago puro, sem nenhum nível de Magus, e tendo escolhido o talento peloslot de Mago. O
mesmo padrão se repetiu no nível 2 com **"Expansão de Truques"** (tags `bardo, clérigo, magus,
oráculo, psíquico, feiticeiro, bruxo, mago`): aviso **"É talento de classe Bard e você não tem
níveis de Bard."**

**Hipótese de causa (não verificada em código nesta lane):** o item do talento provavelmente
carrega um único campo "classe canônica" (ex. o primeiro elemento de uma lista de traits, ou um
campo de import do compêndio) usado pela validação, em vez de checar se a classe **atual do
personagem** está entre as classes que legitimamente concedem aquele talento. Isso produz falso
positivo sempre que um talento multi-classe é concedido pela classe que **não** é a primeira da
lista de traits.

**Impacto:** cosmético mas enganoso — o Mestre/jogador vê um aviso vermelho de "escolha
inválida" em uma escolha que é, pela regra do PF2e remaster, perfeitamente legal (o talento foi
oferecido justamente no picker de talentos de Mago). Não bloqueia a gravação nem a progressão de
nível (confirmado: personagem chegou a nível 3 normalmente com os dois talentos presentes).

**Evidência visual:** print `09-nivel3-aba-magias-mago.png`, card "Familiar" com fundo vermelho e
o texto do aviso.

## Erro de operação corrigido nesta própria sessão (não é defeito de produto)

No diálogo "Treinamento de Perícias" (nível 1), o botão "×"/"Fechar" no canto superior direito
**descarta** as seleções feitas (mesmo comportamento observado antes no diálogo "Dádivas de
Atributo"), diferente do botão **"Concluído"** no rodapé, que salva. Na primeira passada eu
fechei pelo × e perdi as 5 escolhas de perícia (ficaram em "(0/5)"); refiz e usei "Concluído",
confirmado depois via `world.db` (5 entradas `skillTraining-1-*` em `system.build.choices`). Não
registro isso como defeito de produto — é comportamviamento consistente (× sempre cancela,
"Concluído"/"Confirmar" sempre salva) — apenas documento para quem repetir este runbook não caia
no mesmo engano.

## Pendências para issue

**Repo:** `xansde/fusion`

**Título:** `Talento multi-classe (ex.: Familiar, Cantrip Expansion) mostra aviso falso de
"classe errada" quando concedido pela classe correta`

**Corpo:**
```
Cenário: personagem Mago puro (sem níveis de Magus), nível 1, escolhe "Familiar" no slot
"Talento de Classe" do próprio Mago (o item tem traits magus/feiticeiro/taumaturgo/mago).
A ficha passa a exibir permanentemente "É talento de classe Magus e você não tem níveis de
Magus." no card do talento.

Reproduzido também com "Expansão de Truques" (bardo/clérigo/magus/oráculo/psíquico/
feiticeiro/bruxo/mago) escolhido no slot de nível 2 do mesmo Mago: aviso "É talento de classe
Bard e você não tem níveis de Bard."

Não bloqueia a progressão (o personagem chegou a nível 3 normalmente), mas o aviso é falso —
o talento foi oferecido e escolhido dentro do picker de talentos da classe correta (Mago).

Hipótese: a validação usa um campo de "classe canônica" do item (provavelmente o primeiro
trait da lista) em vez de checar se QUALQUER classe do personagem está entre as classes que
concedem o talento.

Evidência: docs/design/ficha-nivel3/ (evidência viva da Onda 6b, arquivo evidencia-viva.md e
prints/09-nivel3-aba-magias-mago.png — via ficha3-reports/o6b/ na sessão que gerou o achado).
Ator de teste: Wizard nível 3, mundo teste_xande (cópia de scratchpad, não afeta o mundo real).
```

## Servidor

Encerrado ao final via `taskkill //PID 10784 //F` (porta 33020 confirmada livre por `netstat`
logo em seguida). Data-dir `scratchpad/data-o6b` preservado para eventual re-inspeção do
`world.db`; nada foi escrito no `~/.fusion` real.

## Arquivos

- Prints: `ficha3-reports/o6b/prints/01..14-*.png` (14 arquivos, todos olhados nesta sessão).
- Este relatório: `ficha3-reports/o6b/evidencia-viva.md`.
