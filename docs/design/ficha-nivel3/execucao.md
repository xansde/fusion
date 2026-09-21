# Fatia 1 — Plano de execução

Complementa [`tasks.md`](./tasks.md) (o quê) e [`plano.md`](./plano.md) (por quê).
Aqui: **quem executa, com qual modelo, em quantas lanes, e como cada onda prova que entregou.**

---

## 1. Regra de paralelismo

A regra não é "quantos agentes cabem", é **quantas FONTES DISJUNTAS existem**.

> **Fan-out por fonte disjunta; batch por fonte compartilhada.**
> N agentes editando o mesmo arquivo não é paralelismo, é rollback silencioso: edição concorrente
> não faz merge. E o `system-reminder` de "arquivo modificado" chega ao subagente como conteúdo de
> origem desconhecida — ele trata como prompt injection e **reverte** a edição (visto em 06/08/2026).

### ⚠️ Correção de 2026-09-20 (auditoria de orquestração)

A primeira versão deste documento dizia que **O1, O2, O4, O5 e O6 podiam correr em paralelo** depois
da O0. **Está errado, por dois motivos:**

1. **Colisão de arquivo entre ondas.** A curadoria é **um arquivo por classe**, não por assunto.
   `curation/classes/oracle.json` é editado pela T1.6 (Onda 1, taguear `mystery`) **e** pela T2.5
   (Onda 2, `rules` de Revelation Spells). `animist.json` é editado pela T1.6 **e** pela T4.2. Eu
   raciocinei por pacote ("O1 mexe no picker, O2 em conjuração, logo são disjuntas") e errei a
   granularidade. Em paralelo, isso não dá conflito: dá **reversão silenciosa**.
   **Conserto:** a **O1 fecha antes de O2 e O4 começarem**.
2. **Teto de worktrees estourado.** Cinco ondas em paralelo exigem cinco worktrees; o teto deste
   mesmo documento é **3**. **Conserto:** depois da O1, as cinco ondas restantes rodam em **dois
   lotes de até 3**.

O máximo real de lanes paralelas seguras é **3**.

### Consequência direta nesta fatia

A Onda 1 tem 16 tarefas e **uma lane só** — confirmado no código pela auditoria. Todas as 15 escolhas são entradas na mesma tabela
(`CLASS_CHOICE_SLOT_OPTIONS`, `planVM.ts:2094`) e mexem nos mesmos símbolos vizinhos (`PlanSlotType`,
`CLASS_CHOICE_SLOTS`, `SLOT_TYPE_LABELS`). Quinze agentes ali produziriam quinze reversões.
O paralelismo real dessa onda está **dentro** da lane: um agente, quinze entradas, um diff.

### Teto de concorrência: worktrees

- **Máximo 3 worktrees ativas.** `pnpm install` paralelo em várias worktrees **corrompe o
  `node_modules` em silêncio** — já aconteceu neste repo.
- Worktrees são criadas **uma de cada vez**, com o `pnpm install` de uma terminando antes da próxima.
- **Worktree nova exige `pnpm build` antes de qualquer teste** — sem isso, ~52 arquivos falham só na
  coleta e o agente reporta falha falsa.
- Data-dir de teste **nunca dentro da worktree**: vai no scratchpad da sessão. Um `git add -A` já
  commitou um `~/.fusion` com `auth_secret` e mundos, e levou ao remoto.
- **Nunca `git add -A` com subagente em voo** — reprova o CI em `format:check` enquanto o gate
  local passa.

---

## 2. Modelo e esforço por tarefa

Padrão do projeto: **`sonnet` é o default de execução**; `opus` só para julgamento arquitetural e
revisão adversarial; `haiku` para mecânico/relatório.

