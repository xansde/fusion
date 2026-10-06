# Evidência viva FINAL — Onda 6b (gatilho de UI para criar personagem)

Lane de fecho da evidência: consolida e verifica o trabalho já produzido nesta mesma onda (lane
anterior, worktree `wt-d`, mesma branch `ficha3/o6b`), agora a partir da worktree `wt-o0`
(retomada, já buildada, mesmo commit `82231a7e`). Nenhum código de produção foi tocado nesta
lane — só verificação, prints já existentes reconferidos e correção de documentação.

## Contexto: por que esta lane existe

Uma execução anterior desta mesma onda (`ficha3-reports/o6b/fecho.md`) tinha ficado **bloqueada**
por interpretar uma fala relayada de outro assunto (bug do Animista) como conflito com o fecho da
o6b. O disparo desta lane trouxe uma observação explícita do orquestrador dizendo que isso **não**
é conflito e que a fatia deve seguir por inteiro. Esta lane retoma o que já estava pronto e fecha
os níveis "vivo" e "olhado" da prova de entrega (`execucao.md`, seção 3).

## O que já existia (verificado nesta lane, não refeito do zero)

1. **T6.5** (`T6.5-criar-personagem.md`) — auditoria que fechou a questão de produto: **não existe
   nem deve existir** um botão "Criar personagem" novo (violaria REQ-CFG-051a/REQ-NPC-055a). O
   gatilho real é **Configurações → Usuários → Criar usuário**: `AuthService.createUser`
   (REQ-USR-025) cria, na mesma transação, um Actor `character` em branco do qual o novo usuário
   é `OWNER`. Commit `d848ce08` (2 arquivos de teste, prova automatizada).
2. **Fixer r1** (`fix-r1.md`) — 3 achados consertados: C2 (`fusion user add` via CLI não criava o
   Actor — corrigido em `20edd60d`, a rota de UI/API já funcionava certo), C3 (`checkSlotRequirement`
   marcava talento multi-classe como "classe errada" olhando só o primeiro trait — corrigido no
   satélite `66c3a3f`, pin `adcf4cbe`), C1 (prova excessiva no texto do T6.5/tasks.md sobre os 4
   caminhos de redação — corrigido em `ee0d801c` + `82231a7e` prettier). Gate completo
   (build/typecheck/lint/lint:boundaries/format:check/spec:report) verde, sem regressão vs.
   baseline da Onda 0.
3. **Evidência viva original** (`evidencia-viva.md`, prints 01-14) — servidor real (porta 33020,
   data-dir isolado), dois papéis de browser reais (Playwright), dois personagens subidos de
   nível 1 a 3 pelo gatilho real: um Mago (Elfo Ancestral/Erudito) e um Guerreiro (Anão da
   Forja/Combatente), ambos via "Mestre cria usuário → Actor nasce → dono abre a própria ficha
   pela coluna Plano". Achou o defeito C3 nesta mesma passada (talento "Familiar" com aviso falso
   de classe errada).
4. **Recheck pós-fix** (prints 15-17) — mesmo personagem (`JogadorO6b`, Mago nv3), reaberto depois
   do fix C3: talento "Familiar" e "Cantrip Expansion" sem o aviso vermelho falso.

## Reverificação feita nesta lane (worktree `wt-o0`, sem alterar o mundo/dado)

Reaproveitei o mesmo data-dir isolado (`scratchpad/data-o6b`, cópia de `~/.fusion/worlds/teste_xande`,
nunca o mundo real) e o `better-sqlite3` embarcado no build de `wt-o0` para conferir os prints
contra o `world.db`, sem depender só da narrativa do relatório anterior:

