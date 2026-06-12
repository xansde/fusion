# 25 — Testes e Qualidade

**Status:** draft v0.1
**Data:** 2026-06-11

**Baseada em:**
- `docs/research/95-ops-backup-telemetry-testing.md` — Estratégia de testes/QA, pipelines CI, E2E, carga multiplayer
- `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — Mecânicas PF2e/SF2e para golden tests do motor de regras

---

## Objetivo

Definir a estratégia completa de testes e qualidade do Fusion VTT: pirâmide de testes (unit → integration → E2E), golden tests do motor de regras com casos verificados contra as mecânicas PF2e/SF2e, suíte de conformidade da system API, testes do importer pf2e, pipeline CI/CD com GitHub Actions, e métricas de qualidade (cobertura, performance budgets). O objetivo é garantir que o motor de regras seja correto, o servidor seja robusto e o fluxo de jogo completo funcione de ponta a ponta sem regressões.

---

## Escopo

### O que inclui

- Pirâmide de testes: unit (Vitest), integration (servidor + SQLite in-memory + protocolo WS), E2E (Playwright multi-cliente)
- Golden tests do motor PF2e: casos de regra verificados contra research (DoS, MAP, IWR, condições, Dying/Recovery, Hero Points)
- Golden tests do motor SF2e: casos específicos (gravity, weapon tiers, cover)
- Suíte de conformidade da system API (contrato que todo sistema deve passar)
- Testes do importer pf2e: amostras de JSON reais, snapshot do mapeamento, relatório de campos não mapeados
- Pipeline CI com GitHub Actions: lint, typecheck, unit, integration, E2E, cobertura
- Performance budgets: tempo de boot do servidor, FPS com cena padrão
- Regressão visual do canvas com pixelmatch [V2]
- Testes de carga multiplayer com Artillery [V2]

### O que NÃO inclui

- Testes de sistema Etmos (aguardando spec 19 completa e material-fonte fechado; ver questões em aberto)
- Cobertura de componentes Svelte do cliente além de smoke E2E (UI visual testada por regressão [V2])
- Testes de performance de rendering Pixi.js além do budget de FPS
- Integração com plataformas de testes externos (Sauce Labs, BrowserStack)
- Automação de testes de acessibilidade (coberta em spec 23)

---

## Conceitos e Terminologia

| Termo | Definição |
|---|---|
| **Golden test** | Teste cujo output esperado é fixado como fixture verificada contra uma fonte de verdade (ex.: as mecânicas PF2e do research doc). Falha se o motor produzir resultado diferente do esperado. |
| **Suíte de conformidade** | Conjunto de testes que todo pacote `systems/*` deve passar para ser considerado um sistema válido na system API. Análogo a um contrato de interface verificado em runtime. |
| **Test mode** | Modo especial do servidor ativado por flag `--test-mode`; usa banco SQLite in-memory, pré-popula fixtures, desabilita autenticação de licença e expõe `window.__fusion_test_api__` no cliente. |
| **`__fusion_test_api__`** | Objeto global exposto no `window` do cliente em modo de teste; permite que o Playwright acesse estado interno do canvas de forma serializável sem depender de screenshots como asserção primária. |
| **Pirâmide de testes** | Estratégia de distribuição: muitos unit tests (base), menos integration tests, poucos E2E tests (topo). Reflete custo de execução e grau de isolamento. |
| **pixelmatch** | Biblioteca de comparação pixel-a-pixel embutida no Playwright (`toHaveScreenshot()`). Usada para regressão visual do canvas WebGL. |
| **Artillery** | Ferramenta de load testing com suporte nativo a Socket.IO v4 (via `artillery-engine-socketio-v3`). Usada para testes de carga multiplayer. |
| **Snapshot de mapeamento** | Saída serializada do importer pf2e para um documento específico, fixada como arquivo de referência. Qualquer alteração no mapeamento produz diff visível no CI. |
| **Relatório de campos não mapeados** | Arquivo gerado pelo importer listando campos presentes no JSON-fonte pf2e que não foram mapeados para o modelo interno. Permite rastrear cobertura da importação ao longo do tempo. |
| **Performance budget** | Limite máximo aceitável para uma métrica de performance (ex.: boot do servidor < 3 s, FPS no canvas com cena padrão > 55 fps). Violações bloqueiam merge no CI. |

---

## Decisões

### D1: Vitest como framework de testes unitários e de integração

**Escolhido:** Vitest

**Alternativas rejeitadas:**
- Jest: requer configuração extra para ESM nativo; mais lento em projetos ESM/TypeScript puro.

**Racional:** Vitest é 100% compatível com a API Jest (mesmos matchers, mocks, `describe`/`it`/`expect`), tem suporte nativo a ESM sem transpilação, integra com Vite (já em uso no cliente) e é 2–5× mais rápido em projetos TypeScript. O repositório pf2e usa Jest; a migração para Vitest é trivial e o ganho de velocidade justifica. Referência: research doc 95, seção 3.2.4.

---

### D2: Playwright como framework E2E

**Escolhido:** Playwright

**Alternativas rejeitadas:**
- Cypress: mais fraco em testes headless com canvas; sem suporte nativo a múltiplas abas (necessário para simular GM + múltiplos jogadores em paralelo); não suporta testes de canvas WebGL de forma madura.

**Racional:** Playwright suporta múltiplos contextos de browser em um único teste (necessário para simular GM + N jogadores), tem `page.evaluate()` para acesso a `window.__fusion_test_api__`, e o `toHaveScreenshot()` com pixelmatch é suficiente para regressão visual sem infra externa. Referência: research doc 95, seção 3.4.

---

### D3: Artillery para testes de carga multiplayer

**Escolhido:** Artillery com `artillery-engine-socketio-v3`

**Alternativas rejeitadas:**
- k6: não suporta o handshake do protocolo Socket.IO nativamente; wrappers disponíveis são incompletos para Socket.IO v4.
- JMeter: excesso de complexidade de configuração; pouca integração com CI GitHub Actions.

**Racional:** O servidor usa Socket.IO v4. Artillery tem engine oficial para Socket.IO que cobre o handshake completo do protocolo. Testes de carga rodam agendados no CI (não em todo PR) para não atrasar feedback. A instalação correta exige `artillery-engine-socketio-v3` (não o engine padrão, que inclui cliente v2). Referência: research doc 95, seções 3.6.2 e 3.6.3.

---

### D4: Golden tests do motor de regras usam fixtures verificadas contra research doc 13

**Escolhido:** Fixtures TypeScript imutáveis checadas no repositório

**Alternativas rejeitadas:**
- Testes property-based (fast-check): úteis como complemento, mas não substituem a verificação de casos canônicos específicos do PF2e.
- Apenas testes ad hoc sem fonte de verdade citada: não auditáveis.

**Racional:** As mecânicas PF2e têm comportamento canônico definido (Archives of Nethys, ORC). Cada fixture de golden test inclui comentário com a fonte de onde a regra foi extraída. Isso garante rastreabilidade: se uma regra mudar no remaster, o comentário aponta para onde atualizar. O research doc 13 é a fonte de verdade interna do projeto.

---

### D5: Regressão visual do canvas é [V2]

**Escolhido:** Adiar para [V2]

**Racional:** Regressão visual via pixelmatch é frágil entre GPUs e sistemas operacionais diferentes. No MVP, o CI roda em um runner GitHub Actions com GPU emulada; os resultados de rendering WebGL não são determinísticos entre máquinas. Estabilizar o ambiente de CI com GPU específica é trabalho de [V2]. A validação no MVP é feita via `__fusion_test_api__` (estado interno) e não screenshots. Referência: research doc 95, seção 3.5.2.

---

### D6: `window.__fusion_test_api__` protegido por tree-shaking em produção

**Escolhido:** Eliminado por tree-shaking via `import.meta.env.MODE !== 'test'` com dead-code elimination do Vite

**Alternativas rejeitadas:**
- Flag de runtime: cria superficie de ataque se acidentalmente habilitado em produção.
- Sem proteção: vaza detalhes de implementação interna.

**Racional:** Vite elimina código morto em blocos `if (import.meta.env.MODE !== 'test')` no build de produção. O objeto de test API nunca chega ao bundle do usuário final. Em test mode, o servidor injeta `VITE_MODE=test` na build do cliente.

---

### D7: Suíte de conformidade da system API é executada no CI junto com testes de integração

**Escolhido:** Parte do workflow `ci.yml` (não em workflow separado)

**Racional:** A conformidade de sistema é verificada em tempo de compilação (TypeScript) + em tempo de execução (Vitest integration). Isolar em workflow separado aumentaria o tempo total de CI sem benefício. Os sistemas `pf2e`, `sf2e` e `etmos` são pacotes do monorepo e seus testes fazem parte do workspace.

---

### D8: Cobertura mínima de 80% aplica-se a `packages/shared` e à camada de regras dos sistemas

**Escolhido:** 80% de cobertura de statements para `packages/shared/**` e `systems/*/src/rules/**`

**Alternativas rejeitadas:**
- 80% global (incluindo UI): impossível de atingir de forma significativa sem testes de componente Svelte completos, que são lentos e frágeis.
- 100% para regras: excessivo; torna refactoring doloroso.

**Racional:** A lógica crítica está em `packages/shared` (schema/tipos/protocolo) e nas camadas de regras dos sistemas. UI Svelte é coberta por smoke E2E. O limiar de 80% é consistente com o que o projeto pf2e usa internamente (referência: research doc 95, seção 3.7.2).

---

## Requisitos Funcionais

### RF — Pirâmide de Testes

**REQ-TST-001** [MVP] O monorepo DEVE ter um diretório `packages/shared/src/__tests__/` com testes Vitest cobrindo todos os schemas Zod, funções utilitárias e tipos de protocolo exportados pelo pacote `shared`.

**REQ-TST-002** [MVP] O pacote `packages/server` DEVE ter testes de integração Vitest em `packages/server/src/__tests__/` cobrindo CRUD de todos os tipos de documento (Actor, Item, Scene, JournalEntry, RollTable, Playlist, Combat) contra um banco SQLite in-memory.

**REQ-TST-003** [MVP] Os testes de integração do servidor DEVEM verificar que atualizações de documento emitem o evento Socket.IO correto (`document:update`) para todos os clientes conectados no mesmo mundo, usando um cliente Socket.IO em processo (sem rede real).

**REQ-TST-004** [MVP] Os testes de integração do servidor DEVEM verificar que operações sem permissão suficiente retornam o código de erro `PERMISSION_DENIED` (conforme spec 05-usuarios-e-permissoes.md).

**REQ-TST-005** [MVP] O servidor DEVE suportar a flag de linha de comando `--test-mode` que: (a) inicializa banco SQLite in-memory, (b) pré-popula dados de fixture definidos em `tests/fixtures/world-seed.ts`, (c) desabilita verificação de licença, (d) expõe `window.__fusion_test_api__` no build do cliente via variável `VITE_MODE=test`.

**REQ-TST-006** [MVP] O objeto `window.__fusion_test_api__` exposto em modo de teste DEVE implementar a seguinte interface mínima:

```typescript
interface FusionTestAPI {
  /** Retorna o estado serializado de todos os tokens visíveis no canvas ativo */
  getCanvasState(): Promise<SerializedCanvasState>;
  /** Move um token para coordenadas de grid especificadas sem animação */
  teleportToken(tokenId: string, gridX: number, gridY: number): Promise<void>;
  /** Injeta um resultado de rolagem para a próxima roll do dado especificado (mock RNG) */
  injectDiceResult(dieType: number, result: number): void;
  /** Retorna o chat log completo da sessão */
  getChatMessages(): Promise<ChatMessage[]>;
  /** Força um tick do combat tracker (avança para o próximo turno) */
  advanceCombatTurn(): Promise<void>;
}
```

**REQ-TST-007** [MVP] Os testes E2E Playwright DEVEM usar `data-testid` attributes como seletores primários para todos os elementos da UI HTML que envolvem o canvas (painéis laterais, HUD de token, barra de HP, chat, combat tracker). Seletores por classe CSS ou texto localizado são proibidos nos testes.

**REQ-TST-008** [MVP] O suite E2E DEVE incluir um teste de fluxo completo de sessão de jogo com GM + 2 jogadores simulados em paralelo via contextos Playwright separados, cobrindo: (a) GM cria cena e posiciona tokens, (b) jogador move token, (c) GM inicia combate, (d) jogador rola ataque com resultado visível no chat de todos os clientes.

**REQ-TST-009** [MVP] O código do `window.__fusion_test_api__` DEVE ser eliminado no build de produção via tree-shaking (guarda `if (import.meta.env.MODE !== 'test')`), verificado por teste no CI que inspeciona o bundle de produção.

---

### RF — Golden Tests do Motor PF2e

**REQ-TST-010** [MVP] O pacote `systems/pf2e` DEVE ter um arquivo de testes `src/rules/__tests__/degree-of-success.test.ts` com golden tests para todos os casos canônicos de grau de sucesso, incluindo:

| Caso | Fonte no research doc 13 |
|---|---|
| Critical Success (resultado ≥ DC + 10) | Seção 2.1 |
| Success (resultado ≥ DC, < DC + 10) | Seção 2.1 |
| Failure (resultado < DC, ≥ DC − 10) | Seção 2.1 |
| Critical Failure (resultado < DC − 10) | Seção 2.1 |
| Natural 20 eleva um grau (incluindo Failure → Success) | Seção 2.2 |
| Natural 1 rebaixa um grau (incluindo Success → Failure) | Seção 2.2 |
| Natural 20 em Critical Failure → Failure (não Critical Success) | Seção 2.2 |
| Natural 1 em Critical Success → Success (não Critical Failure) | Seção 2.2 |
| Basic saving throw Critical Success → 0 dano | Seção 2.3 |
| Basic saving throw Success → metade do dano | Seção 2.3 |
| Basic saving throw Failure → dano completo | Seção 2.3 |
| Basic saving throw Critical Failure → dano dobrado | Seção 2.3 |

**REQ-TST-011** [MVP] O pacote `systems/pf2e` DEVE ter um arquivo `src/rules/__tests__/modifier-stacking.test.ts` com golden tests para a política de acumulação de modificadores, incluindo:

| Caso | Fonte no research doc 13 |
|---|---|
| Dois bônus de item: apenas o maior se aplica | Seção 3.2 |
| Bônus de item + bônus de status: ambos somam | Seção 3.2 |
| Bônus de circumstance + status + item: todos somam | Seção 3.2 |
| Penalidades de mesmo tipo: cumulativas | Seção 3.2 |
| Penalidades de tipos diferentes: cumulativas | Seção 3.2 |
| Predicado condicional falso: modificador não aplicado | Seção 16.1 (Rule Elements) |
| Frightened X: penalidade de status −X em todas as jogadas | Seção 7.4 |
| Sickened X: penalidade de status −X em todas as jogadas | Seção 7.4 |

**REQ-TST-012** [MVP] O pacote `systems/pf2e` DEVE ter um arquivo `src/rules/__tests__/map.test.ts` com golden tests para Multiple Attack Penalty:

| Caso | Fonte no research doc 13 |
|---|---|
| 1º ataque: MAP = 0 | Seção 1.4 |
| 2º ataque (arma padrão): MAP = −5 | Seção 1.4 |
| 3º ataque (arma padrão): MAP = −10 | Seção 1.4 |
| 2º ataque (arma Agile): MAP = −4 | Seção 1.4 e 6.3 |
| 3º ataque (arma Agile): MAP = −8 | Seção 1.4 e 6.3 |
| MAP reseta no início do turno do personagem | Seção 1.4 |

**REQ-TST-013** [MVP] O pacote `systems/pf2e` DEVE ter um arquivo `src/rules/__tests__/iwr.test.ts` com golden tests para Immunities, Weaknesses e Resistances:

| Caso | Fonte no research doc 13 |
|---|---|
| Imunidade: dano reduzido a 0 independentemente do valor | Seção 6.4 |
| Fraqueza: adiciona X ao dano total (após multiplicação de crit) | Seção 6.4 |
| Resistência: reduz dano em X, mínimo 0 | Seção 6.4 |
| Ordem de aplicação: Imunidade → Fraqueza → Resistência | Seção 6.4 |
| Fraqueza em critical hit: aplicada sobre dano já dobrado | Seção 6.4 |
| Resistência não pode reduzir dano abaixo de 0 | Seção 6.4 |

**REQ-TST-014** [MVP] O pacote `systems/pf2e` DEVE ter um arquivo `src/rules/__tests__/conditions.test.ts` com golden tests para condições numéricas e seu comportamento de tick:

| Caso | Fonte no research doc 13 |
|---|---|
| Frightened X decrementa em 1 no fim de cada turno | Seção 7.4 |
| Frightened 0 é removido automaticamente | Seção 7.4 |
| Clumsy X aplica −X em jogadas/DCs de DEX | Seção 7.1 |
| Enfeebled X aplica −X em jogadas/DCs de STR | Seção 7.1 |
| Stupefied X aplica −X em jogadas/DCs de INT/WIS/CHA | Seção 7.1 |
| Stunned X: consome X ações no início do turno | Seção 7.3 |
| Slowed X: reduz ações recuperadas por X | Seção 7.3 |
| Off-Guard: −2 de circumstance na AC | Seção 7.5 |
| Prone: −2 em ataques e Off-Guard | Seção 7.3 |

**REQ-TST-015** [MVP] O pacote `systems/pf2e` DEVE ter um arquivo `src/rules/__tests__/dying-recovery.test.ts` com golden tests para o ciclo Dying/Recovery/Wounded:

| Caso | Fonte no research doc 13 |
|---|---|
| 0 HP → Dying 1 (causa normal) | Seção 8.1 |
| 0 HP por crit → Dying 2 | Seção 8.1 |
| Recovery check Critical Success: Dying −2 | Seção 8.2 |
| Recovery check Success: Dying −1 | Seção 8.2 |
| Recovery check Failure: Dying +1 | Seção 8.2 |
| Recovery check Critical Failure: Dying +2 | Seção 8.2 |
| Dying 4 → morte | Seção 8.2 |
| Sair de Dying → ganha Wounded 1 (ou incrementa) | Seção 8.3 |
| Wounded X: ao ganhar Dying, Dying inicial = 1 + X | Seção 8.3 |
| Doomed X: Dying máximo antes da morte = 4 − X | Seção 8.3 |
| Hero Point: gasto de todos → Heroic Recovery (perde Dying) | Seção 8.4 |
| HP negativos ≥ max HP → morte imediata (sem Dying) | Seção 8.1 |

**REQ-TST-016** [MVP] O pacote `systems/pf2e` DEVE ter um arquivo `src/rules/__tests__/persistent-damage.test.ts` com golden tests para dano persistente:

| Caso | Fonte no research doc 13 |
|---|---|
| Dano persistente aplicado no fim do turno | Seção 6.5 |
| DC 15 flat check para encerrar | Seção 6.5 |
| Assistência reduz DC para 10 | Seção 6.5 |
| Fora de combate por ~1 minuto: encerra automaticamente | Seção 6.5 |

**REQ-TST-017** [MVP] O motor de regras em `systems/pf2e/src/rules/` DEVE ser uma biblioteca TypeScript pura sem dependências de browser, socket ou banco de dados, verificado por lint rule (`no-restricted-imports`) que proíbe imports de `socket.io`, `better-sqlite3` e APIs de DOM.

---

### RF — Golden Tests do Motor SF2e

**REQ-TST-018** [V2] O pacote `systems/sf2e` DEVE ter golden tests para os casos mecânicos exclusivos do SF2e:

| Caso | Fonte no research doc 13 |
|---|---|
| Zero Gravity: Clumsy 1 + Off-Guard + Untethered | Seção 15.5 |
| Weapon tier upgrade: bônus ao ataque conforme tier | Seção 15.3 |
| Cover: Lesser (+1 AC), Standard (+2 AC/Reflex/Stealth), Greater (+4) | Seção 15.6 |
| MAP com arma Unwieldy: apenas 1 ataque por turno | Seção 15.3 |
| Condição Untethered: exclusiva SF2e | Seção 15.5 |

---

### RF — Suíte de Conformidade da System API

**REQ-TST-019** [MVP] DEVE existir um arquivo `packages/system-api/src/__tests__/conformance.suite.ts` que exporta uma função `runConformanceSuite(system: SystemPackage): void` executando os seguintes testes de contrato:

```typescript
// Contrato mínimo verificado pela suíte
interface ConformanceContract {
  // Sistema exporta metadados obrigatórios
  id: string;            // ex.: "pf2e", "sf2e", "etmos"
  version: string;       // semver
  label: string;         // nome legível em pt-BR
  // Sistema registra tipos de entidade
  actorTypes: string[];  // ao menos ["character", "npc"]
  itemTypes: string[];   // ao menos ["weapon", "armor", "feat"]
  // Sistema responde ao ciclo de vida
  onActorPrepare(actor: BaseActor): PreparedActor;
  onRollCheck(context: CheckContext): RollResult;
  onApplyDamage(target: BaseActor, damage: DamageInstance): AppliedDamageResult;
}
```

**REQ-TST-020** [MVP] A suíte de conformidade DEVE incluir os seguintes testes de contrato executáveis para qualquer sistema:

| Teste de contrato | Critério |
|---|---|
| Metadados presentes | `id`, `version`, `label` são strings não-vazias |
| Actor types registrados | `actorTypes` inclui `"character"` e `"npc"` |
| Item types registrados | `itemTypes` inclui ao menos 3 tipos |
| `onActorPrepare` é função | Retorna objeto com campo `system` não-nulo |
| `onRollCheck` é função | Retorna `RollResult` com `total`, `degreeOfSuccess`, `dice` |
| `onApplyDamage` é função | Retorna `AppliedDamageResult` com `finalDamage >= 0` |
| Sistema não lança em `onActorPrepare` com actor vazio | Trata input mínimo sem crash |
| Sistema não lança em `onRollCheck` com contexto mínimo | Trata input mínimo sem crash |

**REQ-TST-021** [MVP] Os pacotes `systems/pf2e` e `systems/sf2e` DEVEM cada um importar e executar `runConformanceSuite(system)` em seu próprio arquivo de testes `src/__tests__/conformance.test.ts`. A suíte de conformidade DEVE passar para que o CI aprove esses sistemas. O pacote `systems/etmos` DEVE ter o arquivo de testes criado, mas o job de conformidade correspondente DEVE ser marcado com `skipIf: process.env.ETMOS_SPEC_CLOSED !== 'true'` (flag não ativada por padrão no CI até que a spec 19 seja fechada).

---

### RF — Testes do Importer pf2e

**REQ-TST-022** [MVP] O pacote `tools/importer-pf2e` DEVE ter um diretório `src/__tests__/` com testes de snapshot para o mapeamento de documentos pf2e → modelo interno Fusion, cobrindo ao menos:

| Tipo de documento | Arquivo de fixture de entrada |
|---|---|
| Criatura (NPC) — 1 exemplo simples | `tests/fixtures/pf2e/npc-goblin.json` |
| Arma — 1 exemplo com runas | `tests/fixtures/pf2e/weapon-longsword-striking.json` |
| Magia — 1 cantrip e 1 rank 3 | `tests/fixtures/pf2e/spell-produce-flame.json`, `tests/fixtures/pf2e/spell-fireball.json` |
| Feat — 1 com rule elements | `tests/fixtures/pf2e/feat-power-attack.json` |
| Ancestralidade — 1 exemplo | `tests/fixtures/pf2e/ancestry-human.json` |

**REQ-TST-023** [MVP] Para cada tipo de documento listado em REQ-TST-022, DEVE existir um arquivo de snapshot de saída em `tests/fixtures/pf2e/__snapshots__/` que captura o resultado completo do mapeamento. O teste falha se o mapeamento produzir output diferente do snapshot sem atualização explícita via `--update-snapshots`.

**REQ-TST-024** [MVP] O importer DEVE gerar um relatório de campos não mapeados (`unmapped-fields-report.json`) ao processar qualquer documento, listando cada campo presente no JSON-fonte que não foi tratado pelo conversor. Este relatório DEVE ser emitido como artefato no CI para monitoramento de cobertura da importação.

**REQ-TST-025** [MVP] O importer DEVE ter testes de integridade que verificam que o output para as fixtures obrigatórias é um documento válido segundo o schema Zod de `packages/shared` (sem erros de validação).

---

### RF — Pipeline CI/CD (GitHub Actions)

**REQ-TST-026** [MVP] DEVE existir o arquivo `.github/workflows/ci.yml` que executa nos eventos `push` e `pull_request` para qualquer branch, realizando em sequência:

1. Checkout e setup do Node.js 22 + pnpm
2. `pnpm install --frozen-lockfile`
3. `pnpm -r typecheck` (typecheck de todos os workspaces)
4. `pnpm -r lint` (ESLint + Prettier check)
5. `pnpm -r test:unit` (Vitest unit — timeout máximo: 60 s)
6. `pnpm -r test:integration` (Vitest integration — timeout máximo: 3 min)
7. Verificação de cobertura: falha se `packages/shared` ou `systems/*/src/rules/` ficarem abaixo de 80% de statements

**REQ-TST-027** [MVP] DEVE existir o arquivo `.github/workflows/e2e.yml` que executa apenas em `push` para a branch `main` ou `staging`, realizando:

1. Build de produção do servidor e do cliente (`pnpm build`)
2. `npx playwright install --with-deps chromium`
3. Subida do servidor em modo de teste: `node dist/server/main.js --test-mode &`
4. `pnpm -r test:e2e` (Playwright)
5. Upload do HTML report do Playwright como artefato GitHub Actions
6. Em falha: upload de screenshots e videos como artefatos

**REQ-TST-028** [MVP] DEVE existir o arquivo `.github/workflows/load-test.yml` configurado como scheduled (cron `0 3 * * 1` — segunda-feira às 3h UTC), NÃO executado em PRs, realizando:

1. Build do servidor
2. Subida do servidor em modo de teste
3. Execução dos cenários Artillery (smoke, estresse, escrita simultânea, desconexão)
4. Upload do relatório Artillery como artefato
5. Falha do workflow se qualquer métrica violar os limites definidos em REQ-TST-047

**REQ-TST-029** [MVP] O `ci.yml` DEVE executar em tempo total inferior a 5 minutos em pull requests normais (unit + typecheck + lint). Testes de integração são paralelos aos unit tests usando jobs separados para não bloquear feedback rápido.

**REQ-TST-030** [MVP] Todos os workflows DEVEM usar estratégia de cache do pnpm store para não baixar dependências em cada run. O cache key DEVE incluir o hash do `pnpm-lock.yaml`.

**REQ-TST-031** [MVP] O repositório DEVE ter configuração de conventional commits verificada em PRs via `commitlint` no CI (usando `@commitlint/config-conventional`). PRs com commits que não seguem o padrão falham no CI.

---

### RF — Métricas de Cobertura

**REQ-TST-032** [MVP] A cobertura de testes DEVE ser medida com a opção `coverage` do Vitest, usando o provider `v8` (zero configuração em Node.js 22+, sem necessidade de Istanbul).

**REQ-TST-033** [MVP] Os seguintes limites de cobertura DEVEM ser configurados no `vitest.config.ts` como thresholds que falham o CI se violados:

| Pacote / Caminho | Cobertura mínima (statements) |
|---|---|
| `packages/shared/src/**` | 80% |
| `systems/pf2e/src/rules/**` | 80% |
| `systems/sf2e/src/rules/**` | 80% |
| `systems/etmos/src/rules/**` | 0% até spec 19 fechar (pacote excluído do gate via `exclude` no vitest.config enquanto `ETMOS_SPEC_CLOSED !== 'true'`) |
| `packages/server/src/**` (exceto `main.ts`) | 60% |

**REQ-TST-034** [MVP] O relatório de cobertura HTML DEVE ser gerado em `coverage/` e publicado como artefato do GitHub Actions no workflow `ci.yml`. O relatório DEVE incluir visualização por arquivo e por linha.

---

### RF — Performance Budgets

**REQ-TST-035** [MVP] DEVE existir um teste de performance de boot do servidor em `packages/server/src/__tests__/boot.perf.test.ts` que:
- Inicia o servidor em modo de teste
- Mede o tempo até o evento `ready` (socket.io pronto para aceitar conexões)
- Falha se o tempo ultrapassar **3 000 ms** em hardware de CI (GitHub Actions runner padrão)

**REQ-TST-036** [MVP] DEVE existir um teste de performance de carregamento de mundo em `packages/server/src/__tests__/world-load.perf.test.ts` que:
- Abre um arquivo `world.db` de fixture com 500 documentos (50 actors, 200 items, 10 scenes, 240 outros)
- Mede o tempo até o servidor estar pronto para receber conexões com esse mundo carregado
- Falha se o tempo ultrapassar **5 000 ms**

**REQ-TST-037** [V2] DEVE existir um teste de performance de FPS do canvas que:
- Abre uma cena com 20 tokens, grid square, 5 fontes de luz e fog of war ativo
- Mede o FPS médio por 10 segundos via `window.__fusion_test_api__.getCanvasState()`
- Falha se o FPS médio for inferior a **55 fps** em headless Chrome no CI

**REQ-TST-038** [MVP] O CLI do servidor DEVE exibir no log de nível `info` (Pino), ao iniciar, o tempo de boot em ms e o número de documentos carregados do mundo ativo.

---

### RF — Testes de Carga Multiplayer

**REQ-TST-039** [V2] DEVE existir o arquivo `tests/load/smoke.yml` (Artillery) definindo o cenário baseline: 1 GM + 5 jogadores durante 5 minutos, com movimentação de token a cada 10 segundos.

**REQ-TST-040** [V2] DEVE existir o arquivo `tests/load/stress.yml` (Artillery) definindo o cenário de estresse: rampa de 1 a 30 clientes em 2 minutos, mantendo por 5 minutos, com updates de documento a cada 5 segundos.

**REQ-TST-041** [V2] DEVE existir o arquivo `tests/load/concurrent-writes.yml` (Artillery) definindo o cenário de escrita simultânea: 8 clientes enviando updates de documento simultaneamente por 3 minutos.

**REQ-TST-042** [V2] DEVE existir o arquivo `tests/load/reconnect.yml` (Artillery) definindo o cenário de desconexão: 30% dos clientes desconectam e reconectam a cada 30 segundos por 5 minutos.

---

### RF — Regressão Visual do Canvas

**REQ-TST-043** [V2] Os testes de regressão visual DEVEM usar `expect(page).toHaveScreenshot()` do Playwright com as seguintes cenas de baseline:

| Cena | Arquivo de snapshot |
|---|---|
| Tile de fundo + grid square + 3 tokens em posições fixas | `canvas-tokens-square-grid.png` |
| Fog of war: área revelada vs. não revelada | `canvas-fog-of-war.png` |
| Token HUD: barra de HP, condições visuais, nome | `canvas-token-hud.png` |
| Iluminação: 2 fontes de luz com raio e cor configurados | `canvas-lighting.png` |
| Template de medição: cone 60°, 30 pés | `canvas-measurement-cone.png` |

**REQ-TST-044** [V2] O contexto WebGL/Pixi.js DEVE ser inicializado com `preserveDrawingBuffer: true` em modo de teste para permitir captura de screenshots do canvas via `page.screenshot()`.

**REQ-TST-045** [V2] Os snapshots de regressão visual DEVEM ser armazenados em `tests/e2e/__snapshots__/` e nunca atualizados automaticamente no CI. A atualização DEVE ser explícita via `npx playwright test --update-snapshots` executado localmente pelo desenvolvedor.

**REQ-TST-046** [V2] Os testes de regressão visual DEVEM rodar apenas no CI (runner controlado) e não no script `test:e2e` local, usando a flag `--project=visual-regression` do Playwright.

---

### RF — Métricas de Carga

**REQ-TST-047** [V2] O workflow `load-test.yml` DEVE falhar se qualquer uma das seguintes métricas for violada:

| Métrica | Limite máximo |
|---|---|
| Socket connection time p99 | 500 ms |
| Round-trip latency p99 (cenário smoke) | 100 ms |
| Round-trip latency p99 (cenário estresse) | 200 ms |
| Throughput mínimo | 1 000 pps sem degradação |
| SQLITE_BUSY rate (cenário concurrent-writes) | < 1% |
| WAL file size após 30 min (cenário smoke) | < 50 MB |
| Node.js RSS — crescimento após warmup | < 10% |

---

## Requisitos Não-Funcionais

**REQ-TST-048** [MVP] O tempo de execução dos testes unitários (`test:unit`) DEVE ser inferior a **30 segundos** em máquina de desenvolvimento padrão (CI runner com 2 vCPUs).

**REQ-TST-049** [MVP] O tempo de execução dos testes de integração (`test:integration`) DEVE ser inferior a **3 minutos** em CI.

**REQ-TST-050** [MVP] O tempo total do workflow `e2e.yml` (incluindo build + subida do servidor + Playwright) DEVE ser inferior a **15 minutos**.

**REQ-TST-051** [MVP] Todos os testes DEVEM ser determinísticos: uma mesma revisão do código DEVE sempre produzir o mesmo resultado (pass/fail) dado o mesmo ambiente. Qualquer fonte de não-determinismo (RNG, timers) DEVE ser mockada ou controlada via seed injetável.

**REQ-TST-052** [MVP] Os testes DEVEM ser isolados: cada teste unit ou integration DEVE criar e destruir seu próprio banco in-memory e não compartilhar estado global com outros testes. O Vitest DEVE rodar cada arquivo de teste em worker isolado (`pool: 'forks'` no config de integration).

**REQ-TST-053** [MVP] O output do CI DEVE incluir informação suficiente para reproduzir falhas localmente: arquivo, linha, descrição do teste, valor esperado, valor obtido e (para falhas E2E) screenshot e stack trace.

---

## Modelo de Dados

### Interfaces de Suporte aos Testes

```typescript
// packages/system-api/src/testing.ts

/** Estado serializável do canvas para assertivas E2E */
export interface SerializedCanvasState {
  sceneId: string;
  tokens: SerializedToken[];
  lightSources: SerializedLight[];
  fogRevealed: boolean; // simplificado para smoke tests
}