| Onda          | Tarefas                                                                                                             | Modelo     | Esforço                                                              | Lanes                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **0**         | T0.1, T0.2, T0.5 (merge, guard, pin)                                                                                | `sonnet`   | médio                                                                | 1 (serial)                                                                       |
| **0**         | T0.3, T0.4 (conversão dos 2.541 grants + validador)                                                                 | `sonnet`   | **alto** — é a peça que sustenta a fatia inteira                     | 1                                                                                |
| **1**         | T1.1–T1.8 (15 escolhas + fólio do Commander + idiomas)                                                              | `sonnet`   | baixo — cabeamento repetitivo                                        | **1** (fonte compartilhada; **serial antes de O2/O4**)                           |
| **2**         | T2.1+T2.2 (repertório + picker)                                                                                     | `sonnet`   | alto                                                                 | 1                                                                                |
| **2**         | T2.3 (lista preparada) — ⚠️ pode tocar **core e satélite**; se tocar, precisa do mesmo gate de ordem de pin da T0.5 | `sonnet`   | alto                                                                 | 1                                                                                |
| **2**         | T2.4 (proficiência) · T2.5 (foco)                                                                                   | `sonnet`   | médio                                                                | 1 (juntas — ambas tocam derivação/curadoria)                                     |
| **3**         | T3.1 (modelo de ator companheiro)                                                                                   | **`opus`** | alto — decisão arquitetural: ator vinculado × faceta (specs 29 e 45) | 1, **com gate humano antes de T3.2**                                             |
| **3**         | T3.2, T3.3                                                                                                          | `sonnet`   | médio                                                                | 2                                                                                |
| **4**         | T4.1 (divindades) · T4.2 (Animist) · T4.3 (Necromancer)                                                             | `sonnet`   | médio                                                                | **3 — packs disjuntos, fan-out real** (a T4.4 foi dissolvida: tática não é item) |
| **5**         | T5.1 (importar 129)                                                                                                 | `sonnet`   | baixo                                                                | 1                                                                                |
| **5**         | T5.2 (variante/slot) · T5.3 (regra)                                                                                 | `sonnet`   | médio                                                                | 1                                                                                |
| **6**         | T6.1–T6.3 (ownership, validação no servidor)                                                                        | `sonnet`   | alto — toca permissão                                                | 1 (serial)                                                                       |
| **7**         | T7.1 (molde) · T7.3 (roteiro e2e)                                                                                   | `haiku`    | baixo                                                                | 2                                                                                |
| **7**         | T7.2 (comparador)                                                                                                   | `sonnet`   | médio                                                                | 1                                                                                |
| **Toda onda** | revisão adversarial do diff **integrado**                                                                           | **`opus`** | alto                                                                 | 1, no fecho                                                                      |

**Por que a revisão adversarial é `opus` e é por ONDA, não por lane:** nas ondas 2 e 3 do
Alquimista, todas as lanes verdes e o gate verde conviveram com 5 bloqueantes, e depois com 1
bloqueante + 3 importantes. O defeito aparece na costura entre as lanes, que nenhuma lane vê.

**Por que NÃO há verificador dedicado por lane:** onda 5 do Alquimista — 6 lanes, 6 verificadores,
6 aprovações, **nenhuma correção**, e a suíte completa rodando 3× por tarefa. A verificação é do
dono da tarefa; a rede de segurança é a revisão adversarial da onda.

### Contrato de retorno de toda lane

Máximo **~15 linhas**: status, números, bloqueio, caminho do detalhe. O relatório completo vai em
`.fusion-build/ficha-nivel3/ondas/<onda>/<tarefa>.md`. **Nunca colar saída de comando no retorno** —
uma onda de 7 tarefas com verificação gera ~25 relatórios; a 2.000 palavras cada, isso estoura a
janela sozinho (aconteceu na onda 2 do Alquimista).

### Monitor

Toda onda com previsão > 20 min sobe com `Monitor`, cobrindo o estado **"travou"**, não só
"concluiu" — subagente morto pode não notificar.

---

## 3. Como cada onda prova que entregou

Três níveis, e **os três são obrigatórios**:

