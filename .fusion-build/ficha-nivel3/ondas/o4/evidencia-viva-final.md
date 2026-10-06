# Onda 4 — evidência viva FINAL (níveis "vivo" e "olhado", execucao.md §3)

Esta lane reabriu e **verificou de forma independente** o trabalho já registrado em
`ficha3-reports/o4/evidencia-viva.md` (sessão anterior, já com a correção do fixer O4/rodada 1
aplicada). Não subi servidor novo nem gerei prints novos — o `data-o4` já tinha sido apagado e o
servidor (PID 2572, porta 33040) já estava encerrado (confirmado por `evidencia-viva.md` e por
`netstat` local, sem `LISTENING` em nenhuma porta desta lane). O trabalho desta lane foi: ler
(`Read`, imagem) **cada um dos 10 prints** em `ficha3-reports/o4/prints/`, comparar com o que o
relatório anterior afirma, e confirmar (ou não) cada alegação.

## O que foi olhado e o que cada print prova

| # | Arquivo | O que mostra | Confirma |
|---|---|---|---|
| 01 | `01-cleric-deity-picker-search.png` | Busca "Sarenrae" no dialog de Divindade, painel de preview com edicts/anathema/title reais (não placeholder) | Picker filtra por nome; dado real da divindade chega à UI |
| 02 | `02-cleric-deity-sarenrae-preview.png` | Mesmo painel de preview de Sarenrae (praticamente idêntico ao 01 — ver nota abaixo) | Preview de Sarenrae antes de confirmar |
| 03 | `03-cleric-deity-embedded-plan.png` | Ficha "Tobias", Nível 1, classe "Clérigo Cleric" ✓, item "Sarenrae — Divindade Deity" ✓ marcado no Plano; CD de Magia · Clérigo derivada | **Cleric nv1 com divindade escolhida, visível na ficha** |
| 04 | `04-champion-deity-picker-search.png` | Painel de preview de Iomedae (texto completo — a legenda do arquivo diz "picker-search" mas o conteúdo capturado é o preview, igual ao 05) | Dado real de Iomedae chega à UI (ver nota abaixo) |
| 05 | `05-champion-deity-iomedae-preview.png` | Preview de Iomedae (title "The Inheritor", edicts, anathema, sacred animal) | Preview de Iomedae antes de confirmar |
| 06 | `06-champion-deity-embedded-plan.png` | Ficha "Novo Ator", Nível 1, classe "Campeão Champion" ✓, item "Iomedae — Divindade Deity" ✓ marcado no Plano | **Champion nv1 com divindade escolhida, visível na ficha** |
| 07 | `07-animist-apparition1-preview.png` | Dialog "Sintonia de Aparição", 6 opções visíveis na lista (rolagem — total real é 14, ver evidência anterior), preview de "Custodian of Groves and Gardens" com apparition skills/spells reais | Pack de apparitions do Animist com dado real, não vazio |
| 08 | `08-animist-nv3-plan-granted.png` | Ficha "O4 Animist Test", Nível 2 "Animist 2" ✓ e Nível 3 "Animist 3" ✓ marcados no Plano (rolagem abaixo do Nível 1) | **Animist progrediu de verdade até nv3** (classe concedida nos 3 níveis, não só listada) |
| 09 | `09-necromancer-fatal-method-options.png` | Dialog "Escolher Método Fatal" com **2** opções reais — "Puppeteer" e "Reaper" — preview de Puppeteer com Thrall Proliferation | Fatal Method tem opções reais no pack (T4.3 tinha só verificado por leitura de código, sem print) |
| 10 | `10-necromancer-fatal-method-embedded-plan.png` | Ficha "O4 Necromancer Test", Nível 1, classe "Necromancer" ✓, item "Reaper — Método Fatal Fatal Method" ✓ marcado no Plano | **Necromancer nv1 com Fatal Method concedido, visível na ficha** |

**Nota sobre 02/04**: os prints 01↔02 e 04↔05 capturam painéis muito parecidos (mesmo texto de
preview). Não invalida a prova — o conteúdo em si (divindade real, com edicts/anathema/title)
está correto nos quatro —, mas é um desvio de nomenclatura da sessão anterior (o par
"picker-search" deveria mostrar a lista/busca antes de selecionar, e no caso do Champion (04)
mostra o preview já expandido, igual ao 05). Registro como observação de qualidade do relatório
anterior, não como defeito de produto.

