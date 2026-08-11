# r28 — Resultado da sessão noturna (2026-08-10 → 2026-08-11)

Execução do plano `plano-sessao-noturna.md`. **Os 6 workstreams entregaram PR
contra `build/app`. Nenhum merge foi feito — todos aguardam review humano.**

## PRs abertos

| PR | Workstream | Entrega | Antes → Depois | CI |
|---|---|---|---|---|
| #102 | A4 Armas | weapons-core: todas as simples/marciais/avançadas não-mágicas PC1+PC2 + 12 firearms legadas | 42 → **132** | ✅ pass |
| #103 | A1 Armaduras/Escudos | packs novos `armor-core` + `shields-core` (conjunto-base não-mágico PC1∪PC2) | 0 → **12** / 0 → **4** | ✅ pass (após 2 fixes, ver incidentes) |
| #104 | A3 Arco PC2 | backgrounds +23, spells +48, pt-BR 100% | 43 → **66** / 1262 → **1310** | ✅ pass |
| #105 | A2 Bestiário | Monster Core inteiro, 95 traits novos, teste HP/AC vs vendor | 10 → **492** | ✅ pass |
| #106 | A6 Druid (piloto) | classes-core 14→**15**, features 302→**318**, feats 2121→**2205**, validação por mutação + fichas da Lini | — | ✅ pass |
| #107 | A5 Equipamento | equipment-core por régua de valor de mesa; 7 gaps de grant fechados | 18 → **250** | ✅ pass |

Nota sobre as contagens do plano: os alvos "201 armaduras/118 escudos" e "~200
armas" eram totais do vendor INCLUINDO variantes mágicas/específicas; a curadoria
não-mágica real é menor (12+4 armaduras/escudos, 132 armas) — exclusões declaradas
em cada PR.

## O que o piloto A6 provou

Adicionar a 15ª classe custou **1 arquivo de curadoria + 4 linhas no planVM + 6
entradas no choiceSetInventory** — zero mudança em transform/build-mvp-subset. O
processo-fábrica da r22 está validado para as 12 classes restantes.

## Dívidas declaradas (consolidado)

- **A6/Druid**: vínculo ordem→focus spell (depende do merge do #104), companheiro
  animal (`pendente`, afeta 7 talentos), perícia da ordem não aplicada, Voice of
  Nature como lista literal, 10 talentos "* Mask" + Dedication fora.
- **A2/Bestiário**: sem prosa a traduzir (transform já zera descrições — Reserved
  Material sob ORC); texto mecânico dos 4.666 itens embutidos exigiria estender
  `PackI18nOverlaySchema` para itens aninhados (follow-up recomendado).
- **A5/Equipment**: ~1.285 consumíveis fora de potion/elixir/talisman, itens
  `magical`, nível > 8 — levas futuras; Orc Warmask com ChoiceSet `pendente`.
- **A4/Armas**: Blowgun excluída (schema não representa dano por munição);
  mágicas/específicas fora (17 identificadas e excluídas).
- **Merges da manhã**: conflitos triviais esperados entre PRs na contagem do gate
  de traits (`documentDetails.test.ts`: #102 → 255, #103 → 240, #107 → 243), no
  glossário e na lista de gaps do `grantMaterializer` — mergear em sequência e
  re-rodar `gen-client-maps.mjs` + ajustar o gate uma vez no final.
- **qa.mjs pré-existente**: 36 docs de Gunslinger/Psychic sem descrição (já era
  assim na build/app; fora de escopo da noite).

## Incidentes e lições da noite

1. **Disco C: chegou a 0 bytes livres** (476GB) e derrubou A1/A3/A4 no meio da
   extração. O disco já estava no limite ANTES da sessão; as 4 pipelines
   paralelas (cada uma gerando `out/` próprio) deram o golpe final. Correção:
   ~13GB liberados removendo 8 worktrees antigas (todas verificadas limpas e
   mergeadas antes), `node_modules` órfãos e caches; `wt-isekai-2` (em `main`)
   preservada por cautela. **Nenhum arquivo do usuário foi tocado.**
2. **`out/` compartilhado por junction** virou o padrão: pipeline fresca gerada
   UMA vez no repo principal (mesmo commit-base das branches) e compartilhada
   somente-leitura — economiza ~1GB e ~20 min por worktree. O A6 estendeu o
   padrão: diretório local com junctions filho a filho quando precisa de
   transform local sem poluir o compartilhado.
3. **Errata do plano**: a pipeline real é extract → **normalize** → transform
   (o normalize faltava no plano original).
4. **Agentes morrem esperando notificação de background**: 4 dos 6 agentes
   pararam "esperando o monitor/notificação" de um comando em background — o
   processo encerra e ninguém acorda. Regra para as próximas rodadas: subagente
   roda gate longo em FOREGROUND com timeout generoso, sempre.
5. **Bugs reais achados pelos agentes**: `strength: null` rejeitado pelo schema
   de armor (contornado com pós-processamento local no build-mvp-subset),
   Banshee com `speed null` no vendor (coagido para 0 no transform), traits
   `bulwark`/`comfort` ausentes do glossário (pego pelo teste de cobertura no
   CI; consertado pelo orquestrador).

## Estado das worktrees

`a1`–`a6` no scratchpad da sessão 113b3ccb permanecem vivas (com vendor/out por
junction) para eventuais ajustes de review — remover depois dos merges com
`git -c core.longpaths=true worktree remove --force <path>`.