export interface SerializedToken {
  id: string;
  actorId: string;
  gridX: number;
  gridY: number;
  hp: number;
  hpMax: number;
  conditions: string[]; // ids de condições ativas
}

export interface SerializedLight {
  id: string;
  gridX: number;
  gridY: number;
  radius: number;
  color: string; // hex
}

/** Resultado de uma verificação de grau de sucesso */
export interface DegreeOfSuccessResult {
  degree: 'criticalSuccess' | 'success' | 'failure' | 'criticalFailure';
  roll: number;          // total do d20 + modificadores (antes de ajuste por nat20/nat1)
  dc: number;
  naturalRoll: number;   // resultado bruto do dado (1–20)
  adjustedByNatural: boolean; // true se nat20 ou nat1 alterou o grau
}

/** Fixture para golden tests — inclui fonte de verdade */
export interface GoldenTestCase<TInput, TExpected> {
  description: string;
  source: string;         // ex.: "research/13-pf2e-sf2e-mecanicas-nucleo.md §2.2"
  input: TInput;
  expected: TExpected;
}

/** Contexto de check para a suíte de conformidade */
export interface CheckContext {
  actorId: string;
  skillOrStat: string;
  dc: number;
  modifiers: Modifier[];
  injectedDiceResult?: number; // para testes determinísticos
}

