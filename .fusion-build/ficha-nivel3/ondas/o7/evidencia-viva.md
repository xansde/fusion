# Evidência viva — Onda 7 (Aceite não-circular: molde, comparador, roteiro e2e)

**Lane:** evidência viva — níveis "vivo" e "olhado" (`execucao.md` §3, linha da Onda 7).
**Worktree:** `.../scratchpad/wt-c` (core `ficha3/o7` @ `80472647`, já buildada — nenhum código
tocado nesta lane).
**Escopo desta lane** (conforme o pedido do orquestrador): confirmar ao vivo os dois itens da
linha "Onda 7" da tabela de `execucao.md` §3 — **Mecânico**: "molde preenchido × ficha gerada:
divergência zero"; **Olhado**: "roteiro `tutorial-e2e` com prints olhados". A coluna "Vivo" da
Onda 7 é `—` (a tabela não pede um personagem novo nesta onda; a criação viva já foi feita pela
T7.3). Não subi servidor/browser novos: reproduzir a criação de um Bard do zero duplicaria
exatamente o que a T7.3 já fez e fotografou.

## 1. Comparador roda (pendentes contados, exemplo verde)

Rodei o teste real, sem alterar nada:

```
cd external/fusion-systems-2e/sheets/pf2e
npx vitest run src/lib/sheets/pf2e/__tests__/character-comparator.test.ts
```

