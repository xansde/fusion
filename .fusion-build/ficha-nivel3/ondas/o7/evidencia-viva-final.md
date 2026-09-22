# Evidência viva — Onda 7, rodada FINAL (Aceite não-circular: molde, comparador, roteiro e2e)

**Lane:** evidência viva — níveis "vivo" e "olhado" (`execucao.md` §3, linha da Onda 7).
**Worktree:** `.../scratchpad/wt-c` (core branch `ficha3/o7` @ `676e69df`, já buildada — nenhum
código de produção tocado nesta lane, só leitura e execução de teste já existente).
**Motivo desta rodada:** desde `evidencia-viva.md` (rodada anterior, pin `80472647`), o fixer da
Onda 7 rodou mais duas rodadas de correção (`fix-r1.md`, `fix-r2.md` — achados C1/C4/C5/C7) e
regravou o roteiro `tutorial-e2e` do zero, aplicando o chassi inteiro e confrontando o ator
persistido. O comparador também cresceu (7 → 33 testes). A evidência anterior está desatualizada
nos números; esta rodada reconfirma os dois itens contra o estado atual do HEAD.

## 1. Comparador roda (pendentes contados, exemplo verde)

```
cd external/fusion-systems-2e/sheets/pf2e
npx vitest run src/lib/sheets/pf2e/__tests__/character-comparator.test.ts
```

