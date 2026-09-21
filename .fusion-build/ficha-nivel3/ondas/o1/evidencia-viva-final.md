# Evidência viva FINAL — Onda 1 (níveis "vivo" e "olhado", pós-fix)

Esta lane **não editou código de produção**. Consolida duas rodadas:

1. **`evidencia-viva.md`** (mesma pasta, 05:06) — primeira passada, contra o HEAD
   `51696f79` (antes do fixer). Gerou os 6 prints originais e a revisão adversarial
   (`revisao-adversarial.md`), que achou 1 bloqueante (C1) + 3 importantes (C2/C3/C4) +
   6 menores, e **refutou o Achado 2 desta própria lane** (C10: issue #104 tinha premissa
   falsa).
2. **Esta rodada (FINAL)** — re-verificação ao vivo contra o HEAD pós-fixer
   (core `ecb0b9ac`, satélite `80fb68b`, fixes C1/C2/N1 aplicados e aprovados em
   `revisao-adversarial-r1.md`/`revisao-adversarial-r2.md`). Rebuild completo
   (`pnpm build`, EXIT 0, log em `rebuild-postfix.log`) antes de testar — o build antigo
   (05:50) era anterior ao commit final do N1 (05:54), então repeti o build para não
   testar bytecode desatualizado.

## Setup da rodada final

- Mesmo `wt-o0`, branch `ficha3/o1`, agora em `ecb0b9ac` (satélite `80fb68b`).
- Mesmo data-dir `scratchpad/data-o1` (mundo `teste_xande`, os 5 atores semeados na
  primeira rodada continuam lá — não recriei do zero, reaproveitei para testar o
  efeito do fix sobre dado JÁ EXISTENTE, que é exatamente o que expôs o Achado novo
  abaixo).
- Servidor: porta **33021** (33011 da primeira rodada já não estava mais em uso).
  Boot saudável confirmado (`World opened`, `Server listening`, `Fusion server ready`).
- Browser: `playwright-cli`, sessão `o1v2`. Extensão Claude in Chrome **não usada**.
- Login: `GM_o1` / `senha123` (mesmo usuário já criado).
- Servidor encerrado ao final via `taskkill //PID 11948 //F`; `netstat` confirmou só
  `TIME_WAIT` restante na porta 33021.

## O que foi re-verificado — nível Vivo + Olhado

### Exemplar — C1 (bloqueante) confirmado corrigido

- **Antes** (rodada 1): `Exemplar_o1` no `world.db` tinha só `Exemplar:class`,
  `Gleaming Blade:classFeature`, `Flowing Spirit Strike:action` — sem `Shift Immanence`,
  com warning de console `unresolved-placeholder`.
- **Depois** (esta rodada, mesmo ator, dado não tocado, só o código atualizado): o
  `world.db` do mesmo ator agora tem também `Divine Spark and Ikons:classFeature` e
  **`Shift Immanence:action`**. Confirmado por leitura direta do SQLite (`better-sqlite3`
  via `packages/server`), não só pela UI. Na ficha, aparece como trait "Deslocar
  Imanência (Shift Immanence)". Print: `prints/exemplar-postfix-plano.png`.
