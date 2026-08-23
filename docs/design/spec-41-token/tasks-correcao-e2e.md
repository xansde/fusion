# Token — correção pós e2e manual (roteiro de 22–23/08)

Origem: `.fusion-review/roteiro-token.html`, preenchido pelo Alexandre em 22–23/08, 7
divergências reportadas sobre 13 tarefas testadas.

**Este documento existe porque a sessão que investigou essas 7 divergências cometeu, ela
mesma, o erro nº 1 da lista abaixo: testou o branch errado.** 5 dos 7 "bugs" reportados
eram sintoma disso, não defeito de produto. Antes de tocar em qualquer tarefa, rode o
checklist da seção 0 — ele existe para que isso não se repita.

> **Estado em 2026-08-23 (segunda sessão, orquestrada):** as seções 1, 2 e 3 foram
> executadas — ver o bloco "O que a sessão de 23/08 fez" logo abaixo do resumo executivo.
> **O que resta é decisão humana**: merge das PRs (ordem na seção 1) e as decisões de
> produto listadas na seção 7. A seção 2 foi **reescrita**: o diagnóstico original
> (`draggable="false"` no retrato) estava errado — a causa real é outra e já está
> corrigida no PR #195.

---

## 0 — COMECE AQUI — checklist obrigatório antes de qualquer coisa

Não pule para as tarefas. Rode isto primeiro, nesta ordem, numa sessão nova.

### 0.1 — Entenda o mapa de branches (isto mudou desde a última vez que alguém olhou)

| Branch/worktree                                                                     | O que tem                                                                                                                                                                                                                                     | Use para                                                                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/spec-41-token-tasks` (repo principal, `C:\Users\xansd\pessoal\fusion`)        | Só o **plano** (specs, decisões, este arquivo). **Não tem nenhuma das 8 fases implementadas.**                                                                                                                                                | Ler/editar documentação, planejar. **Nunca build+serve daqui para testar Token.**                                                         |
| `alfa/app` (`origin/alfa/app`)                                                      | Fase 0 (#176), Fase 1 (#182), PR #194 (mecânica de arraste). **Não** tem Fase 2–9.                                                                                                                                                            | Linha real do produto pessoal do Alexandre. Onde as PRs abaixo precisam chegar.                                                           |
| `feat/tk-fase2-defeitos-mesa` … `feat/tk-fase9-remove-visao`                        | As 8 fases implementadas, uma por branch, cada uma empilhada sobre a anterior. PRs #186–#193, todas com base declarada `alfa/app`, CI verde, **nunca revisadas por humano**.                                                                  | Fonte de verdade do que fazer merge (seção 1).                                                                                            |
| `fix/npc-drag-portrait` (PR #195) e `fix/tk-integracao-pos-194` (PR #196)           | Os dois PRs novos de 23/08: o fix do arraste NPC→cena (seção 2) e os riscos de integração entre o #194 e as fases (seção 1). Worktrees em `...\scratchpad\8f8390bf.../wt-fix` e `.../wt-int` (descartáveis; as branches estão no remoto).     | Revisar/mergear.                                                                                                                          |
| `integracao/e2e-token-aj` / worktree `wt-e2e` (`...\scratchpad\cd781101.../wt-e2e`) | Rascunho descartável de uma sessão anterior: `alfa/app` antigo + as 8 fases mergeadas localmente + 1 fix a mais não commitado (plugar `TokenInteractionManager`, redundante com o que o #194 já fez depois). **Nunca foi commitado/pushado.** | Só para conferência pontual de código — **não é onde trabalhar**. Pode ser descartado a qualquer momento sem perda (nada ali é original). |

Se qualquer um desses estados mudou (alguém já mergeou uma PR, uma branch sumiu), **confie
no que os comandos abaixo mostrarem, não nesta tabela** — ela é uma foto de 23/08.

### 0.2 — Confirme o estado real, ao vivo (não confie em memória nem neste arquivo)

```bash
cd "C:\Users\xansd\pessoal\fusion"
git fetch origin