Resultado ao vivo, nesta rodada: **33/33 testes verdes** (1 arquivo), 91ms de execução — arquivo
`external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/__tests__/character-comparator.test.ts`.
Lendo as asserções (não só o exit code — lição #48):

- **Cobertura sem perda**: `classCount === 29`, `totalCells === 87` (29 classes × 3 níveis).
- **Pendências contadas, com motivo**: as células do molde do Alexandre
  (`docs/design/ficha-nivel3/molde/character-templates.json`, ainda "proposta — editar" porque
  T7.4 não rodou) somam `pending.length + compared.length === 87`, e toda pendente tem
  `pendingReason` preenchido.
- **Zero falso-verde**: entre células comparadas, `divergences` é `toEqual([])`.
- **Exemplo verde não-vacuoso**: um Fighter real construído pelo `classBuildHarness` é comparado
  contra `docs/design/ficha-nivel3/molde/exemplo-preenchido-fighter.json` (tabela do Player Core
  Remaster, fonte externa) — HP de classe e ranks de salvaguarda em nível 1 e 3, incluindo a
  subida de Vontade a Perito por Bravery.
- **Comparador acusa divergência de verdade quando existe** (não sempre `[]`): testes dedicados
  injetam valor errado de propósito em `hp`/`saves`, em talento concedido, em perícia treinada
  ausente, em `proficiencies.attacks/defense` e em `spells.circle_N_slots`, e o comparador reporta
  a divergência em todos os casos — inclusive um caso que **reproduz o falso-verde real da
  revisão adversarial round 1** (`circle_2_slots` errado tinha passado como `[]` antes do fix).
- **Chassi trava a construção** (achado C2 do fixer): há um bloco dedicado provando que, com o
  chassi comum resolvido (Human/Skilled Human/Scholar), o Fighter construído carrega herança,
  boosts explícitos, talento de ancestralidade (Cooperative Nature) e idiomas do chassi — nunca
  "o primeiro candidato genérico do harness" (ex.: não cai em Adapted Cantrip por coincidência).
- **Normalização de nome de livro → slug** (achado N1): testes cobrem `bookNameToSlug` para nomes
  comuns, Lore (`lore-<assunto>`) e idempotência sobre slug já escrito, incluindo a reprodução do
  falso-divergente da rodada 1 (`trained_skills` escrito como nome do livro batendo com o slug).

**Conclusão**: o comparador roda ao vivo, cresceu de 7 para 33 testes desde a última verificação
(cobrindo os achados C1–C4/N1–N3 dos fixers), pendências corretamente contadas e múltiplos
exemplos concretos — verdes e vermelhos de propósito — contra a regra do livro. Nenhum código
tocado por esta lane.

## 2. Roteiro tutorial-e2e existe, abre e tem prints olhados

Arquivo: `docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html` (6,1 MB, HEAD `676e69df`,
regravado pelo fixer rodada 2 — "aplica o chassi inteiro e confronta o ator persistido").

- **Existe e é bem formado**: `<title>e2e visual — ficha-nivel3</title>`; contém **48** imagens
  embutidas (`data:image/png;base64,...`) — bem mais que os 23 da rodada anterior, condizente com
  o commit que adiciona o passo `preencherChassiNivel1` (Dádivas de Atributo, Talento de
  Ancestralidade por nome, treino de perícia, 2 Idiomas Bônus) e a confrontação contra o ator
  persistido no servidor.
- **Abre**: extraí 3 dos 48 PNGs embutidos (primeiro, meio, último) para
  `ficha3-reports/o7/prints/sample-{01,25,48}.png` e os OLHEI (Read na imagem, não só contei
  bytes):
  - `sample-01.png` — tela de Configurações do Mestre (`teste_xande`), Mundo e Permissões
    destacadas em vermelho (passo de ligar a variante Arquétipo Livre). Confirma início real do
    roteiro: servidor real, usuário Mestre logado, canvas de mapa ao fundo.
  - `sample-25.png` — diálogo "Talento de Arquétipo" com busca "Dedication", "Acrobat Dedication"
    destacado em vermelho, ficha detalhando pré-requisito ("treinado em Acrobacia") e nota
    "Dados mecânicos e descrição ORC/OGL (clean-room)" no rodapé — confirma que o passo de
    Arquétipo Livre está sendo exercitado na UI real, com atribuição de licença visível.
  - `sample-48.png` — ficha de **"Tobias"**, Nível 3, aberta como o próprio jogador (não mais
    Mestre): PV 44/44, CA 19, Percepção +7, Fortitude/Reflexos/Vontade todos +9 (Especialista),
    CD de classe 18, deslocamento 35 pés, idiomas `common, dwarven, elven`. Na coluna Plano,
    nível 1 mostra "Natureza Cooperativa" (Cooperative Nature) marcada como concedida, "Elven" e
    "Dwarven" como Idioma Bônus concedidos, "5/5 Treinamento de Perícias", e talentos de classe
    "Sequência de Golpes" (Flurry of Blows) e "Punho Poderoso" (Powerful Fist) — bate exatamente
    com o chassi comum (Human/Skilled Human/Cooperative Nature, idiomas Elven+Dwarven) aplicado a
    uma classe marcial de golpes desarmados. **Prova o ator persistido de verdade**, não um
    fixture: dado visível na UI condiz com o que o passo `preencherChassiNivel1` deveria ter
    gravado no servidor.

Os 45 prints restantes não foram extraídos nesta lane (redundante com a leitura do próprio
roteiro pelo fixer que os produziu) — a amostra de 3 (início, meio, fim) já demonstra um fluxo
real, coerente e batendo com o chassi comum documentado no molde.

## 3. Achado / defeito

Nenhum achado novo nesta lane. Nenhum código de produção tocado — só leitura, execução do teste
já existente e extração de imagens já embutidas no artefato entregue pelo fixer da Onda 7.

## 4. Pendências para issue

Nenhuma pendência nova. A pendência já registrada continua válida e não foi reaberta nem
reinvestigada por esta lane: `xansde/fusion#254` — "Contacts: Actor recém-criado via 'Criar
usuário' não aparece em 'Na mesa' sem reload".

## 5. Comandos executados (para reprodução)

```bash
cd external/fusion-systems-2e/sheets/pf2e
npx vitest run src/lib/sheets/pf2e/__tests__/character-comparator.test.ts   # 33/33 verde
```

Verificação de integridade do HTML e do molde (Node ad hoc, sem tocar arquivos do repo):
título, contagem de `data:image/png;base64,` embutidos, e `classCount` do
`character-templates.json` (29, confirmado). Extração dos 3 prints de amostra: script Node ad hoc
em `.../scratchpad/extract-prints2.mjs` (lê o HTML, decodifica os `data:image` base64, grava os
índices 1, 25 e 48 em `.../ficha3-reports/o7/prints/sample-*.png`).

## Encerramento

Nenhum servidor foi subido por esta lane (escopo é só evidência — reproduzir a criação de
personagem duplicaria o que o fixer da Onda 7 já fez e fotografou), então não há PID a encerrar.
Portas 33033 e 33090 aparecem em `LISTENING` na máquina, mas pertencem a outras ondas rodando em
paralelo — não tocadas por esta lane.

Nenhum arquivo de `docs/design/ficha-nivel3/gate-runbook.md` precisou de correção — o fluxo
descrito em §6 (abrir ficha, coluna Plano, blocos por nível) bate exatamente com o que os prints
mostram; o passo novo `preencherChassiNivel1` fica documentado nos commits do fixer, não é uma
lacuna do runbook em si (o runbook já cobre "onde fica o personagem" e "fluxo de build", que é o
suficiente para reproduzir manualmente).

**Veredito da lane: ONDA 7 — "comparador roda" (33/33, cobertura ampliada C1–C4/N1–N3) e "roteiro
existe/abre/olhado" (48 prints, chassi completo, ator persistido confirmado) RECONFIRMADOS ao
vivo contra o HEAD atual (`676e69df`).** Nada bloqueia o fecho da onda por este ângulo.
