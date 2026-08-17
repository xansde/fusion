# Processo de UI — para não repetir a rodada de 33 divergências

## Origem

Na rodada de 16–17/08/2026, o Alexandre testou manualmente as nove fases da gaveta lateral
(specs 36–44, já mergeadas em `alfa/app`) e encontrou **33 divergências** entre o que foi
implementado e o que a spec/protótipo mandava — algumas com forte insatisfação registrada
("Decepção.", "MAIOR ÁREA DE FRUSTRAÇÃO"). A investigação (documentada em
[`docs/design/gaveta-lateral/tasks-ajustes-r1.md`](gaveta-lateral/tasks-ajustes-r1.md))
concluiu que a raiz comum da maioria dos itens não era falta de spec — era implementação que
não foi conferida visualmente contra o protótipo aprovado, nem testada de fato na tela, antes
do merge. O item 33 desse plano (Fase 7) definiu quatro práticas obrigatórias para toda
fase/PR de UI a partir dali. Este documento é onde elas ficam registradas de forma
persistente.

## As quatro práticas obrigatórias

### P1 — Lente de revisão "protótipo" obrigatória

Todo `code-review`/`esteira-validar` de uma tarefa de UI (gaveta lateral ou qualquer outra
aba) **deve** abrir o `.prototype.html` correspondente lado a lado com o componente
renderizado antes de aprovar — não é opcional, é gate. Protótipos existentes hoje:

- `packages/client/prototypes/sidebar-rail.prototype.html`
- `packages/client/prototypes/chat-tab.prototype.html`
- `packages/client/prototypes/contacts-tab.prototype.html`
- `packages/client/prototypes/npcs-tab.prototype.html`
- `packages/client/prototypes/compendium-tab.prototype.html`
- `packages/client/prototypes/scenes-tab.prototype.html`
- `packages/client/prototypes/settings-tab.prototype.html`
- `packages/client/prototypes/combat-tab.prototype.html`
- `docs/design/spec-41-token/prototipo-token.html` (Token)

Se não houver protótipo para o componente em questão, registrar essa ausência
explicitamente no PR ou no review — em vez de simplesmente pular a checagem.

### P2 — Roteiro `tutorial-e2e` por fase

A skill `tutorial-e2e` é local (`.claude/skills/tutorial-e2e/`, **não versionada** no repo)
e dirige o app de verdade — servidor isolado + browser — para gerar um tutorial HTML com
prints de cada passo, com o alvo circulado. Os roteiros ficam em
`.claude/skills/tutorial-e2e/roteiros/*.spec.ts`. Ao final de cada fase de UI, o roteiro
completo da aba roda (não só o teste unitário), e os prints gerados são **capturados e
olhados** — por um humano ou por um revisor que sabe comparar contra o protótipo — não só
"rodou e não quebrou".

### P3 — Print lado a lado (protótipo × implementação) no corpo do PR

Nenhuma fase de UI mergeia sem uma captura lado a lado — protótipo × implementação — anexada
no corpo do PR. Isso é o que teria pego a maior parte das divergências visuais da rodada de
17/08 antes do merge: um diff de código não mostra layout errado, texto no idioma errado ou
componente com proporção quebrada.

Como imagens não sobem por `gh` diretamente no corpo do PR de forma confiável, o formato é:
relatório HTML local em `.fusion-build/<leva>/relatorios/<fase>/relatorio.html` (com as
capturas lado a lado) **mais** observações em texto no corpo do PR apontando o que foi
comparado e o resultado.

### P4 — Smoke como GM e como player antes do merge

Cada PR de UI é testado manualmente nos dois papéis antes do merge — não só como GM. Vários
dos itens de 17/08 (edição de título como player, drag dependente do papel correto, cena
preta só para player) são exatamente a classe de bug que só aparece testando como o papel
errado nunca foi testado. O corpo do PR registra explicitamente:

`testado como GM: sim/não; testado como player: sim/não`

## Checklist copiável para o corpo do PR

```markdown
## Processo de UI (docs/design/PROCESSO-UI.md)

- [ ] Protótipo × tela: comparado lado a lado (`<path do .prototype.html>`); ausência de
      protótipo registrada, se aplicável.
- [ ] Roteiro `tutorial-e2e` rodado para esta fase; prints capturados e olhados.
- [ ] Smoke GM + player: testado como GM: sim/não; testado como player: sim/não.
- [ ] Pendências: <lista, ou "nenhuma">.
```

## O que passou em 17/08 e não pode passar de novo

Lista concreta de defeitos que a falta destas práticas deixou passar — cada um é um caso de
teste implícito para a próxima fase de UI:

- Menu que não fecha ao clicar fora.
- "Carregando…" eterno (estado de loading sem transição para o estado final).
- Botão que ocupa metade da gaveta.
- Enum de papel exposto inteiro na UI (deveria ser traduzido/filtrado para o usuário).
- Nome de documento importado em inglês (deveria estar em pt-BR).
- Escrita sem `expectedVersion` (abre brecha de concorrência silenciosa).
- `$push` em diff (semântica errada de atualização).
- Tela preta para o player sem erro nenhum reportado.
- Formulário com o campo principal no fim (em vez de no topo, onde o usuário espera).