# Estado das 8 PRs — confirme que a lista abaixo ainda bate com a realidade
gh pr list --state all --search "Fase 2 OR Fase 3 OR Fase 4 OR Fase 5 OR Fase 6 OR Fase 7 OR Fase 8 OR Fase 9" --limit 20

# Prova direta e barata de que uma fase específica JÁ chegou (ou não) em alfa/app —
# troque o commit por qualquer um citado na seção 1; se retornar vazio (sim) a fase
# já está lá e a tarefa correspondente pode ser riscada sem merge.
git log --oneline origin/alfa/app | grep -i "TK031\|barra de recurso"
```

### 0.3 — Antes de subir um servidor para testar qualquer coisa de Token

**Nunca** rode `pnpm build && node packages/server/dist/cli/index.js serve` a partir do
que estiver checked out sem antes confirmar que o commit ativo contém o que você quer
testar:

```bash
# HEAD atual contém o commit/branch que você acha que está testando?
git merge-base --is-ancestor <commit-ou-branch-alvo> HEAD && echo "SIM, está no HEAD" || echo "NAO esta — voce vai testar codigo errado"
```

Se a resposta for "NAO", **não construa o servidor dali**. Ou (a) mude para o branch/
worktree certo, ou (b) mergeie o que falta primeiro (seção 1), ou (c) pergunte antes de
assumir.

### 0.4 — Se for preciso um worktree isolado para testar antes do merge

Não recrie uma cópia manual tipo `wt-e2e` (rascunho, nunca commitado, já teve um "estado
de sessão" perdido por travar no meio). Prefira:

```bash
git fetch origin
git worktree add <caminho-no-scratchpad> alfa/app
cd <caminho-no-scratchpad>
git merge origin/feat/tk-fase2-defeitos-mesa   # ...e assim por diante, na ordem da seção 1
pnpm install && pnpm build
```

Isso é reprodutível e descartável (`git worktree remove` no final) — e cada merge fica
registrado no histórico do worktree, então dá pra saber depois exatamente o que foi
testado.

---

## Resumo executivo

| Tarefa   | O que o roteiro reportou               | Situação real                                                                                                           |
| -------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TK031    | barra de vida não aparece              | ✅ **corrigido**, só falta merge — #186 (Fase 2): barra lê valor real do ator, com corte OWNER (`redaction.ts`)         |
| TK040    | trocar arte não atualiza a peça        | ✅ **corrigido**, só falta merge — #187 (Fase 3): `texture` saiu do schema, `TokenSprite` resolve do ator a cada render |
| TK041    | não achou controle de tamanho          | ✅ **corrigido**, só falta merge — #187 (Fase 3): footprint vem de `system.sizeToFootprint`                             |
| TK042(c) | atitude não aparece ao recriar o token | ✅ **corrigido**, só falta merge — #187 (Fase 3): `resolveDisposition()` lê `flags.fusion.attitude` do ator             |
| TK050    | Ctrl+arraste não duplica               | ⚠️ **não é bug** — spec 41 rebaixou esse gesto de propósito (seção 4)                                                   |
| TK042(a) | não dá pra arrastar NPC pra cena       | ✅ **corrigido no PR #195** — bug real, independe de branch, mas a causa NÃO era a do diagnóstico original (seção 2)    |
| TK042(b) | não sai de "entrevisto"                | 🟡 **não é bug de escrita** — gap de descoberta de UI (seção 5), decisão de produto                                     |
| TK062    | sem paredes pra testar                 | ⚠️ **fora de escopo por decisão já tomada** (seção 6)                                                                   |

Achado colateral já corrigido: a memória `project_leva_noturna_2026_08_17.md` desta
máquina dizia "#185–193 foram mergeados em `alfa/app`" — **estava errada** (uma checagem
anterior confundiu o `TokenInteractionManager.ts` pré-existente, do milestone M1-C, com o
resultado das fases do Token). Já corrigida.

### O que a sessão de 23/08 fez (8 revisores + 21 verificadores adversariais + 1 análise de integração + cadeia sequencial de 9 etapas + auditoria final)

1. **Revisão das 8 PRs** (#186–#193), cada achado médio/alto verificado por três lentes
   adversariais independentes. Resultado: 2 PRs limpas (#188, #193), 4 achados confirmados
   e corrigidos na própria fase (F187-4, F189-1, F190-1, F192-1), 1 achado refutado
   (REQ-SYS-009 existe na branch — o revisor leu a árvore de trabalho errada, a mesma
   armadilha da seção 0), 1 só de texto de PR, e 2 achados que são **decisão de produto**
   (seção 7).
2. **Cadeia de merge**: cada branch `feat/tk-fase*` recebeu merge (commit de merge, sem
   rebase) da anterior e, por transitividade, de `alfa/app` com o #194. Conflito único em
   `TableScreen.svelte` (bloco de imports), resolvido mantendo os dois lados. Os três
   mocks de `pixi.js` sem `Rectangle` (quebrariam com o `hitArea` do #194) foram corrigidos
   na fase em que nasceram. **CI verde nas 8 PRs** após a cadeia.
3. **PR #196** (`fix/tk-integracao-pos-194`, empilhada sobre #193): riscos de integração
   que não pertencem a fase nenhuma — `ownedActorIds` congelado (R2), grid da cena sem
   repintar (R4), `footprintRegistry` tardio (R5), `destroy()` que deixava a camada
   interativa (R9) — mais os dois achados da auditoria final (P1 duplicar com ator base,
   P2 `isEditableTarget` amplo demais). Tudo TDD, CI verde.
4. **PR #195** (`fix/npc-drag-portrait`, independente, direto de `alfa/app`): o arraste
   NPC→cena (seção 2), com prova em browser real.
5. **Seção 3 (token sem F5)**: tentou-se reproduzir duas vezes em browser real
   (Playwright) — em `alfa/app` puro (#195) e no estado integrado (#196) — e **não
   reproduziu** em nenhum dos dois, nem para o Mestre nem para o jogador.
6. **Piso de cobertura MVP** (`pnpm spec:report`), verificado de fato: `alfa/app` 712 →
   #193 (fases 2–9 integradas) **745** → #196 **746**; #195 sozinho 713.

---

## 1 — Prioridade zero: fazer as 8 PRs existentes chegarem em `alfa/app`

Isto não é "escrever código novo" — é revisar e mergear o que já foi escrito e testado
(CI verde) há quase uma semana. Enquanto isso não acontece, o produto real (`alfa/app`)
segue com a barra de vida sempre cheia, a arte não herdada, o footprint fixo em 1×1 e
qualquer jogador podendo excluir a própria peça.

**Revisão feita (23/08, adversarial, sem humano ainda); merge é ato do Alexandre.** Ordem
obrigatória, porque as branches são empilhadas e todas declaram base `alfa/app` (o diff de
cada PR no GitHub é cumulativo até a anterior mergear — para ver só a fase, compare com a
branch anterior: `git diff feat/tk-fase2-defeitos-mesa..feat/tk-fase3-heranca`):

- [x] Revisar #186 (Fase 2 — TK030-033) — limpa; F186-1 (citação de REQ) corrigida — [ ] mergear
- [x] Revisar #187 (Fase 3 — TK040-042) — F187-4 corrigido (snap de arraste com ator efetivo); F187-1 é decisão de produto (seção 7) — [ ] mergear, depois de #186
- [x] Revisar #188 (Fase 4 — TK050-051) — limpa — [ ] mergear
- [x] Revisar #189 (Fase 5 — TK060-062) — F189-1: comentário falso removido; a validação de limites da cena é decisão de produto (seção 7) — [ ] mergear
- [x] Revisar #190 (Fase 6 — TK070-074) — F190-1 **implementado**: corte de `actorDelta.system.attributes.hp` por papel (REQ-DOC-062/REQ-TOK-072) nos quatro caminhos de REQ-NET-096, com e2e — [ ] mergear
- [x] Revisar #191 (Fase 7 — TK080,082-084) — limpa no código; TK081 cortada é decisão de produto (seção 7) — [ ] mergear
- [x] Revisar #192 (Fase 8 — TK090-093) — F192-1 corrigido (duplicar usava o `_id` do cliente, o servidor atribui outro → o `doc:update` da vida falhava sempre); R3 corrigido (atalhos de teclado ignorados durante digitação) — [ ] mergear
- [x] Revisar #193 (Fase 9 — TK100) — limpa; leitura "inerte ≠ removido" é decisão de produto (seção 7) — [ ] mergear
- [ ] Mergear **#196** (`fix/tk-integracao-pos-194`) por último — é empilhada sobre #193
- [ ] Mergear **#195** (`fix/npc-drag-portrait`) — independente, pode ir a qualquer momento
- [x] **Conflito com #194** resolvido dentro das branches (merge commit por fase, nada
      rebaseado; os SHAs originais continuam ancestrais). A auditoria final comparou cada
      merge com o auto-merge do git e não achou hunk descartado.
- [ ] Depois do merge, **descartar** o worktree `wt-e2e` (branch `integracao/e2e-token-aj`
      nunca foi commitada/pushada em lugar nenhum — é só um rascunho de integração local)
      e as worktrees `wt-int`/`wt-fix` desta sessão (`git worktree remove`).
- [x] Piso de cobertura MVP verificado com número real: 712 → 746 (bloco "O que a sessão
      de 23/08 fez"). A citação antiga "715→743" não era verificada.

---

## 2 — Bug real, corrigido no PR #195: drag de NPC para a cena não funcionava (TK042a)

**O diagnóstico original desta seção estava errado** — e foi refutado em browser real antes
de qualquer código mudar. Ficou registrado aqui de propósito, porque a forma do erro
(diagnóstico por leitura, sem reproduzir) é a mesma lição da seção 0.

**O que se acreditava:** a `<img>` do retrato em `ActorPortrait.svelte` seria o drag source
nativo e "roubaria" o payload `application/fusion-actor`. **Testado e falso**: com um
retrato `<img>` real na linha, o `dragstart` sai do `IMG`, mas borbulha até a `<li>`, que
grava o MIME no mesmo `DataTransfer` — o token nasce normalmente. `ActorPortrait.svelte`
não precisava de nada e não foi tocado.

**Causa real (console do gesto nativo no Chromium, antes do fix):**

```
dragstart/bolha: target=LI.npcs-row types=[application/fusion-actor] effectAllowed=move
dragover/bolha:  target=CANVAS      types=[application/fusion-actor] dropEffect=copy defaultPrevented=true
dragend:         dropEffect=none            <- `drop` NUNCA disparou
```

É a **negociação de operação do HTML5 drag-and-drop**: `NpcsPanel.svelte` declarava
`effectAllowed = "move"` (por causa do arraste para pastas) e `TableScreen.svelte` pedia
`dropEffect = "copy"`. `copy` fora da máscara `move` → operação `none` → o browser recusa o
`drop` mesmo com `preventDefault()` no `dragover`. Nenhum teste olhava esse par.

**Correção (PR #195, branch `fix/npc-drag-portrait`, base `alfa/app`, CI verde):**

- [x] `packages/client/src/lib/canvas/dragEffects.ts` (novo): constantes da operação e a
      regra do browser (`allowsDropEffect`), no mesmo padrão de `canvasDragTypes.ts`.
- [x] `NpcsPanel.svelte` passa a declarar `effectAllowed = "copyMove"`; `TableScreen.svelte`
      usa a constante compartilhada.
- [x] Teste versionado `dragEffects.test.ts`: tabela da regra (inclui `move`×`copy`) **e** o
      contrato — extrai do fonte dos dois componentes o valor que cada um atribui de fato e
      julga o par pela regra. Vermelho antes do fix, verde depois. `npcDragToCanvas.test.ts`
      não foi editado (as fases mexem nele).
- [x] Prova em browser real: roteiro `roteiros/npc-drag-canvas.spec.ts` da skill local
      `tutorial-e2e` (Playwright, gesto nativo `dragTo`, contagem de tokens no `world.db`:
      0→1). Prints em `.e2e-visual/npc-drag-canvas/` (gitignored).
- [ ] Não verificado: Firefox/Safari; drops de Contatos e Compêndio (já declaravam `copy`,
      compatíveis — mas não foram testados em browser).

**Lição para o checklist de review**: teste de drag-and-drop que não dispara o gesto no
browser não prova o drop — `dataTransfer.types` certo e `preventDefault()` no `dragover`
não bastam se `effectAllowed`/`dropEffect` não batem. A skill `tutorial-e2e` agora tem o
roteiro que prova isso; `lib/captura.ts` honra `FUSION_E2E_REPO_ROOT` para rodar contra
uma worktree (ver `referencias/erros-conhecidos.md` da skill).

---

## 3 — "Token criado não aparece sem F5": NÃO reproduziu em browser real (2 tentativas)

Registrado como "Achado #1" em `.fusion-review/estado-sessao-2026-08-22.md`. Em 23/08 foi
tentado reproduzir de verdade, com Playwright (Chromium), duas vezes:

- Em `alfa/app` puro (PR #195, roteiro `npc-drag-canvas`): a peça criada por arraste aparece
  imediatamente no canvas do Mestre e a lista de NPCs atualiza "1 presença em cena" sem
  reload.
- No estado integrado (PR #196, roteiro `roteiros/token-sem-f5.spec.ts`): peça criada pelo
  diálogo `.scene-head__addToken`, foto do `.canvas-host` byte a byte antes/depois, sem
  reload — **mudou (a peça apareceu)** para o Mestre **e** para o jogador na cena no ar; 0
  erros de console. Prints em `.e2e-visual/token-sem-f5/`.

Os quatro candidatos levantados pela análise de integração (filtro de visão `_fogActive`
escondendo sprites até o `setVisionPolygons` do reload; cena fora do ar descartada na
redação para socket não privilegiado; gap de `seq` no `DocumentMirror`; `_isGm` congelado)
não se sustentaram na reprodução. **Nenhuma correção foi inventada.**

- [ ] Se voltar a acontecer no e2e manual: anotar papel (Mestre/jogador), se a cena estava
      **no ar ou só preparada**, e rodar no console `canvas.getLayer("tokens").children.length`
      — se for > 0 com a tela vazia, é filtro de visibilidade (candidato C1), não a cadeia
      do mirror. Os roteiros Playwright acima são o ponto de partida para reproduzir.
- [x] Retestado depois do merge local da seção 1 — não reproduziu.

---

## 4 — Corrigir a expectativa, não o produto: TK050 (Ctrl+arraste)

**Não é bug.** A tecla `D` (idêntico) / `Shift+D` (cru) é o mecanismo real, GM-only,
implementado em `TokenInteractionManager.ts` (`_handleKeyDown`, commit `46707e1`,
Fase 8/#192) — **sem** gesto de arraste, de propósito: `specs/41-token.md` (tabela de
emendas, DEC-TOK-14) rebaixa `REQ-CNV-041` de "Ctrl+drag" para "dois modos, sem exigir
arraste", justamente para satisfazer REQ-A11-036 (acessibilidade — nem todo mundo consegue
fazer um gesto de arraste com modificadora). Ctrl+arraste era um requisito **antigo** (spec
06, tag `[V2]`) e a spec 41 o superou deliberadamente.

- [x] Conferido: o passo de TK050 em `.fusion-review/roteiro-token.html` já é neutro sobre
      o mecanismo ("duplique uma peça", sem citar Ctrl+arraste) — a expectativa veio da
      tentativa do próprio testador (provável hábito de outro VTT), não do texto do
      roteiro. Nada a editar ali.
- [ ] Nenhuma ação de produto necessária

---

## 5 — Não é bug, é descoberta de UI: TK042(b) visibilidade "entrevisto"

O mecanismo de promover conhecimento de NPC (`Hidden→Glimpsed→Known`) existe e está
corretamente autorizado (server-side, `isRolePrivileged`) — só não vive na própria linha
do NPC. É a janela separada "Quem conhece quem" (rodapé da aba NPCs → `KnowledgeGridWindow`),
onde cada célula (contato × personagem) cicla o estado. Por design (`npcKnowledge.ts:1-27`),
a linha do NPC é só-leitura — nenhum controle de conhecimento fica nela.

- [ ] **Decisão do Alexandre**: aceitar como está (a janela separada é intencional), ou
      pedir um atalho na própria linha do NPC que abra a grade já filtrada naquele
      contato? Não é bug — é chamada de produto, não código a mexer sem essa resposta.

---

## 6 — Fora de escopo por decisão: TK062 (colisão com paredes)

Confirmado: não há UI de autoria de parede em `ScenesTab.svelte`, e a spec 41 já havia
decidido (Q-TOK-04, D24/D25 em `decisoes.md`) que visão/névoa/colisão saem do produto por
ora — os campos ficam **inertes**, não removidos (Fase 9, #193). O próprio roteiro já
registrava isso corretamente ("Isso será no e2e de paredes, quando elas existirem").

- [ ] Nenhuma ação — aguardar a feature de paredes (fora do escopo da spec 41) antes de
      cobrar este item de novo

---

## 7 — Decisões pendentes do Alexandre (nada disto é código a mexer sem resposta)

| #   | Tema                                                                               | O que está em jogo                                                                                                                                                                                                                                                                                                                                                                                                                   | Origem                      |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| D1  | **Herança de disposição invisível para jogadores** (REQ-TOK-080/081 × REQ-NPC-082) | TK042 (#187) herda a disposição de `flags.fusion.attitude` do ator — mas `redaction.ts` redige esse campo para todo socket não privilegiado, então o jogador vê todo token sem disposição explícita como **neutro**. Opções: (a) servidor expõe a disposição já resolvida (−1/0/1) como campo não privilegiado (reabre Q-NPC-07); (b) documentar a herança como Mestre-only e emendar REQ-TOK-080/081. Corpo do PR #187 já descreve. | F187-1, 3 lentes "real"     |
| D2  | **Limites da cena no movimento** (metade de REQ-TOK-042)                           | Nenhum caminho de escrita (`token:move` nem `doc:update` embutido) valida x/y contra `scene.width/height`. O comentário falso foi removido (#189). Falta decidir o que é "limite" no espaço com padding (área do mapa ou o canvas inteiro) e se é recusa ou clamp — ou emendar REQ-TOK-042 dizendo que o MVP não valida.                                                                                                             | F189-1                      |
| D3  | **TK081 (numeração de peças do mesmo ator)** cortada da Fase 7                     | Corte documentado no corpo do #191 com justificativa técnica (contador monotônico persistido na Scene), sem OK registrado.                                                                                                                                                                                                                                                                                                           | F191-3                      |
| D4  | **Fase 9: "inerte" ≠ "removido"**                                                  | O card pedia remover os campos inertes; tasks.md/D24 dizem manter `vision`/`light` declarados e inertes. O #193 seguiu a spec. Confirmar a leitura ou abrir escopo novo.                                                                                                                                                                                                                                                             | F193-1                      |
| D5  | **TK042(b) "entrevisto"** (seção 5)                                                | Aceitar a janela "Quem conhece quem" como está, ou pedir atalho na linha do NPC.                                                                                                                                                                                                                                                                                                                                                     | seção 5                     |
| D6  | **`token:preview` (REQ-NET-044) sem consumidor na tela**                           | #186 implementou emissão/recepção do fantasma de arraste, mas nenhum layer desenha `remoteTokenPreviews`; e a sala `scene:<id>` só é populada pelo `presence:cursor`. Está "implementado" sem gatilho observável — regra "toda UI precisa de gatilho". Decidir se vira tarefa agora ou dívida nomeada.                                                                                                                               | R6 da análise de integração |
| D7  | **Guarda `_loadedSceneId` (#194) congela o que não é token**                       | Com o fim do reload a cada broadcast, trocar a **arte de fundo**, `width/height` ou `padding` de uma cena no ar não repinta sem F5 (o grid foi corrigido no #196, R4). Verificar no próximo e2e manual (lápis da cena → trocar imagem) e decidir se entra como fix.                                                                                                                                                                  | R8                          |
| D8  | **Testes estruturais/tautológicos de baixa gravidade** deixados como estão         | `token-visuals.test.ts` (TK083 tautológico, TK084 grep de fonte), `system-registration.test.ts` de pf2e/sf2e (tabela contra a própria tabela), REQ-TOK-043 em `token-interaction.test.ts` (não exercita footprint). Não bloqueiam; valem uma passada quando houver folga.                                                                                                                                                            | F187-5, F189-2, F191-1/2    |

---

## Revisão dos testes futuros

**Sobre o roteiro `roteiro-token.html` em si:**

- O passo de TK050 não pede Ctrl+arraste — nada a corrigir ali (seção 4)
- O roteiro **testou o branch errado** porque ele mesmo diz "8 fases pendentes (PRs
  #186–#193), mergeadas localmente sobre `alfa/app` só para este teste" no cabeçalho —
  mas nada no fluxo de `/run` ou na skill `tutorial-e2e` verifica isso automaticamente.
  **Lição para qualquer e2e manual futuro que dependa de PRs ainda não mergeados**: seguir
  o checklist da seção 0 antes de declarar o servidor pronto para teste. Essa checagem não
  foi feita antes desta rodada, e gerou 5 dos 7 "achados" que não eram reais.

**Sobre a cobertura automatizada:**

- `npcDragToCanvas.test.ts` continua sendo grep de fonte (seção 2) — o PR #195 não o
  reescreveu (as fases mexem nele) e adicionou `dragEffects.test.ts` + o roteiro Playwright
  no lugar. É o segundo caso de teste circular encontrado neste projeto num fluxo de drag
  (o primeiro foi a classe #48 do `project_fusion.md`). Vale um passo de checklist na skill
  `tutorial-e2e`/`code-review` para flagrar teste de drag-and-drop que só faz
  `readFileSync`+`toContain` em vez de disparar o gesto — e, agora, para conferir o par
  `effectAllowed`/`dropEffect`.
- Nenhum teste automatizado cobria REQ-CNV-025..033 do bloco de token antes das 8 fases
  (confirmado pelo levantamento original de `tasks.md`, linha 47: "a cobertura da 41 começa
  literalmente em zero"). As PRs #186–193 aparentemente adicionaram testes unitários
  (`token-visuals.test.ts`, `tokenSpriteBars.test.ts`, `tokenSpriteRing.test.ts`) — path de
  verificação: depois do merge (seção 1), rodar `pnpm spec:report` e conferir o piso real.
- TK062 (paredes) e a numeração de tokens (TK081, cortada do escopo em #191 sem decisão do
  Alexandre — ver `project_leva_noturna_2026_08_17.md`) ficam como lacunas conhecidas de
  cobertura futura, não deste roteiro.

**Sequência recomendada (atualizada em 23/08):** seção 0 (checklist) → merge das PRs na
ordem da seção 1 (#186…#193, depois #196; #195 a qualquer hora) → build limpo de `alfa/app`
pós-merge (confirmar com `git merge-base --is-ancestor origin/fix/tk-integracao-pos-194 HEAD`)
→ rodar o roteiro `roteiro-token.html` de novo do zero, com atenção a TK042 completo, à
seção 7/D7 (trocar arte de fundo sem F5) e ao "token sem F5" (seção 3) → responder a seção 7.
