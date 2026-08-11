---
card_id: dsc-08073fee-659
fase: discovery
repo_alvo: C:\Users\xansd\pessoal\fusion
branch: esteira/mapa-jogavel-08073fee
worktree_path: null
model: opus
effort: medium
disparado_por: run-97810cbf-23e
disparado_em: 2026-08-05T21:52:36Z
handoff_anterior: null
kit_version: 2.1.0
---

# mapa jogável

**Origem:** runner esteira-donel (`run-97810cbf-23e`), inbox JSON — não há card
TaskDex (projeto pessoal; roteamento de tarefas é o vault/`.fusion-build/todo.md`).

**Descrição do card:** título apenas (`mapa jogável`); campo `problem` vazio.
Todo o escopo precisa sair da entrevista.

**Prioridade:** não informada pelo runner.

## Estado do repo apurado antes da entrevista (fato, não pergunta)

Branch atual `fix/b3-i18n`, árvore limpa. O canvas **não parte do zero**:

- `packages/client/src/lib/canvas/`: `FusionCanvas.ts`, `GridRenderer.ts`,
  `camera-math.ts`, `layers.ts`, `sceneLoader.ts`, `scene-orchestrator.ts`.
- `tokens/`: `TokenLayer`, `TokenSprite`, `TokenInteractionManager`,
  `token-interaction.ts`, `token-visuals.ts`.
- `walls/WallsLayer.ts`; `vision/`: `LightingRenderer`, `fog-state`, `vision-state`.
- `combat/`: `combatCanvasController`, `CombatTurnMarker`, `TargetingMarker`.
- Servidor: `net/handlers/{fog,vision,sync,doc}-handlers.ts`, `fog/fog-store.ts`.
- UI de cenas: `ScenesSidebar`, `SceneCreateDialog`, `ScenePerceptionDialog`,
  `TokenAddDialog`, `TokenConfigDialog`, `NoSceneOverlay`, `ActiveSceneBadge`.

Specs de referência: `06-canvas-e-renderizacao.md`, `07-visao-iluminacao-fog.md`,
`10-combate-e-iniciativa.md`.

## Lições anteriores relevantes

Consultado: `CLAUDE.md` (raiz), `.fusion-build/todo.md`, `.fusion-build/r22/varredura-jogabilidade.md`,
`.fusion-build/r24/{handoff-b3-pausado.md,plano-batches.md}`. `lessons.md` não existe no repo.

- **Lição-mestra r22 (#48):** teste circular — a varredura das 12 classes conferia a
  derivação contra a tabela do próprio pack; 80 testes verdes conviviam com 60 defeitos.
  **Aplicação aqui:** o critério de "mapa jogável" não pode ser "os testes de canvas
  passam"; tem que ser uma varredura de jogabilidade real (rodar uma cena e tentar jogar).
- **Lição r24 (handoff B3):** "agente reportou verde" ≠ verificado; um agente reportou
  suíte verde rodando pacote a pacote enquanto o workspace acusava 5 falhas.
- **Estado pendente do repo (não é lição, é risco de contexto):** o B3 ficou com gates de
  workspace NÃO rodados e sem push/PR. Isso encosta em qualquer trabalho novo na árvore.

Nenhuma lição encontrada **contradiz** o card.
