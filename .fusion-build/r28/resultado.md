# r28 — Resultado da sessão noturna (2026-08-10 → 2026-08-11)

Execução do plano `plano-sessao-noturna.md`. **Os 6 workstreams entregaram PR
contra `build/app`. MERGES CONCLUÍDOS em 2026-08-11 (autorização do Alexandre
na manhã seguinte): #102→#107 mergeados em sequência, cada um re-baseado com
resolução de conflito + CI verde antes do merge.**

> Nota de integridade: este arquivo foi deletado por engano durante a resolução
> do merge do #103 (um `git checkout HEAD -- .fusion-build` numa worktree cuja
> branch nasceu antes do commit do resultado) e restaurado na sequência — se
> você procurou o histórico e achou uma deleção no meio dos merges, foi isso.

## PRs (todos mergeados, CI verde em cada um)

| PR | Workstream | Entrega | Antes → Depois | CI |
|---|---|---|---|---|
| #102 | A4 Armas | weapons-core: todas as simples/marciais/avançadas não-mágicas PC1+PC2 + 12 firearms legadas | 42 → **132** | ✅ |
| #103 | A1 Armaduras/Escudos | packs novos `armor-core` + `shields-core` (conjunto-base não-mágico PC1∪PC2) | 0 → **12** / 0 → **4** | ✅ |
| #104 | A3 Arco PC2 | backgrounds +23, spells +48, pt-BR 100% | 43→**66** / 1262→**1310** | ✅ |
| #105 | A2 Bestiário | Monster Core inteiro, 95 traits novos, teste HP/AC vs vendor | 10 → **492** | ✅ |
| #106 | A6 Druid (piloto) | classes-core 14→**15**, features 302→**318**, feats 2121→**2205**, validação por mutação + fichas da Lini | — | ✅ |
| #107 | A5 Equipamento | equipment-core por régua de valor de mesa; 7 gaps de grant fechados | 18 → **249** | ✅ |

Estado final dos packs após os merges: armas 132, armor 12, shields 4,
backgrounds 66, spells 1310, bestiário 492, classes 15 (Druid), features 318,
feats 2205, equipment **249** (não os 250 do PR: a Clan Dagger duplicava com
weapons-core — pega pelo portão de duplicata na resolução do #107 e removida da
lista de grant-targets do A5; o grant do anão resolve via weapons-core).
Glossário final: **343 traits** (união dos 3 workstreams; nas 4 traduções
divergentes entre A2 e A4 — bulwark, comfort, backswing, ranged-trip — venceu a
primeira mergeada). Gate `documentDetails` final: 343.

Nota sobre as contagens do plano: os alvos "201 armaduras/118 escudos" e "~200
armas" eram totais do vendor INCLUINDO variantes mágicas/específicas; a curadoria
não-mágica real é menor (12+4 armaduras/escudos, 132 armas) — exclusões declaradas
em cada PR.

## O que o piloto A6 provou

Adicionar a 15ª classe custou **1 arquivo de curadoria + 4 linhas no planVM + 6
entradas no choiceSetInventory** — zero mudança em transform/build-mvp-subset. O
processo-fábrica da r22 está validado para as 12 classes restantes.

## Dívidas declaradas (consolidado)

- **A6/Druid**: vínculo ordem→focus spell (agora desbloqueado, #104 mergeado),
  companheiro animal (`pendente`, afeta 7 talentos), perícia da ordem não
  aplicada, Voice of Nature como lista literal, 10 talentos "* Mask" +
  Dedication fora.
- **A2/Bestiário**: sem prosa a traduzir (transform já zera descrições — Reserved
  Material sob ORC); texto mecânico dos 4.666 itens embutidos exigiria estender
  `PackI18nOverlaySchema` para itens aninhados (follow-up recomendado).
- **A5/Equipment**: ~1.285 consumíveis fora de potion/elixir/talisman, itens
  `magical`, nível > 8 — levas futuras; Orc Warmask com ChoiceSet `pendente`.
- **A4/Armas**: Blowgun excluída (schema não representa dano por munição);
  mágicas/específicas fora (17 identificadas e excluídas).
- **qa.mjs pré-existente**: 36 docs de Gunslinger/Psychic sem descrição (já era
  assim na build/app; fora de escopo da noite).

## Incidentes e lições (noite + manhã de merges)

1. **Disco C: chegou a 0 bytes livres** (476GB) e derrubou A1/A3/A4 no meio da
   extração. O disco já estava no limite ANTES da sessão; as 4 pipelines
   paralelas deram o golpe final. Correção: ~13GB liberados removendo 8
   worktrees antigas (verificadas limpas e mergeadas), `node_modules` órfãos e
   caches. Nenhum arquivo do usuário foi tocado. **O disco segue apertado —
   vale uma limpeza de verdade.**
2. **`out/` compartilhado por junction** virou o padrão: pipeline fresca gerada
   UMA vez no repo principal e compartilhada somente-leitura (pipeline real:
   extract → **normalize** → transform). O A6 estendeu: diretório local com
   junctions filho a filho quando precisa de transform local.
3. **Agentes morrem esperando notificação de background**: 4 de 6 pararam nessa
   armadilha. Regra: subagente roda gate longo em FOREGROUND.
4. **Bugs reais achados**: `strength: null` rejeitado pelo schema de armor
   (pós-processamento local no build-mvp-subset), Banshee com `speed null`
   (coagido para 0 no transform), traits `bulwark`/`comfort` ausentes do
   glossário (pego pelo CI).
5. **Lições da manhã de merges**: (a) `git restore --staged` no meio de um merge
   restaura do HEAD **da branch**, não do estado mesclado — foi assim que o
   weapons-core voltou a 42 armas por um commit (CI pegou via gap "Clan
   Dagger") e que este arquivo foi deletado; restaurar sempre com
   `--source=origin/build/app`. (b) O store do pnpm ficou com o mathjs
   corrompido (sequela do disco cheio): `pnpm install --force` NÃO conserta
   (confia no store); worktrees novas herdam o defeito — se o
   `grantMaterializer.test` falhar com `Cannot find module mathjs/...`, é isso,
   não regressão. CI é o verificador confiável enquanto o store não for
   recriado.

## Estado das worktrees

Merges concluídos — as worktrees `a1`–`a6` do scratchpad da sessão 113b3ccb já
podem ser removidas (`git -c core.longpaths=true worktree remove --force`).
Branches de feature preservadas no remoto (deleção é decisão do Alexandre).