export interface Modifier {
  value: number;
  type: 'item' | 'status' | 'circumstance' | 'untyped';
  label: string;
  predicate?: Predicate;
}

export interface Predicate {
  /** Array de condições que devem ser verdadeiras para o modificador ser aplicado */
  all?: string[];
  /** Array de condições onde pelo menos uma deve ser verdadeira */
  any?: string[];
}

export interface RollResult {
  total: number;
  degreeOfSuccess: DegreeOfSuccessResult['degree'];
  dice: number[]; // resultados individuais dos dados
  modifiersApplied: Modifier[];
}

export interface AppliedDamageResult {
  finalDamage: number;        // dano após IWR
  immune: boolean;
  weaknessApplied: number;    // valor de fraqueza adicionado (0 se nenhuma)
  resistanceApplied: number;  // valor de resistência subtraído (0 se nenhuma)
}
```

---

## API e Eventos

### Comandos npm por workspace

```json
// raiz do monorepo — pnpm-workspace.yaml define workspaces
{
  "scripts": {
    "test": "pnpm -r test:unit && pnpm -r test:integration",
    "test:e2e": "playwright test",
    "test:coverage": "pnpm -r test:unit -- --coverage",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  }
}

// packages/shared/package.json
{
  "scripts": {
    "test:unit": "vitest run --config vitest.config.ts",
    "typecheck": "tsc --noEmit"
  }
}