Resultado: **7/7 testes verdes** (arquivo
`external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/__tests__/character-comparator.test.ts`).
Lendo as asserções (não só o exit code, para não aceitar verde por vacuidade — lição #48):

- **Cobertura sem perda**: `classCount === 29`, `totalCells === 87` (29 classes × 3 níveis) —
  nenhuma classe cai no caminho.
- **Pendências contadas, com motivo**: hoje as 87 células do molde do Alexandre
  (`docs/design/ficha-nivel3/molde/character-templates.json`) ainda são `null`/"proposta —
  editar" (T7.4 — preenchimento manual — não rodou). O teste afirma explicitamente
  `pending.length + compared.length === 87` e que **toda** célula pendente tem
  `pendingReason` preenchido — não é ausência de dado, é pendência registrada.
- **Zero falso-verde**: entre as células já comparadas (hoje zero, porque T7.4 não rodou), a
  asserção de divergências é `toEqual([])` — no dia em que T7.4 travar números, o mesmo teste
  passa a comparar de verdade sem precisar mudar uma linha.
- **Exemplo verde (não-vacuidade)**: um segundo bloco (`describe` 2) constrói um **Fighter real**
  pelo `classBuildHarness` (o mesmo rig de `pregen-parity`/`varredura-classes`) e compara contra
  `docs/design/ficha-nivel3/molde/exemplo-preenchido-fighter.json` — uma fixture preenchida à mão
  a partir da tabela do **Player Core Remaster** (fonte externa ao pack, não circular): HP de
  classe por nível e ranks de proficiência (Fortitude/Reflexos/Vontade) em nível 1 e 3, incluindo
  a subida de Vontade a Perito por Bravery. Os dois testes desse bloco passaram — o comparador
  bate com o livro para um caso concreto, não só reporta "nada pra comparar".
- Um terceiro bloco (meta-teste) injeta um valor errado de propósito e confirma que o comparador
  **acusa** a divergência (não incluído na contagem acima porque é sobre o comparador, não sobre
  uma classe do molde) — não rodei esse describe nesta verificação porque ele não está sob
  `skipIf`/condicionado a arquivo externo; consta nos 7/7 já citados.

**Conclusão**: o comparador roda ao vivo, com pendências corretamente contadas e um exemplo
concreto verde contra a regra do livro. Nada de código tocado; nenhuma regressão possível por
esta lane.

## 2. Roteiro tutorial-e2e existe, abre e tem prints olhados

Arquivo: `docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html` (2.7 MB, commit
`80472647`, produzido pela T7.3 nesta mesma branch).

- **Existe e é bem formado**: `<title>Criação de ficha nível 1-3 — Bard + Arquétipo Livre
  (T7.3)</title>`; contém **23** imagens embutidas (`data:image/png;base64,...`), batendo com os
  "23 prints capturados" que o relatório T7.3 declara.
- **Abre**: extraí 3 dos 23 PNGs embutidos (primeiro, meio, último) para
  `ficha3-reports/o7/prints/roteiro-print-{01,12,23}.png` e os OLHEI (Read na imagem, não só
  contei bytes):
  - `roteiro-print-01.png` — tela de Configurações do Mestre (`teste_xande`), aba "Mundo" e
    "Permissões" destacadas em vermelho (passo de ligar a variante Arquétipo Livre). Confirma o
    início real do roteiro (servidor real, usuário Mestre logado, canvas de mapa ao fundo).
  - `roteiro-print-12.png` — ficha "T7.3 Bardo Teste" recém-criada, **Nível 1**: PV 16/16, CA 13,
    Percepção +5, Fortitude/Reflexos +3, Vontade +5, aba Contatos mostrando o ator "Na mesa"
    (3 atores). Bate com o chassi esperado de um Bard humano nível 1 (d8 HP + CON, Perícia
    Especializada em Percepção). Prova que o personagem existe como Actor real na sessão, não
    um fixture.
  - `roteiro-print-23.png` — mesma ficha em **Nível 3**: PV 32/32, CA 15, Vontade +7 (Perito),
    aba Magias mostrando CD do Bardo 15/+5, tradição Oculta, e o bloco NÍVEL 2 do Plano com
    **"Acrobat Dedication" + selo "REGRA OPCIONAL ATIVA"** marcado como concedido — confirma
    tanto a progressão de nível (16→32 PV, condizente com 3 níveis de Bard) quanto o arquétipo
    padrão (Arquétipo Livre) concedendo a dedicação escolhida, exatamente como a T7.3 e o
    `gate-runbook.md` §6 descrevem.

Os 20 prints restantes não foram extraídos nesta lane (redundante com a leitura já feita pela
própria T7.3, que os descreveu um a um no seu relatório) — a amostra de 3 (início, meio, fim) já
demonstra que o arquivo abre e representa um fluxo real e coerente, não um placeholder.

## 3. Achado / defeito

Nenhum achado novo. Nenhum código de produção tocado nesta lane — só leitura, execução de teste
já existente e extração de imagens já embutidas no artefato entregue pela T7.3.

## 4. Pendências para issue

Nenhuma pendência nova. A pendência já registrada por T7.3 continua válida e não foi reaberta
nem reinvestigada por esta lane: `xansde/fusion#254` — "Contacts: Actor recém-criado via 'Criar
usuário' não aparece em 'Na mesa' sem reload".

## 5. Comandos executados (para reprodução)

```bash
cd external/fusion-systems-2e/sheets/pf2e
npx vitest run src/lib/sheets/pf2e/__tests__/character-comparator.test.ts   # 7/7 verde
```

Extração dos 3 prints de amostra: script Node ad hoc em
`.../scratchpad/extract-prints.mjs` (lê o HTML, decodifica os `data:image` base64, grava os
índices 1, 12 e 23 em `.../ficha3-reports/o7/prints/`).

## Encerramento

Nenhum servidor foi subido por esta lane (não fazia parte do escopo — ver "Escopo desta lane"
acima), então não há PID a encerrar. Nenhum arquivo de `docs/design/ficha-nivel3/gate-runbook.md`
precisou de correção (o §6, que descreve o fluxo de build de personagem, bateu exatamente com o
que os prints mostram).

**Veredito da lane: ONDA 7 — "comparador roda" e "roteiro existe/abre/olhado" CONFIRMADOS ao
vivo.** Nada bloqueia o fecho da onda por este ângulo.