- **Achado C10 confirmado e issue corrigida**: o pack (`classes-core`, entrada
  "Exemplar") mostra `Root Epithet` como feature de **nível 3**, não nível 1 — os 3
  slots de "Ícone" no nível 1 são RAW (`CLASS_CHOICE_SLOT_COUNT`), não um defeito. A
  issue **#104** ("sem slot de rootEpithet") tinha premissa falsa; comentei o achado
  correto (C1/Shift Immanence, já corrigido) e **fechei a issue**
  (https://github.com/xansde/fusion-systems-2e/issues/104#issuecomment-5757983053).

### Commander — C2 (importante) confirmado corrigido no PICKER, mas achado novo no DADO já gravado

- **Picker corrigido, confirmado ao vivo**: reabri o slot "Tática Conhecida" já
  preenchido de `Commander_o1` (clicando em "Assalto de Piranhas") — o diálogo agora
  lista **exatamente 14 opções** (Pincer Attack, Tactical Takedown, Protective Screen,
  Shields Up!, End It!, Strike Hard!, Coordinating Maneuvers, Passage of Lines,
  Reload!, Defensive Retreat, Gather to Me!, Double Team, Mountaineering Training,
  Naval Training) — todas de nível 1 (mobility/offensive), nenhuma de tier acima.
  Print: `prints/commander-postfix-picker-14-opcoes.png`. Fechei o diálogo com
  "Cancelar" (nenhum dado alterado).
- **Achado novo (registrado como issue, não consertado)**: o `world.db` de
  `Commander_o1` — ator criado na PRIMEIRA rodada, quando o picker ainda oferecia as
  37 táticas sem filtro de tier — continua com as 5 táticas antigas:

  | Tática | `otherTags` no pack | Legal no nível 1 (pós-fix)? |
  |---|---|---|
  | Wait For It... | (nenhuma) | Não |
  | Piranha Assault | `commander-master-tactic` | Não |
  | Pincer Attack | `commander-offensive-tactic` | **Sim** |
  | Buckle-Cut Blitz | `commander-expert-tactic` | Não |
  | Insta-Ballista | `commander-legendary-tactic` | Não |

  4 das 5 táticas gravadas no ator são de tier acima do permitido em nível 1, e a
  ficha mostra as 5 com ✓ como escolhas válidas, sem nenhum aviso. O conserto do C2
  vale só para escolhas NOVAS — não há revalidação do que já estava gravado.
  Print: `prints/commander-postfix-taticas-antigas-ilegais.png`.
  **Issue aberta**: https://github.com/xansde/fusion-systems-2e/issues/106.

### Idiomas (C4/N1) — pendência agora visível na ficha

- `Exemplar_o1` (Elfo) mostra **"Idiomas: common, elven (1 idioma(s) a escolher)"** —
  antes da rodada final mostrava só "common, elven", sem indicar a pendência. Confirma
  o conserto do N1 (soma de `additionalLanguages.count` da ancestralidade ao
  `languagesPendingCount`) e do C4 (tornar a pendência visível em vez de escondida).
  O picker do idioma bônus em si continua não implementado — decisão do corte
  permanece pendente do Alexandre (não é defeito de código; ver `fix-r2.md`).

### Psychic, Animist — sem mudança de código nesta rodada, evidência da rodada 1 permanece válida

Nenhum dos fixes C1/C2/C4/N1 tocou Psychic ou Animist. Os prints e a verificação no
`world.db` da rodada 1 (`psychic-duas-mentes-confirmadas.png`,
`animist-2-aparicoes-e-pratica-confirmadas.png`) seguem válidos sem necessidade de
re-teste — confirmado por leitura do diff dos fixes (`fix-r1.md`, `fix-r2.md`): nenhum
arquivo de Psychic/Animist foi tocado.

### Gunslinger — sem mudança de código nesta rodada

Idem: `gunslinger-way-picker-confirmado.png` (rodada 1) segue válido.

## Tabela consolidada (estado FINAL, pós-fix)

| Família | Vivo confirmado | Olhado (print) | Estado |
|---|---|---|---|
| Exemplar (T1.1) | ikon + Shift Immanence materializado no `world.db` | `exemplar-postfix-plano.png` | **OK** (C1 corrigido e re-verificado) |
| Gunslinger (T1.2) | way + feats concedidos, persistência confirmada | `gunslinger-way-picker-confirmado.png` (rodada 1) | **OK**, sem regressão |
| Psychic (T1.3) | duas mentes + spellcasting | `psychic-duas-mentes-confirmadas.png` (rodada 1) | **OK**, sem regressão |
| Animist (T1.3) | 2 aparições + prática | `animist-2-aparicoes-e-pratica-confirmadas.png` (rodada 1) | **OK**, sem regressão |
| Commander (T1.7 — fólio) | picker agora restrito a 14 táticas de nível 1 | `commander-postfix-picker-14-opcoes.png` | **Picker OK**; dado antigo do ator com 4/5 táticas ilegais — issue #106 |
| Idiomas (T1.8) | pendência de idioma bônus agora visível (Elf, "(1 a escolher)") | `exemplar-postfix-plano.png` | **OK** (C4/N1), picker do idioma bônus segue fora de escopo (decisão pendente) |

## Pendências para issue — status final

1. ~~**xansde/fusion-systems-2e#104**~~ — **FECHADA nesta rodada** (premissa falsa,
   confirmada pelo C10 e pela verificação ao vivo; o defeito real já estava corrigido).
2. **xansde/fusion-systems-2e#106** (nova, aberta nesta rodada) — "Commander: táticas
   escolhidas antes do fix de tier (C2) ficam ilegais e sem aviso na ficha". Cenário
   concreto com o `otherTags` de cada tática e os dois prints.
3. **Achado 1 da rodada anterior** ("trocar de classe acumula items") — segue como
   pendência sinalizada, não aberta como issue nesta rodada (fora do escopo direto da
   Onda 1; quem fechar a onda decide). Título/corpo prontos em `evidencia-viva.md`
   (Pendências, item 2).
4. **xansde/fusion-systems-2e#102** (idiomas bônus por Int) e **#105** (ordem de merge
   do submodule) seguem abertas, sem ação nova desta lane — já cobertas pelos
   relatórios do fixer.

## Encerramento

Servidor da rodada final (PID 11948, porta 33021) encerrado via `taskkill //PID 11948
//F`; `netstat` confirmou só `TIME_WAIT`. Nenhum arquivo do `~/.fusion` real foi
tocado — todo o trabalho ficou em `scratchpad/data-o1`. Nenhum código de produção foi
editado por esta lane; as duas correções de GitHub (#104 fechada, #106 aberta) são
registro/documentação, não código.