// systems/pf2e/package.json
{
  "scripts": {
    "test:unit": "vitest run --config vitest.unit.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

### Configuração Vitest

```typescript
// vitest.unit.config.ts (para pacotes de regras puras)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',       // sem SQLite; threads são suficientes
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
      include: ['src/rules/**'],
      exclude: ['src/**/__tests__/**'],
    },
  },
});

// vitest.integration.config.ts (para pacotes com SQLite ou socket)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',        // isolamento de processo para SQLite
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 15_000,
    setupFiles: ['tests/integration-setup.ts'],
  },
});
```

### Playwright config

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,  // testes multiplayer precisam de servidor compartilhado
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['github'],           // anotações inline no PR
  ],
  use: {
    baseURL: 'http://localhost:33000',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'e2e',
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/*.spec.ts',
    },
    {
      name: 'visual-regression',  // [V2] — roda apenas no CI com flag
      use: { ...devices['Desktop Chrome'] },
      testMatch: '**/*.visual.ts',
    },
  ],
  webServer: {
    command: 'node dist/server/main.js --test-mode',
    port: 33000,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
```

---

## Dependências

| Spec | Relevância |
|---|---|
| `01-arquitetura-geral.md` | Estrutura de monorepo e pacotes testados |
| `02-modelo-de-dados.md` | Schemas Zod testados em `packages/shared` |
| `03-persistencia-e-mundos.md` | SQLite in-memory setup para integration tests |
| `04-rede-e-sincronizacao.md` | Protocolo Socket.IO testado em integration e E2E |
| `05-usuarios-e-permissoes.md` | Testes de permissão (REQ-TST-004) |
| `08-motor-de-rolagens.md` | Motor de dice testado em unit; seed injetável |
| `10-combate-e-iniciativa.md` | Fluxo de combate testado em E2E (REQ-TST-008) |
| `15-api-de-sistemas.md` | Contrato da system API (suíte de conformidade) |
| `17-sistema-pf2e.md` | Implementação das regras PF2e que os golden tests verificam |
| `18-sistema-sf2e.md` | Regras SF2e dos golden tests [V2] |
| `24-operacao-backups-telemetria.md` | Performance budgets e métricas de FPS (fonte: research 95) |

---

## Critérios de Aceitação

| ID | Critério | Tier |
|---|---|---|
| AC-TST-001 | `pnpm test` passa em um checkout limpo do repositório, sem configuração além de Node.js 22 + pnpm | MVP |
| AC-TST-002 | O CI (`ci.yml`) conclui em menos de 5 minutos para PRs normais | MVP |
| AC-TST-003 | Todos os golden tests PF2e (REQ-TST-010 a REQ-TST-016) passam | MVP |
| AC-TST-004 | A suíte de conformidade passa para `pf2e` e `sf2e`; conformidade do `etmos` é gate condicional (ativa somente quando `ETMOS_SPEC_CLOSED=true`) | MVP |
| AC-TST-005 | Os snapshots do importer pf2e estão presentes e passam | MVP |
| AC-TST-006 | O relatório de campos não mapeados é gerado como artefato no CI | MVP |
| AC-TST-007 | Cobertura de `packages/shared`, `systems/pf2e/src/rules/` e `systems/sf2e/src/rules/` ≥ 80% (etmos excluído do gate até `ETMOS_SPEC_CLOSED=true`) | MVP |
| AC-TST-008 | O teste E2E de fluxo completo (GM + 2 jogadores) passa em headless Chrome | MVP |
| AC-TST-009 | Boot do servidor em modo de teste ocorre em < 3 000 ms | MVP |
| AC-TST-010 | O bundle de produção do cliente não contém `__fusion_test_api__` | MVP |
| AC-TST-011 | Testes de carga smoke (1 GM + 5 jogadores) passam com p99 < 100 ms | V2 |
| AC-TST-012 | Testes de regressão visual do canvas passam em CI após atualização de baselines | V2 |

---

## Questões em Aberto

1. **Seed do RNG para E2E determinístico**: o motor de dados (spec 08) expõe uma API de seed injetável? O mecanismo proposto (`injectDiceResult` em `__fusion_test_api__`) é suficiente ou o seed precisa ser configurado globalmente no servidor? Depende de como o @dice-roller/rpg-dice-roller expõe controle de RNG.

2. **Testes do sistema Etmos em TDD**: ~~Manter limiar de cobertura em 0% até que a spec 19 esteja finalizada?~~ **Resolvido em REQ-TST-021/REQ-TST-033/AC-TST-004**: limiar do Etmos é 0% e o gate de conformidade é desabilitado no CI até que a spec 19 seja fechada e a flag `ETMOS_SPEC_CLOSED=true` seja ativada. Pendente ainda: o sistema Etmos (spec 19) deve ter seus testes de regras escritos antes da implementação (TDD puro)? O material-fonte está disponível para definir os golden tests antes do código?

3. **Cobertura mínima para `packages/server`**: o limiar de 60% definido em REQ-TST-033 é adequado? O servidor tem código de inicialização e handlers de rota que são difíceis de cobrir em integration sem testes de path error.

4. **GPU no CI para regressão visual [V2]**: qual runner do GitHub Actions usar para garantir rendering WebGL/WebGPU determinístico? O runner `ubuntu-latest` com software rasterizer (SWIFTSHADER) produz screenshots idênticos entre runs?

5. **Testes E2E no Windows local**: dado que a plataforma de desenvolvimento é Windows, o Playwright roda em WSL ou nativo? O `webServer` do playwright.config precisa de ajuste de path no Windows?

6. **Proteção do `window.__fusion_test_api__` em builds não-produção** (ex.: staging): o staging também deve usar o mesmo mecanismo de remoção por tree-shaking, ou pode expor a API para facilitar debugging?

7. **Artillery no CI**: o runner padrão do GitHub Actions suporta a carga de 30 clientes simultâneos Socket.IO sem limites de recursos artificiais? Pode ser necessário usar runner `large` para o `load-test.yml`.

8. **Versão mínima do Playwright para `toHaveScreenshot`**: confirmar que a versão pinada do Playwright no monorepo suporta `preserveDrawingBuffer` via configuração de launchOptions.

---

## Referências

- `docs/research/95-ops-backup-telemetry-testing.md` — Seções 3 (Testes e QA) e 3.7 (CI/CD)
- `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — Seções 1–10, 14–16 (mecânicas PF2e/SF2e para golden tests)
- [Vitest documentation](https://vitest.dev/) — framework de testes unit/integration
- [Playwright documentation — Visual Comparisons](https://playwright.dev/docs/test-snapshots) — `toHaveScreenshot()`
- [Artillery documentation](https://www.artillery.io/) + `artillery-engine-socketio-v3`
- [GitHub Actions — Caching dependencies](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
- [commitlint — Conventional Commits](https://commitlint.js.org/)
- [GitHub — foundryvtt/pf2e CI Workflow](https://github.com/foundryvtt/pf2e/actions/workflows/ci.yml) — referência de estrutura de CI para sistema PF2e
- `specs/15-api-de-sistemas.md` — Contrato da system API que a suíte de conformidade verifica
- `specs/08-motor-de-rolagens.md` — Motor de dados (seed injetável para testes determinísticos)
