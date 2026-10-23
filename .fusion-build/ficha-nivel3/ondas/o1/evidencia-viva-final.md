# Evidência viva FINAL — Onda 1 (níveis "vivo" e "olhado"), rodada de re-verificação pós fix-r3/r4

Esta lane **não editou código de produção**. É a terceira passada de evidência viva desta
onda:

1. **Rodada 1** (`evidencia-viva.md`, mesma pasta) — contra `51696f79` (pré-fixer). 6 prints,
   revisão adversarial achou 1 bloqueante (C1) + 3 importantes (C2/C3/C4) + 6 menores.
2. **Rodada 2** (versão anterior deste mesmo arquivo — histórico em
   `wt-o0/.fusion-build/ficha-nivel3/ondas/o1/evidencia-viva-final.md`, commitada em `7ff5f7cb`,
   e ainda no histórico de commits deste relatório em `ficha3-reports/o1/`) — contra `ecb0b9ac`
   (pós fixer r1/r2). Confirmou C1 (Exemplar/Shift Immanence) e C2 (picker do Commander)
   corrigidos; achou pendência nova (#106, táticas antigas ilegais no dado já gravado).
3. **Esta rodada (FINAL, pós fix-r3/r4)** — contra o HEAD atual `75a5090e` (satélite `c7bb7cc`),
   que **implementou** o picker de idioma bônus (T1.8/C4, antes só o dado existia) e depois
   **corrigiu a regra do pool comum** (N3: `COMMON_LANGUAGES` RAW, união com a lista própria da
   ancestralidade, em vez do fallback inventado só para Humanos). Nenhum destes dois fixes
   tinha evidência viva própria — só teste unitário (`fix-r3.md`, `fix-r4.md`,
   `revisao-adversarial-r3.md`, `revisao-adversarial-r4.md`). Esta rodada fecha esse gap.

## Setup desta rodada

- Worktree `wt-o0`, branch `ficha3/o1`, HEAD `75a5090e4b19e571dc756b3fc4f9647715b4821a`
  (satélite `c7bb7cc`). `pnpm build` rodado do zero antes de testar (EXIT 0) — o `dist/`
  anterior era de antes do commit do N3.
- Mesmo data-dir `scratchpad/data-o1` (mundo `teste_xande`), atores das rodadas anteriores
  preservados (`Exemplar_o1`, `Gunslinger_o1`, `Psychic_o1`, `Animist_o1`, `Commander_o1`).
- Servidor: porta **33040**. Boot saudável confirmado (`World opened`, `Server listening`,
  `Fusion server ready`).
- Browser: `playwright-cli`, sessão `o1v3`. Extensão Claude in Chrome **não usada**.
- Login: `GM_o1` / `senha123` (usuário já existente).
- **Ator NOVO criado nesta rodada**: `Human_o1_lang` (id `HmnO1LangTest1xy`), inserido por
  escrita direta no `world.db` **vazio** (sem ancestralidade/classe/escolha nenhuma — só a
  estrutura mínima de um `character` válido, copiada do formato real de `_stats`/`ownership`
  de um ator existente) e então construído inteiramente pela UI: Ancestralidade → Humano,
  Classe → Mago (Wizard). Esse é o workaround de "criar personagem" documentado no
  `gate-runbook.md` §5 (não existe botão "novo personagem" na UI) — não reaproveitei nenhum
  ator com dado ilegal pré-fix (a instrução da tarefa pedia atores novos para este teste).
- Servidor encerrado ao final: PID 2456 (mostrado pelo `netstat`, diferente do PID do `node`
  que iniciou o processo — o `serve` do CLI faz respawn), `taskkill //PID 2456 //F`;
  `netstat` pós-kill mostrou só `TIME_WAIT` na porta 33040.

## O que foi verificado — nível Vivo + Olhado

### Idiomas — picker de bônus por Inteligência, incluindo HUMANO (T1.8/C4 + N3) — NOVO nesta rodada

- **Humano `Human_o1_lang`, Mago nível 1**: a ficha mostrou o slot "Idioma Bônus" assim que a
  classe foi escolhida (`derived.languagesPendingCount` = 1, de `+3 INT` → não, na verdade o
  personagem não teve boosts de habilidade aplicados via picker de atributos; o slot vem do
  bônus de Inteligência **já refletido no `system.build`**, mecanismo de `stepCharLanguages`).
  Antes de escolher: **"Idiomas: common (1 idioma(s) a escolher)"**.
- **Picker aberto ao vivo**: diálogo "Bonus Language" listou exatamente as **10 línguas comuns
  do Player Core remaster** — Draconic, Dwarven, Elven, Fey, Gnomish, Goblin, Halfling, Jotun,
  Orcish, Sakvroth — **sem `ysoki`** (que o fallback antigo incluía erradamente) e **com**
  `draconic`/`jotun`/`sakvroth` (que o fallback antigo omitia). Como Humano tem
  `additionalLanguages.value = []`, o pool é só o comum — confere exatamente com o conserto do
  N3. Print: `prints/human-idioma-bonus-picker-10-opcoes.png`.
- **Escolhi "Draconic"**: a ficha atualizou na hora para **"Idiomas: common, draconic"** (sem
  pendência). Print: `prints/human-idiomas-draconic-escolhido.png`.
- **Persistência confirmada após reload da página** (não só re-render em memória): fechei a
  aba/reload completo do browser, reabri a ficha do mesmo ator — "Idiomas: common, draconic"
  continuou lá.
- **Confirmado no `world.db` (leitura direta via `better-sqlite3`, não só a UI)**: o array
  `system.build.choices` do ator `HmnO1LangTest1xy` tem
  `{"level":1,"slot":"language-1-0","type":"language","ref":"draconic"}`, e `items` tem o
  documento `ancestry` "Human" e `class` "Wizard" materializados.
- **Repeti o teste com uma ancestralidade NÃO-Humano** (reabri o slot pendente de
  `Exemplar_o1`, que é Elfo e continuava com 1 idioma bônus não escolhido desde a rodada
  anterior — não toquei o código, só reabri o picker): o diálogo listou **11 opções** — as 9
  línguas comuns que o Elfo ainda não conhece (excluiu `elven`, que ele já tem fixo) **mais**
  `Empyrean` e `Kholo` (línguas próprias da ancestralidade Elfo, de `additionalLanguages.value`
  no pack). Confirma que a união comum+ancestralidade funciona também para uma ancestralidade
  com lista própria não-vazia, não só o caso especial do Humano. Print:
  `prints/elf-idioma-bonus-picker-uniao-comum-mais-ancestralidade.png`. Fechei sem escolher
  (não quis alterar o estado do ator usado como evidência da rodada anterior).

### Exemplar, Gunslinger, Psychic, Animist, Commander — regressão checada, sem mudança de comportamento

Nenhum dos fixes r3/r4 tocou código dessas famílias (confirmado lendo os diffs listados em
`fix-r3.md`/`fix-r4.md`: só `derivations.ts`, `planVM.ts`, `LanguageDialog.svelte`,
`classBuildHarness.ts`). Reabri `Exemplar_o1` nesta rodada para checar regressão indireta (o
slot de idioma pendente é renderizado pelo mesmo componente de Plano que os slots de Ícone) —
**sem regressão**: Ícone (Gleaming Blade) e "Deslocar Imanência" (Shift Immanence, o fix do C1)
continuam lá, e o "Idiomas: common, elven (1 idioma(s) a escolher)" da rodada anterior segue
idêntico. Print: `prints/exemplar-final-plano-idiomas-pendente.png`.

Os prints das rodadas anteriores seguem válidos sem re-teste (nenhum arquivo tocado):

| Família | Vivo confirmado | Print | Rodada de origem |
|---|---|---|---|
| Gunslinger (T1.2) | "Way of the Pistoleiro" + 2 feats concedidos (Recarga do Contador de Histórias, Dez Passos) | `gunslinger-way-picker-confirmado.png` | 1 |
| Psychic (T1.3) | Mente Subconsciente (Emotional Acceptance) + Mente Consciente (The Distant Grasp), ambas concedidas | `psychic-duas-mentes-confirmadas.png` | 1 |
| Animist (T1.3) | 2 aparições (Crafter in the Vault, Custodian of Groves and Gardens) + prática "Medium" | `animist-2-aparicoes-e-pratica-confirmadas.png` | 1 |
| Commander (T1.7) | fólio com 5 táticas conhecidas — **4 delas ainda de tier ilegal para nível 1** (dado gravado antes do fix C2, issue #106 aberta, propositalmente não consertado, fora deste gate) | `commander-folio-5-taticas-confirmadas.png` | 1 |

## Tabela consolidada FINAL (estado em `75a5090e`/`c7bb7cc`)

| Família | Vivo | Olhado | Estado |
|---|---|---|---|
| Exemplar (T1.1) | ikon + Shift Immanence materializados; idioma pendente exibido corretamente | `exemplar-final-plano-idiomas-pendente.png` | **OK**, sem regressão |
| Gunslinger (T1.2) | way + 2 feats concedidos | `gunslinger-way-picker-confirmado.png` | **OK**, sem regressão |
| Psychic (T1.3) | duas mentes + spellcasting | `psychic-duas-mentes-confirmadas.png` | **OK**, sem regressão |
| Animist (T1.3) | 2 aparições + prática | `animist-2-aparicoes-e-pratica-confirmadas.png` | **OK**, sem regressão |
| Commander (T1.7 — fólio) | picker restrito a 14 táticas nv1 (rodada 2); dado antigo do ator com 4/5 táticas ilegais permanece — issue #106 aberta | `commander-postfix-picker-14-opcoes.png` + `commander-folio-5-taticas-confirmadas.png` | **Picker OK**; dado pré-existente é pendência conhecida, não corrigida por design |
| **Idiomas (T1.8/C4/N3)** | picker de bônus implementado e correto: 10 línguas comuns (Humano) ou comum∪ancestralidade menos conhecidas (Elfo, 11 opções); escolha persiste no `world.db`, confirmado com **ator Humano novo** | `human-idioma-bonus-picker-10-opcoes.png`, `human-idiomas-draconic-escolhido.png`, `elf-idioma-bonus-picker-uniao-comum-mais-ancestralidade.png` | **OK** — fecha o gap que a rodada 2 tinha deixado pendente (picker não implementado) |

## Pendências para issue — status desta rodada

Nenhuma pendência NOVA encontrada nesta rodada. As pendências já conhecidas seguem no mesmo
estado (checado, não reaberto nem duplicado):

1. `xansde/fusion-systems-2e#104` — segue **fechada** (premissa falsa, rodada 2).
2. `xansde/fusion-systems-2e#106` — segue **aberta**: táticas do Commander gravadas antes do
   fix C2 (tier) ficam ilegais e sem aviso na ficha; confirmado ainda presente no `world.db` de
   `Commander_o1` nesta rodada (não é regressão nova, é o mesmo dado da rodada 2).
3. `xansde/fusion-systems-2e#102` — **fechada pelo fix-r3** (picker de idiomas bônus
   implementado); confirmado ao vivo nesta rodada que a implementação funciona fim a fim
   (picker → escolha → persistência → `world.db`), não só pelos testes unitários do fixer.
4. Achado "trocar de classe acumula items" (rodada 1/2, `Novo Ator` tem Barbarian + Exemplar
   simultâneos no `items`) — segue como pendência sinalizada, sem issue própria aberta por
   esta lane (fora do escopo direto da Onda 1; mantém-se a decisão da rodada 2 de deixar para
   quem fechar a onda).

## Encerramento

Servidor desta rodada (PID 2456, porta 33040) encerrado via `taskkill //PID 2456 //F`;
`netstat` pós-kill confirmou só `TIME_WAIT`. Nenhum arquivo do `~/.fusion` real foi tocado —
todo o trabalho ficou em `scratchpad/data-o1`. Nenhum código de produção foi editado por esta
lane; o único artefato novo no `world.db` de teste é o ator `Human_o1_lang`, criado por escrita
direta (workaround documentado no `gate-runbook.md`) e depois inteiramente montado pela UI real.
