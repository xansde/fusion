# Evidência viva final — Onda 3 (Ator companheiro: eidolon e familiar)

Lane de evidência VIVA/OLHADA (níveis 2 e 3 da prova de entrega, `execucao.md` seção 3).
Worktree `wt-o0` (branch `ficha3/o3`, sha base `1636b444`). Servidor real, mundo real (cópia
de `teste_xande` em `scratchpad/data-o3`), browser real via Playwright (`playwright-cli`), banco
lido e verificado diretamente (`better-sqlite3`).

## O que já estava provado antes desta lane

`.fusion-build/ficha-nivel3/ondas/o3/evidencia.md`: nível **Mecânico** verde (9/9 testes de
`companion-eidolon.test.ts`), níveis **Vivo** e **Olhado** marcados **PARCIAL** — bloqueante B1
(issue #241): nenhum ator companheiro real criado num mundo real, nenhum print da aba Pets.

## O que esta lane provou

### Summoner nível 1 + Eidolon

1. Ator `Novo Ator` (id `uPI3hK89HeppNd4a`) resetado a nível 1 sem classe (dado de teste — via
   escrita direta no `world.db` da cópia em scratchpad, nunca no mundo original).
2. Classe `Summoner` aplicada pela UI (Plano → Classe → buscar/clicar/Confirmar).
3. Slot "Eidolon" do nível 1 preenchido com `Beast Eidolon` pela UI.
4. Ao **fechar e reabrir** a janela da ficha, o servidor rodou o heal on-open
   (`runHealAutoCompanion`) e criou o ator companheiro:
   ```
   actors: { id: "bvpTKwoeEx4zDGJO", type: "familiar", name: "Eidolon" }
   system: { companionKind: "eidolon", masterActorId: "uPI3hK89HeppNd4a" }
   ownership: { default: 0, ElEb3Ds597HCt5fa: 3 }
   ```
   verificado por leitura direta do `world.db` (não só na UI).
5. Ownership do master (`Novo Ator`) tinha sido setado antes para `{ElEb3Ds597HCt5fa: 3}`
   (Player_O3c) — o eidolon nasceu com **exatamente o mesmo mapa de ownership**, confirmando
   REQ-PET-09x (posse herdada do dono).

### Witch nível 1 + Familiar

1. Ator `Tobias` (id `MVZPT17ybspil2yu`, já possuído pelo jogador `Tobias`,
   `ownership: {hLFfRgqkasgtY9Xs: 3}`) resetado a nível 1 sem classe.
2. Classe `Witch` aplicada pela UI.
3. Ao fechar/reabrir a ficha, o servidor criou:
   ```
   actors: { id: "HNdQUFXCfOE2gSW7", type: "familiar", name: "Familiar" }
   system: { companionKind: "familiar", masterActorId: "MVZPT17ybspil2yu" }
   ownership: { default: 0, hLFfRgqkasgtY9Xs: 3 }
   ```
   — ownership igual ao do master, sem eu precisar setar nada (já vinha de antes).

### Smoke GM + Player

- GM (`GM_O3c`): abriu as duas fichas, viu os dois companions aninhados na gaveta Contatos e
  a aba "Pets" de cada ficha com o card do companion.
- Player (`Player_O3c`, dono só do `Novo Ator`): logou, abriu Contatos, viu "Novo Ator (você)"
  com "Eidolon" aninhado embaixo; **não viu** o Tobias (personagem de outro jogador) —
  confirma que a redação de ownership filtra corretamente por jogador.

## Prints (todos OLHADOS — descrição do que cada um prova)

Pasta: `scratchpad/ficha3-reports/o3/prints/`

1. `01-summoner-classe-confirmada.png` — card "Classe Summoner" ✓ no Plano, nível 1 mostra
   "Summoner 1" ✓ e slot "Eidolon" ainda vazio — prova que a classe pura foi aplicada sem a
   contaminação do item duplicado (ver achado abaixo).
2. `02-summoner-eidolon-escolhido.png` — slot "Beast Eidolon" ✓ preenchido no Plano, ANTES do
   reabrir — nesse momento ainda não existe ator companheiro (conferido no DB), provando que a
   criação não é síncrona ao confirm.
3. `03-eidolon-gaveta-contatos.png` — gaveta Contatos, GM: "Novo Ator" com "Eidolon" aninhado
   embaixo, aba "Pets" já visível no menu de tabs do personagem.
4. `04-eidolon-aba-pets.png` — aba Pets do "Novo Ator": card "Eidolon" (tipo EIDOLON), PV 0/0,
   CA 10, saves +0 — confirma que o documento existe mas a derivação de estatísticas do eidolon
   está incompleta (achado já registrado, issue #131 do satélite).
5. `05-familiar-gaveta-contatos.png` — gaveta Contatos, GM: "Tobias" com "Familiar" aninhado.
6. `06-familiar-aba-pets.png` — aba Pets do Tobias: card "Familiar", PV 5/5, CA 14, saves e
   deslocamento preenchidos, "Habilidades diárias 0/4" — a derivação do familiar está completa
   (ao contrário do eidolon).
7. `07-player-ve-eidolon.png` — sessão logada como `Player_O3c`: vê "Novo Ator (você)" +
   "Eidolon" aninhado; "Conhecidos 0" (não vê o Tobias de outro jogador) — prova visual de
   ownership correto do lado do jogador.

Prints de debug do achado (não fazem parte da prova formal, ficam como evidência do defeito):
`debug-01-after-confirm.png`, `debug-02-classe-summoner.png`.

## Achado novo (registrado, não consertado)

**Trocar de classe pelo diálogo do Plano, num ator que já tem um item `type: "class"`, não
substitui esse item — duplica.** Reproduzido ao vivo: `Novo Ator` tinha `Barbarian` + (de uma
rodada anterior) `Summoner`/`Beast Eidolon` soltos; ao confirmar `Summoner` de novo, o servidor
gravou uma atualização real (log `doc-store write metrics`) mas o card do Plano continuou
mostrando "Bárbaro Barbarian" — porque o card lê `items.find(i => i.type === 'class')`, que
retorna o primeiro (Barbarian), enquanto o segundo item (`Summoner`) foi adicionado sem remover
o primeiro. `Tobias`, contaminado de rodadas ainda mais antigas, tinha **três** itens `class`
simultâneos (`Bard`, `Barbarian`, `Cleric`). Isso também bloqueia a heal do companion, que lê o
mesmo primeiro item.

- Issue aberta: https://github.com/xansde/fusion/issues/246 (com cenário, reprodução e
  hipótese de causa).
- Comentário de fechamento em https://github.com/xansde/fusion/issues/241 (B1) com o resumo
  desta evidência.
- Workaround usado (documentado no runbook, seção 8 nova): resetar o ator de teste a nível 1
  sem classe via escrita direta no `world.db` de scratchpad antes de reaplicar a classe.

## Runbook

`docs/design/ficha-nivel3/gate-runbook.md` ganhou a seção 8 (heal on-open do companion +
achado da duplicação de classe), formatada com `prettier --write` e commitada/pushada:
commit `d60ab51f` em `ficha3/o3` (`docs(ficha-nivel3): registra o gatilho de heal do companion
e a duplicação de classe no runbook`).

## Comandos rodados

- `node packages/server/dist/cli/index.js user add ...` (2x, GM_O3c/Player_O3c) — data-dir
  `scratchpad/data-o3`, mundo `teste_xande` (cópia).
- `CI=1 node packages/server/dist/cli/index.js serve --port 33021 ...` — subido e derrubado
  3 vezes (para os dois resets de dado de teste via DB direta).
- Leituras diretas do `world.db` via `better-sqlite3` (node -e) para verificar `actors`,
  `ownership`, `system.companionKind`, `system.masterActorId` — nunca só pela UI.
- `playwright-cli` (sessões `o3gm` e `o3player`) para toda a navegação/prints.
- Servidor encerrado ao final: `taskkill //PID <pid> //F`, confirmado com `netstat` (só
  `TIME_WAIT` residual).

## Pendências para issue

Já cobertas por issues existentes ou abertas nesta lane:

| Item | Repo | Issue |
|---|---|---|
| Duplicação de item `class` ao trocar classe pelo Plano | xansde/fusion | #246 (aberta nesta lane) |
| Eidolon sem PV/CA/saves derivados (card zerado) | xansde/fusion-systems-2e | #131 (já aberta, confirmada ao vivo nesta lane) |

Nenhuma pendência nova de código além dessas duas — o mecanismo de criação/ownership do
companion (o que esta lane deveria provar) funcionou corretamente nos dois casos (Summoner e
Witch) uma vez contornada a contaminação de dado de teste.

## Veredito desta lane

B1 (evidência viva/Vivo/Olhado da Onda 3) **coberto**: Summoner nv1+Eidolon e Witch nv1+Familiar
provados como documentos `Actor` próprios, com `masterActorId` e ownership herdado corretos,
verificados no banco (não só na UI), com prints do ator criado, da aba Pets e do smoke GM+Player.
Um achado novo (não desta feature) foi registrado como issue própria, não consertado (fora do
escopo desta lane — "defeito não conserte, registra").
