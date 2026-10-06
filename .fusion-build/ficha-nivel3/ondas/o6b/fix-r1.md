# Fixer da o6b — rodada 1

Worktree: `scratchpad/wt-d`. Core branch `ficha3/o6b` @ `82231a7e` (pushed). Satélite
`xansde/fusion-systems-2e` branch `ficha3/o6b` @ `66c3a3f` (pushed).

## Achado → commit → teste

| id | achado | commit(s) | teste (vermelho → verde) |
| --- | --- | --- | --- |
| **C2** | `fusion user add` criava PLAYER sem o Actor `character` em branco da REQ-USR-025 (chamava `userStore.create` direto, não `AuthService.createUser`) | `20edd60d` fix(server) — core | `packages/server/src/__tests__/cli/user-add.test.ts` (novo): roda a CLI buildada de ponta a ponta, abre o `world.db` e confere o Actor. Vermelho antes (`anaActor` undefined), verde depois. GM continua sem Actor (DEC-USR-01) |
| **C3** | `checkSlotRequirement` comparava só o PRIMEIRO trait de classe de um talento multi-classe (`traits.find`) contra `classSlug`, marcando "classe errada" mesmo quando a classe atual estava listada, só não em primeiro lugar (Mago pegando "Familiar" ficava com aviso vermelho permanente) | `66c3a3f` fix(sheets-pf2e) — satélite; `adcf4cbe` chore — pin do core | `planVM.test.ts`, describe "checkSlotRequirement — classFeat with several class traits": dados reais do feats-core (Familiar id `sgqC3nNQZhuobaNi`, Cantrip Expansion id `JBcRCbPY8TQYUTGh`). 2 dos 4 casos vermelhos antes (Wizard com Familiar/Cantrip marcado errado), verdes depois; caso "nenhuma classe bate" (Fighter) continua corretamente marcado |
| **C1** | O teste do outsider (`player-character-create.test.ts`) e o texto do `tasks.md` (T6.5/Gate) vendiam a asserção negativa como prova da fronteira de redação do REQ-NET-096 nos 4 caminhos; na verdade `redaction.ts` só corta por ownership no snapshot de join (`sync-handlers.ts`) — broadcast ao vivo, replay de delta e eco do ack continuam devolvendo o Actor `character` inteiro a qualquer viewer | `ee0d801c` docs — core (+ `82231a7e` prettier) | Sem mudança de código/asserção — é achado de PROVA excessiva, não de comportamento. Conserto: issue `xansde/fusion#240` (conflito de spec 05×39, decisão de produto pendente) + anotação no teste + correção do texto do `tasks.md` dizendo explicitamente que a prova cobre só o snapshot |

Commit extra: `82231a7e` style — `prettier --write` nos dois arquivos que `format:check`
acusou (`tasks.md`, `user-add.test.ts`), sem mudança de conteúdo.

## Achado C4 (menor) — não estava na lista de "confirmados" do disparo

A revisão adversarial lista C4 (menor: "prova automatizada" para no botão, falta teste da
CharacterSheet com ator sem `system`) mas o disparo desta rodada listou explicitamente só
C1, C2, C3 como "achados confirmados" a consertar. C4 não foi tocado por instrução — fica
registrado aqui para quem ler este relatório não achar que foi esquecido.

## Verificação (gate completo, não só os arquivos afetados)

Todos rodados na worktree após os 3 fixes, nesta ordem, todos verdes:

- `pnpm build` — 14/14 pacotes (inclui client vite build, ~4min)
- `pnpm typecheck` — 0 erros, 24 warnings pré-existentes (svelte-check, não relacionados)
- `pnpm lint` — 0 erros, 1 warning pré-existente em `pregen-parity.test.ts` (não tocado)
- `pnpm lint:boundaries` — sem violação
- `pnpm format:check` — limpo após o commit de estilo
- `pnpm spec:report` — cobertura MVP com teste: 710 (piso 710)

Testes afetados rodados isolados (não a suíte inteira):

- `packages/server/src/__tests__/cli/user-add.test.ts` — 2/2 verde
- `packages/server/src/__tests__/player-character-create.test.ts` — 17/17 verde (só
  comentário mudou; rodado para confirmar não-regressão)
- `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/__tests__/planVM.test.ts` —
  394/394 verde (suíte inteira do arquivo, por ser o único tocado no satélite)

## Pendências para issue (já abertas)

- **xansde/fusion#240** — conflito de spec 05×39 (REQ-USR-025a `ownership.default=none` ×
  REQ-CTT-014/Q-CTT-03 "Na mesa mostra todos a todos") + predicado de redação de Actor
  `character` divergente entre os 4 caminhos do REQ-NET-096 (snapshot vs.
  broadcast/replay/eco). Decisão de produto pendente, não corte de escopo desta lane.
- **xansde/fusion-systems-2e#129** — registro do achado C3 (`checkSlotRequirement`
  multi-classe); já resolvido no mesmo commit, issue é só rastreamento.

## tocou_fluxo_criacao

`true` — o fix de C2 (`packages/server/src/cli/commands/users.ts`) muda o que o CLI de
criação de usuário executa (agora cria o Actor `character` junto), e o fix de C3
(`planVM.ts`, `checkSlotRequirement`) muda o que a UI do Plano exibe ao montar um
personagem (deixa de marcar falsamente "classe errada" em talentos multi-classe). C1 foi
só doc/teste (comentário), sem esse efeito por si só, mas o conjunto da rodada qualifica
como `true`.