1. **Mecânico** — comando que qualquer um roda e vê a saída.
2. **Vivo** — uma personagem criada num mundo real, não um fixture de teste.
3. **Olhado** — print da tela, conforme `docs/design/PROCESSO-UI.md`.

> A regra que manda aqui: **não inferir funcionalidade de arquivo, protocolo ou spec.** Exigir
> código + emissor na UI + dado no mundo antes de dizer que funciona. Já houve US12 declarada
> pronta que não existia.
> E: **quem testa no servidor é o Alexandre.** Subiu o build, avisa e devolve o controle.

| Onda  | Mecânico                                                                                                                                     | Vivo                                                                                                 | Olhado                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **0** | `pnpm build && pnpm test` verde + script que conta `GrantItem` não resolvível: **tem que dar 0** (T0.4 falha o build se não der)             | **Monk** criado num mundo e subido a 3: as features de nv 1, 2 e 3 **concedidas**, não só listadas   | print da aba Plano nos três níveis        |
| **1** | teste que percorre as **27** entradas de `CLASS_CHOICE_SLOT_OPTIONS` e afirma, para cada uma: lista > 0 opções **e** grava no ator           | **Exemplar** (ikon + epíteto) e **Gunslinger** (way) criados; a escolha persiste após recarregar     | print de 3 pickers, um por família        |
| **2** | teste de slots/conhecidas por círculo nos níveis 1-3 para as 10 classes conjuradoras; `proficiencyUpgrades` com consumidor coberto por teste | **Bard** nv3 (espontâneo, repertório escolhido, foco = 1) e **Wizard** nv3 (preparado, lista do dia) | print da aba de magias dos dois           |
| **3** | teste de criação que gera **dois** documentos com ownership correto                                                                          | **Summoner** nv1 + eidolon existindo como documento próprio                                          | print do eidolon na gaveta                |
| **4** | Animist: **23/23** features de nv 1-3 com `rules`[^1] (hoje 6/23); pack de divindades importado e referenciável                              | **Cleric** e **Champion** criados com divindade escolhida                                            | print da escolha de divindade             |
| **4b**[^2] | 13 testes (`apparitionSpellcasting.test.ts`) contra o vendor real: entrada "Apparition Spells" criada, repertório+Lore+vessel corretos, swap/remove retraem | **NÃO FEITO nesta lane** — precisa de um Animist real subindo o servidor e escolhendo aparições (a lane não subiu servidor/browser) | **NÃO FEITO nesta lane** — sem print; pendência registrada abaixo |
| **5** | teste: com a variante ligada, o slot de nv2 lista **129** dedicações padrão e **0** de multiclasse                                           | personagem nv2 com dedicação padrão escolhida                                                        | print do slot de arquétipo                |
| **6** | teste de servidor: jogador editando ator alheio é **recusado pelo servidor** (não só escondido no client)                                    | smoke **como GM e como player**                                                                      | prints dos dois papéis                    |
| **7** | molde preenchido × ficha gerada: **divergência zero**                                                                                        | —                                                                                                    | roteiro `tutorial-e2e` com prints olhados |

