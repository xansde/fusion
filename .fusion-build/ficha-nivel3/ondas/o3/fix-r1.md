# Fixer o3 — rodada 1

Worktree: `.../scratchpad/wt-o0` (core `ficha3/o3`, satélite `external/fusion-systems-2e` `ficha3/o3`).
Achados-fonte: `revisao-adversarial.md` (veredito REPROVADA: 1 bloqueante de processo + 4 importantes).

## Tabela achado → commit → teste

| Achado | O quê | Commit(s) | Teste (RED→GREEN) |
|---|---|---|---|
| **I2** importante — grant da Witch dependia da feature (retry podia perder a corrida) | `detectWitchFamiliarGrant` no satélite: `companionGrantAllows("familiar", ...)` passa a aceitar o item de classe da Witch sozinho, espelhando `detectEidolonGrant`/Summoner. `pet` continua exigindo o sinal real. | satélite `154279f` (fix+teste unit); core `89d0576f` (teste de servidor real) | `systems/pf2e/src/__tests__/companion-grant.test.ts` (3 casos novos) — RED confirmado antes do fix (`expected false to be true`); `packages/server/src/__tests__/companion-witch-familiar.test.ts` (2 casos, servidor REAL via `boot()`) — RED confirmado (1ª tentativa negada) antes de rebuildar o dist do satélite, GREEN depois |
| **I1** importante — aba Pets trata eidolon como familiar (chave crua, picker, grava abilitiesBudget) | `hasDailyAbilities(kind)` vira o predicado único; `buildMasterRefreshOp` retorna `null` para eidolon (não grava mais `abilitiesBudget`/hp-cache nele); `PetCard.svelte` esconde todo o bloco de habilidades diárias (picker/chips/contagem) e para de buscar o pack para eidolon; chave `FUSION.Sheet.Pets.Kind.eidolon` criada em en/pt-BR | satélite `8184ac9` (petsVM), `a14b864` (PetCard.svelte); core `f18a474a` (i18n + teste de cobertura) | `petsVM.test.ts` (`hasDailyAbilities`, `buildMasterRefreshOp` com eidolon) — RED confirmado (função inexistente / op não-nulo indevido); `bundle-completeness.test.ts` → "Pets Kind badge keys coverage" — RED confirmado (`eidolon` ausente de EN); GREEN após os fixes |
| **I3** importante — trocar de classe deixa o companheiro da classe anterior | `staleAutoCompanionAfterClassChange` (função pura, satélite): detecta o companheiro órfão SEM apagar (schema não distingue auto-criado de manual); `PlanColumn.svelte` chama a checagem antes de aplicar a classe nova e mostra um aviso dispensável com botão explícito de remoção (nunca automático) | satélite `8184ac9` (função pura), `a14b864` (wiring UI); core `f18a474a` (chaves i18n `StaleCompanion.*`) | `petsVM.test.ts` → `staleAutoCompanionAfterClassChange` (5 casos) — GREEN direto (função nova, sem comportamento antigo para reproduzir em RED além do "não existe"); `bundle-completeness.test.ts` cobre as chaves novas |
| **I4** importante — mapeamento de erro da aba Pets quebrado (regressão da onda, teste circular) | `familiarCreateErrorKey` casava com as mensagens PRÉ-T3.2 ("already has a familiar" / "no feat that grants a familiar"), que o servidor não emite mais. Passa a casar pelo mesmo substring estável que `sendAutoCompanionOp` já usa ("already has a companion" / "has no grant for a companion") | satélite `8184ac9` | `petsVM.test.ts` (2 casos reescritos com as mensagens REAIS do servidor, copiadas de `doc-handlers.ts`) — RED confirmado (`Permission`/`Generic` em vez de `NoGrant`/`Duplicate`) antes do fix, GREEN depois |
| **B1** bloqueante de processo — evidência viva não rodou | **Não resolvido por este fixer** — ver "Pendências" abaixo | — | — |

Achados **menores** (M1, M2) do relatório **não** estavam na lista de "achados confirmados" desta rodada — não foram tocados (nem M1's fórmula em `familiar-grant.ts`, nem M2's teste de sourceId espelhado).

## Verificação rodada (nesta ordem, no fim de todos os fixes)

- `pnpm build` (core, monorepo completo incl. submódulo) — verde.
- `pnpm typecheck` (core, `pnpm -r`) — **0 ERRORS**, 24 warnings pré-existentes (a11y/CSS não-usado em `CharacterSheet.svelte`, nada meu).
- `pnpm lint` — 0 erros (1 warning pré-existente em `pregen-parity.test.ts`, não tocado por mim).
- `pnpm lint:boundaries` — sem violação (5044 módulos).
- `pnpm format:check` — tudo formatado.
- `pnpm spec:report` — `cobertura [MVP] com teste: 719 (piso 719)`, sem regressão.
- Testes AFETADOS (não a suíte inteira):
  - `sheets/pf2e`: `petsVM.test.ts` (46/46), `petsWire.test.ts` (7/7), `planVM.test.ts` (397/397).
  - `systems/pf2e`: `companion-grant.test.ts` (23/23).
  - `packages/server`: `companion-witch-familiar.test.ts` (2/2, novo), `companion-eidolon.test.ts` (9/9, sem regressão), `player-familiar-create.test.ts` (11/11, sem regressão).
  - `packages/client`: `bundle-completeness.test.ts` (46/46).