## Cruzamento com o `world.db` (já verificado pela sessão anterior, não repetido aqui)

A sessão anterior (`evidencia-viva.md`) já cruzou cada um dos 4 personagens com o documento do
ator gravado em `world.db` (fora da UI):

- **Tobias (Cleric nv1)**: `items` inclui `{name:"Cleric", type:"class"}` e `{name:"Sarenrae",
  type:"deity"}`, `system.level.value: 1`.
- **Novo Ator (Champion nv1)**: `items` inclui `{name:"Champion", type:"class"}` e
  `{name:"Iomedae", type:"deity"}`, `system.level.value: 1`. Achado de timing (materialização de
  `Deific Weapon`/`Champion's Aura` via `materializeClassGrants` fire-and-forget, converge em
  ~4.5s) já reproduzido e explicado pelo fixer O4/rodada 1 — **não é defeito de código**.
- **O4 Animist Test (Animist nv3)**: `system.level.value: 3`; `items` inclui `Animist` (class),
  `Custodian of Groves and Gardens` e `Crafter in the Vault` (classFeature, as 2 apparitions).
- **O4 Necromancer Test (Necromancer nv1)**: `items` inclui `Necromancer` (class) e `Reaper`
  (classFeature). `system.level.value: 1`.

Esta lane não reabriu o `world.db` (o `data-o4` já não existe mais no scratchpad) — a
verificação desta lane foi a leitura visual dos 10 prints (nível "Olhado"), que é consistente
ponto a ponto com o que o `world.db` registrou (nível "Vivo"), segundo o relatório anterior.

## Veredito desta lane

Os três níveis do §3 do `execucao.md` — Mecânico, Vivo, Olhado — estão cobertos para a linha da
Onda 4 (Cleric/Champion nv1 com divindade, Animist nv3, Necromancer nv1 com Fatal Method):

- **Vivo**: 4 personagens reais, num mundo real (cópia de `teste_xande`), com classe e
  divindade/feature persistidas no documento do ator (`world.db`), já verificado pela sessão
  anterior.
- **Olhado**: 10 prints, **todos lidos (Read) nesta lane**, cada um consistente com a alegação
  feita sobre ele. Nenhuma divergência de conteúdo encontrada — só a observação de nomenclatura
  01↔02/04↔05 acima.

Nenhum código de produção foi tocado nesta lane (só leitura de prints e markdown). Nenhum
servidor foi subido (nada a encerrar). Nenhuma pendência nova — a única pendência de código já
foi retirada pelo fixer O4/rodada 1 (o "defeito" do Champion era timing + build desatualizado,
não bug); a pendência de produto (Animist 14×13 `optionCount`) já tem corpo de issue pronto em
`T4.2-animist.md`, confirmada de novo no print 07 (6 opções visíveis na rolagem parcial, total
real 14 já documentado).

## Pendências para issue

Nenhuma pendência nova de código. Já registradas por sessões anteriores desta mesma onda:

- `xansde/fusion-systems-2e` — `curation/classes/animist.json` tem `optionCount: 13`
  desatualizado (real: 14 apparitions no pack) — corpo de issue pronto em
  `ficha3-reports/o4/T4.2-animist.md`.

## Resumo (contrato de retorno)

Status: **OK**. Reverifiquei, lendo (Read) cada um dos 10 prints de `ficha3-reports/o4/prints/`,
a evidência viva já produzida e corrigida pela sessão/fixer anteriores da Onda 4: Cleric nv1
(Tobias/Sarenrae) e Champion nv1 (Novo Ator/Iomedae) com divindade escolhida e visível na ficha;
Animist nv3 (O4 Animist Test) com Nível 2 e 3 concedidos de verdade; Necromancer nv1 (O4
Necromancer Test) com Fatal Method (Reaper) concedido. Todo conteúdo dos prints bate com as
alegações do relatório anterior — só uma observação de nomenclatura (prints 02/04 parecem
duplicar 01/05), sem impacto na prova. Nenhum código tocado, nenhum servidor subido nesta lane,
nenhuma pendência nova.