[^1]:
    **Critério trocado (T4.2, registrado na correção do achado C4 — revisão adversarial da Onda
    4, fixer rodada 1, 2026-09-21):** o gate real aceitou `rules` **OU** justificativa explícita
    (`ruleJustifications`, verificado por `animist-rule-coverage.test.mjs`, 23/23) em vez de exigir
    `rules` real em todas as 23 — as 17 features sem `rules` também têm `rules: []` no vendor
    oficial (Apache-2.0), então fabricar uma regra sem fonte verificada violaria a disciplina de
    não inventar dado (lição #48). A troca não tinha sido anotada aqui até esta correção. Duas
    lacunas de engine descobertas nessa investigação (grant dinâmico de Lore skill por apparition,
    repertório de apparition com 16 magias faltando) não tinham buraco registrado neste plano nem
    issue aberta — ver `tasks.md` T4.2 para os números das issues abertas.

[^2]:
    **Onda 4b (T4.4, feedback do Alexandre testando a vitrine, 2026-09-21):** fecha a parte de
    dado real das issues #124/#114 no recorte 1-3 — ver `tasks.md`, seção "Onda 4b", para o
    detalhe completo do que fechou e do que ficou registrado como pendência (16 magias faltando
    em spells-core, reseleção de aparição primária, reescolha diária, #101/#110/#119). O nível
    "Vivo"/"Olhado" desta onda não foi produzido: a lane implementou e verificou por teste
    (`apparitionSpellcasting.test.ts`, 13 casos contra o vendor real), mas não subiu servidor nem
    browser para criar um Animist de verdade e fotografar a aba de magias — **fica pendente para
    quem validar esta onda**, seguindo `docs/design/PROCESSO-UI.md`.

### Artefato de fecho de onda

Cada onda fecha com um **PR contra `alfa/app`** contendo:

- o diff;
- `.fusion-build/ficha-nivel3/ondas/<onda>/evidencia.md` — a tabela acima preenchida, com a saída
  real dos comandos e os caminhos dos prints;
- os prints (print do protótipo × tela, quando houver protótipo);
- o veredito da revisão adversarial `opus`;
- a lista de pendências, **cada uma já registrada como issue** no repo certo.

**Merge é sempre ato humano.** Abrir PR é livre; mergear não.

### O que invalida uma onda

- Qualquer prova só no nível mecânico (teste verde sem personagem viva) — foi assim que a #48
  conviveu com 60 defeitos.
- Aceite comparando a ficha contra a tabela do próprio pack (circular). A fonte externa é o molde
  da Onda 7, preenchido à mão.
- Pendência que existe só no relatório e não virou issue.

---

## 4. Riscos e rollback

| Risco                                                                          | Sinal                                                | Resposta                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Submodule shallow derruba o merge da T0.1**                                  | `fatal: refusing to merge unrelated histories`       | `git fetch --unshallow` (T0.0). **NUNCA `--allow-unrelated-histories`** — o ancestral comum existe (`073fb5e`), só não foi fetchado; forçar costura duas árvores como estranhas |
| **Dois diretórios `tools/importer-pf2e/`**                                     | agente edita o da raiz do core e nada acontece       | o **código** está em `external/fusion-systems-2e/tools/importer-pf2e/src/`; o da raiz do core é untracked e só tem **dado** (`vendor/`, `out/`)                                 |
| A conversão dos grants (T0.3) quebra as 12 classes que já funcionavam          | suíte do satélite vermelha                           | o pin do submodule é o ponto de retorno: reverter o pin no core restaura o estado anterior sem tocar no satélite                                                                |
| O merge das 29 classes reintroduz o vazamento de talentos                      | talento de Psychic aparece no picker de outra classe | T0.2 é **pré-requisito de gate**, não tarefa paralela — a onda 0 não fecha sem o teste do guard                                                                                 |
| `tools/importer-pf2e/` untracked se perde                                      | onda 5 sem fonte                                     | **T5.0 decide antes da onda 5 rodar**                                                                                                                                           |
| Saída não-zero do vitest com "Timeout calling onTaskUpdate" sem teste falhando | CI vermelho sem defeito                              | é flakiness de infra sob carga — re-rodar o arquivo isolado antes de tratar como regressão                                                                                      |
| Porta hardcoded em teste novo                                                  | `EADDRINUSE` no CI                                   | usar `packages/server/src/__tests__/helpers/ports.ts` (`reserveFreePort`); `port: 0` **não** funciona neste servidor                                                            |

---

## 5. Comandos de gate

```bash
pnpm build            # topológico; shared antes de server. Worktree nova: obrigatório antes de testar
pnpm typecheck
pnpm lint
pnpm lint:boundaries
pnpm test             # vitest workspace; server usa pool forks/maxForks 4 (better-sqlite3)
pnpm format:check     # nunca rodar `git add -A` com subagente em voo
pnpm spec:report      # o CI cai se não rodar após merge que adiciona teste novo
```