`tocou_fluxo_criacao = true`: `buildMasterRefreshOp`, `PetCard.svelte`, `PlanColumn.svelte` e `companion-grant.ts` são exatamente o caminho que a criação/subida de nível de Summoner e Witch executa.

## Commits

Satélite (`xansde/fusion-systems-2e`, branch `ficha3/o3`, pushada):
- `154279f` fix(pf2e): Witch autoriza familiar pelo item de classe, sem esperar a feature
- `8184ac9` fix(pf2e): eidolon para de herdar o mecanismo de habilidades do familiar
- `a14b864` fix(pf2e): esconde o picker do eidolon e avisa sobre companheiro obsoleto

Core (`xansde/fusion`, branch `ficha3/o3`, pushada):
- `f18a474a` fix(client): traduz o badge de eidolon e o aviso de companheiro obsoleto
- `89d0576f` test(server): prova que o familiar da Witch autoriza pelo item de classe
- `33a8e99e` chore(deps): atualiza o pin do fusion-systems-2e (fixes da onda 3)

## Achados que considerei e NÃO consertei (com prova)

Nenhum dos 5 achados confirmados da lista foi refutado nesta rodada — os 4 importantes (I1-I4)
tinham teste RED reproduzível contra o código real antes do fix, exceto I3 (função nova).

## Pendências para issue

### 1. B1 — evidência viva ainda não rodou (bloqueante de processo)

**Por que não resolvi aqui**: o próprio achado já registra `Dono: o processo da onda (fecho)`,
não este fixer. Tentei mesmo assim e bati em uma restrição estrutural real: a skill
`tutorial-e2e` é **local e não versionada** (`.claude/skills/tutorial-e2e/node_modules`, com
`package.json` próprio instalado via `npm install` — o próprio README da skill diz
"não versionar"). Ela só existe na árvore principal `C:/Users/xansd/pessoal/fusion`, que as
regras desta rodada proíbem tocar (mesmo checkout), e minha worktree isolada não a herda (não
está no git). Reproduzi-la aqui exigiria ou (a) rodar `npm install` numa pasta nova — proibido
nesta rodada ("não rode pnpm install... não adicione dependência nova") — ou (b) tocar a árvore
principal — proibido. Não force nenhuma das duas.

O que MUDOU de fato: antes dos fixes desta rodada, uma evidência viva teria capturado a aba
Pets de um eidolon com a chave i18n crua e o picker de familiar oferecido (I1) — ou seja, rodar
o roteiro ANTES destes consertos teria produzido prints enganosos. Agora o código que a
evidência fotografaria já está correto; falta só a fotografia.

- **Repo**: `xansde/fusion`
- **Título**: `Rodar tutorial-e2e (Summoner/Witch nível 1) — evidência viva da onda 3 de companheiros`
- **Corpo**:
  ```
  A revisão adversarial da onda 3 (Ator companheiro — eidolon e familiar) reprovou por falta de
  evidência viva (B1): nenhum print mostra o eidolon/familiar criado como ator nem a aba Pets,
  como GM e como player, para Summoner e Witch nível 1.

  Os 4 achados importantes da mesma revisão (I1-I4) já foram consertados e verificados por teste
  (ver .fusion-build/.../ficha3-reports/o3/fix-r1.md), incluindo o que a evidência teria
  fotografado errado (I1: eidolon mostrando o picker de familiar).

  Falta rodar a skill tutorial-e2e (que vive só na árvore principal, não em worktrees isoladas)
  para produzir o roteiro Summoner+Witch nível 1 com prints do ator criado e da aba Pets, GM e
  player, e OLHAR cada print (Iron Law da skill) antes de fechar a onda.
  ```

### 2. Fora do escopo desta onda — Animista: seleção de espíritos não atualiza nada

O Alexandre testou o Animista e relatou: ao selecionar os espíritos, nada foi adicionado à
lista de magias, nem filtro, nem aba — nada mudou. **Isso não pertence à onda 3** (que é sobre
Ator companheiro / eidolon-familiar) — já estava registrado como fora de escopo no relatório da
revisão adversarial (`revisao-adversarial.md`, seção final) antes mesmo deste fixer rodar, e o
relato do Alexandre confirma o mesmo sintoma. Precisa virar frente própria antes da próxima
onda tocar o Animista.

- **Repo**: `xansde/fusion` (ou `xansde/fusion-systems-2e`, a confirmar onde vive a seleção de
  espíritos — não investiguei o código, fora do escopo desta rodada)
- **Título**: `Animista: selecionar espírito não atualiza lista de magias, filtro nem aba`
- **Corpo**:
  ```
  Relato do Alexandre (testado ao vivo, fora desta onda): ao selecionar os espíritos na ficha
  do Animista, nada é adicionado à lista de magias, o filtro não muda, e nenhuma aba reflete a
  escolha — nada muda na tela.

  Não investigado ainda (fora do escopo da onda 3, que é sobre companheiro eidolon/familiar).
  Precisa de discovery próprio: reproduzir o fluxo, achar o VM/componente responsável pela
  seleção de espírito do Animista e comparar com o que a spec do Animista promete.
  ```