| Verificação | Print(s) olhado(s) | Fonte de verdade (banco) | Resultado |
| --- | --- | --- | --- |
| Gatilho: Mestre cria usuário `JogadorO6b` (papel Jogador) | `03-gm-usuario-jogadoro6b-criado.png` — lista de Usuários mostra Gamemaster/MestreO6b/Tobias/**JogadorO6b** | tabela `users` do `world.db`: linha `yCDgop1neNUq9gl3` / `JogadorO6b` / role Jogador | confere |
| Actor nasce em branco, dono = o usuário recém-criado | `04-ficha-jogadoro6b-em-branco.png` — ficha nível 1, "Escolha uma classe para começar" | `actors` tabela, actor `3yVcijuzpV7STeCb`: `ownership = {"default":0,"yCDgop1neNUq9gl3":3}` (OWNER), `flags.fusion.playerId = "yCDgop1neNUq9gl3"` | confere |
| Personagem 1 sobe a nível 3 (Mago) | `08`/`09`/`17` | actor `JogadorO6b`: `system.details.level = 3`, 18 `items` incluindo `class:Wizard`, `classFeature:School of Unified Magical Theory`, `classFeature:Spell Blending`, `classFeature:Wizard Spellcasting`, `classFeature:Arcane Bond`, `feat:Ancestral Linguistics`, `feat:Familiar`, `feat:Cantrip Expansion`, `feat:Arcane Sense`, `feat:Incredible Initiative` | confere |
| Personagem 2 sobe a nível 3 (Guerreiro), dono = Mestre-criado-para-o-jogador | `13`/`14` | actor `JogadorGMCriado`: `ownership = {"default":0,"ptoE56HaYAEvuLSd":3}`, `system.details.level = 3`, 17 `items` incluindo `class:Fighter`, `classFeature:Reactive Strike`, `classFeature:Shield Block`, `classFeature:Bravery`, `feat:Dwarven Weapon Familiarity`, `feat:Vicious Swing`, `feat:Dueling Parry`, `feat:Experienced Tracker`, `feat:Incredible Initiative` | confere (relatório anterior tinha um id de actor errado — `uPI...` na verdade é o actor "Novo Ator", não o `JogadorGMCriado`; o id certo é `rtCt9vl77qkKgDD9`. Correção registrada aqui, não muda a conclusão) |
| Jogador só vê o próprio personagem em Contatos | `11-player-contatos-so-o-proprio.png` — "Na mesa 1", só `JogadorO6b (você)` | redação por ownership (`redaction.ts`) — comportamento de UI já cruzado com a limitação registrada na issue `xansde/fusion#240` (só cobre o snapshot de join) | confere, com a ressalva já documentada |
| Defeito C3 (talento multi-classe com aviso falso) e sua correção | `09-nivel3-aba-magias-mago.png` (aviso presente, pré-fix) vs. `17-recheck-familiar-scroll-sem-aviso.png` (sem aviso, pós-fix `66c3a3f`) | `planVM.test.ts` (satélite), describe "checkSlotRequirement — classFeat with several class traits", verde pós-fix | confere — defeito real, corrigido, prova visual antes/depois |

Todos os 17 prints em `ficha3-reports/o6b/prints/` foram olhados (Read) nesta lane ou na lane
anterior da mesma onda; os 6 acima foram reabertos nesta lane especificamente para conferir contra
o `world.db` linha a linha, não só contra a legenda do relatório anterior.

## Correção de documentação nesta lane

`docs/design/ficha-nivel3/gate-runbook.md`, seção 5 — estava descrevendo o estado da Onda 0
("não existe botão criar personagem", workaround de reaproveitar atores existentes/escrever
direto no `world.db`). Isso ficou **obsoleto** depois da investigação da T6.5 desta mesma onda:
reescrevi a seção para descrever o gatilho real (Configurações → Usuários → Criar usuário) e
apontar para esta evidência. Commit próprio, `prettier --write` já rodado (sem diferença de
formatação).

## Defeito não corrigido nesta lane (já registrado, não é desta lane resolver)

- **Issue `xansde/fusion#240`** (já aberta pelo fixer r1) — a asserção negativa de "outro jogador
  não vê o personagem alheio" só cobre o snapshot de join (`resync:full`); broadcast ao vivo,
  replay de delta e eco do ack ainda podem divergir. Não é um achado novo desta lane, só
  reconfirmado ao ler o print 11 (que também só prova o snapshot inicial).

## Pendências para issue

Nenhuma pendência **nova** desta lane de verificação. As duas já existentes seguem abertas:

- `xansde/fusion#240` — redação de Actor `character` diverge entre snapshot/broadcast/replay/eco.
- `xansde/fusion-systems-2e#129` — registro do achado C3 (já resolvido no mesmo commit que a
  abriu; issue é só rastreamento).

## Servidor

Nenhum servidor novo foi subido nesta lane — a reverificação usou consulta direta (`better-sqlite3`,
somente leitura) ao `world.db` já existente em `scratchpad/data-o6b`, sem precisar reabrir o
browser nem o servidor HTTP. Nenhum processo ficou órfão (nenhum foi iniciado). O `world.db`
permanece no scratchpad, fora da worktree e fora do `~/.fusion` real.

## Estado dos três níveis de prova (execucao.md, seção 3) para a Onda 6b

| Nível | Status |
| --- | --- |
| Mecânico | Feito e verde na lane T6.5/fixer r1 (build/typecheck/lint/spec:report/testes afetados) |
| Vivo | Feito (2 personagens reais, nível 1→3, servidor+browser reais) e **reverificado nesta lane** contra o `world.db` |
| Olhado | Feito — 17 prints, todos olhados; 6 reabertos e conferidos linha a linha nesta lane |

## Arquivos

- Este relatório: `ficha3-reports/o6b/evidencia-viva-final.md`.
- Relatório original (mantido, não substituído): `ficha3-reports/o6b/evidencia-viva.md`.
- Prints: `ficha3-reports/o6b/prints/01..17-*.png`.
- Runbook corrigido: `docs/design/ficha-nivel3/gate-runbook.md` (commit desta lane).
