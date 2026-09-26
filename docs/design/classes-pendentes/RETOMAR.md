# Como retomar — classes pendentes (pausa de 26/09/2026)

## Onde está

- Satélite `xansde/fusion-systems-2e` `main`: tudo das Ondas 0–4 e da Onda 3P mergeado até o #268.
- Core `xansde/fusion` `alfa/app`: pina o satélite na **v0.3.6** (#271). O bump para a **v0.3.8**
  (a v0.3.7 quebrava o typecheck estrito; o satélite #277 corrigiu) está no **PR #272 do core**,
  com o CI rodando na pausa. Primeiro passo ao voltar: se o CI do #272 estiver verde, mergear.
  Falta também abrir o PR de PATCH-NOTES v0.3.7/v0.3.8 no satélite.
- Relatórios de cada lane e revisão: `.fusion-build/classes-pendentes/` (local).

## Estado por classe (nível 1–3)

| Grupo                | Estado                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 29 PF2e              | ficha completa; aceite externo depende dos moldes do Alexandre (Onda 5)                                               |
| 6 SF2e (Player Core) | ficha, escolhas de classe, conjuração Mystic/Witchwarper, sintonia do Solarian                                        |
| Daredevil            | chassi, Daring Stunt, talento bônus Risky; falta dano de proeza (#253)                                                |
| Slayer               | completo (Monster Lore, arsenal com efeito, 4 técnicas)                                                               |
| Luminary             | Spotlight/Roles/Platform/Star Maker; falta Stagecraft Spells (#260)                                                   |
| Mechanic             | Modify, eixos Exocortex e Custom Rig, Ingenuity; falta a mecânica do Exocortex (#262) e a restrição de perícia (#263) |
| Technomancer         | Overclock Gear, Jailbreak Spell, Programming Language; falta a conjuração inteira (#192)                              |

Personagens da mesa:

- **Clérigo + Kineticista da Água**: completo (#204).
- **Invocador 1 / Feiticeiro 2–3 (eidolon Dragão, Draconic)**: completo. No nível 3: PV 33;
  eidolon com CA 19, ataque +9, Fort 8, Ref 7; Dragon Breath 1d6 (escala pelo nível de classe do
  Invocador, REQ-MCL-020); Feiticeiro com Fear fixa.

## Decisões pendentes do Alexandre

1. **Stagecraft Spells do Luminary (#260)** — recomendação: pool de foco genérico + ação
   "recuperar 1 ponto com o roteiro" + as 15 magias como itens com nome e texto em aberto.
2. **Conjuração do Technomancer (#192)** — recomendação: reaproveitar o modelo preparado do
   Wizard (o Spell Database é um grimório que cresce +2 por nível); Spell Cache como magias
   adicionadas automaticamente; Download Spell como ação visível.
3. **Exocortex do Mechanic (#262)** — recomendação: Drone pelo mecanismo de companheiro;
   Mine como ações e contador; Turret como bloco de números na ficha do Mechanic, não como ator.
4. **Regra `canTakeNewClassAt`** (classe nova só no nível 1 ou em nível par): hoje só está no
   código. A build da mesa passa por ela. Falta registrar na spec 30 ou remover.
5. **Dragon Breath por nível de classe × nível de personagem**: hoje usa o nível de classe do
   Invocador; confirmar.

## Pendências registradas (sem decisão, dá para tocar)

- Satélite: #276 (menores das magias fixas), #253 (dano de proeza), #263, #261 (ordem de itens na
  multiclasse), #240 (prova de tela do dedup do misto), #235 (Walking Armory), #154 (idiomas por
  INT, core + satélite), #140, #103 (fólio do Commander), #202 (CI do satélite não roda o
  typecheck estrito do core — todo bump quebrou por isso).
- Core: #270 (operação em lote para a troca de classe atômica).

## Depende do Alexandre

- JSONs do Pathbuilder das classes sem molde (Onda 5), sendo feitos em outra sessão
  (PR #231 do satélite é dessa sessão).
