# Cobertura de conteúdo — Guerreiro (Fighter)

## 1. Ações básicas de combate — 14/14 (100%)

`referencias-uuid.json` tem 14 referências distintas a `actionspf2e.Item.*`: Recall Knowledge,
Raise a Shield, Shove, Escape, Reposition, Disarm, Hide, Take Cover, Leap, Reactive Strike, Trip,
High Jump, Long Jump, Demoralize.

`external/fusion-systems-2e/systems/pf2e/packs/actions-core/documents.json` tem **521** ações no
total. Cruzando por nome exato (Python): as **14/14** estão presentes. Nenhuma ausente.

Isso é só a existência do DOCUMENTO navegável (descrição em texto) — não confirma automação da
mecânica de cada ação (ex.: Trip/Disarm/Shove como MANOBRA executável — ver item 4 e
`docs-features.json`, mecanismo `MANEUVER`, que é ausente independentemente do documento existir).

## 2. Condições — 16/16 (100%)

`referencias-uuid.json` tem 16 referências distintas a `conditionitems.Item.*`: Off-Guard (16x),
Grabbed, Frightened (5x), Confused, Prone, Restrained, Stunned, Clumsy, Drained, Enfeebled,
Concealed, Hidden, Invisible, Undetected, Slowed, Quickened.

`external/fusion-systems-2e/systems/pf2e/packs/conditions/documents.json` tem **43** condições no
total. As **16/16** referenciadas pelo Guerreiro estão presentes. Nenhuma ausente.

De novo, presença no pack ≠ automação completa: Off-Guard já tem motor real (flatMod -2 CA +
rollOption, `conditions.ts:122-131`, toggle testado), mas a origem mais comum dele no kit do
Guerreiro — flanqueio — não é detectada automaticamente (zero hits de "flank" em
`packages/server/src`, `systems/pf2e/src`, `sheets/pf2e/src`); só o toggle manual funciona.

## 3. Efeitos — 0/4 (0%) — Fusion NÃO tem pack de efeitos, confirmado

`referencias-uuid.json` tem 4 referências: `feat-effects.Item.Effect: Assisting Shot`,
`feat-effects.Item.Effect: Guardian's Deflection`, `feat-effects.Item.Effect: Resounding Bravery`,
`other-effects.Item.Effect: Cover`.

`ls external/fusion-systems-2e/systems/pf2e/packs/` lista 15 packs (actions-core,
ancestries-core, ancestry-features-core, backgrounds-core, bestiary-core, classes-core,
class-features-core, conditions, equipment-core, familiar-abilities-core, feats-core,
heritages-core, spells-core, weapons-core, + build-report.json) — **nenhum chamado
`effects`/`feat-effects`/`other-effects`/`equipment-effects-core`**. Confirma o achado do
inventário do Animista: Fusion não publica pack de efeitos neste pin. Existe só o *tipo* de
documento (`schemas/item-effect.ts`, sem dados) e o motor de rule elements de efeito
(`engine-2e/src/effectsEngine.ts`) — nenhum dos dois é um pack de conteúdo.

Os 4 efeitos referenciados pelo Guerreiro: **0/4 existem** como documento.

## 4. Armas (`weapons-core`) — 30 armas, 11 grupos, `fatal` e `free-hand` ausentes

`external/fusion-systems-2e/systems/pf2e/packs/weapons-core/documents.json` tem **30** armas:
19 marciais, 10 simples, 1 avançada (Gnome Flickmace). Nenhum item de categoria `unarmed`
(esperado — ataques desarmados vêm de outro lugar, não deste pack).

**Grupos presentes (11):** sword(5), club(4), bow(4), axe(3), flail(3), crossbow(2), knife(2),
dart(2), hammer(2), spear(2), sling(1). O PF2e remaster tem 16 grupos de arma reais; **faltam
Bomb, Brawling, Firearm, Pick, Polearm e Shield** — 5-6 grupos fora do pack. Isso importa direto
para Fighter Weapon Mastery/Weapon Legend: um Guerreiro que quisesse maestria em Brawling
(desarmado sem trait monge), Polearm ou Firearm não tem arma nenhuma do grupo no jogo hoje —
e de qualquer forma a escolha de grupo em si está "pendente" (sem picker), então o ponto é
mais teórico que prático por ora.

**Contagem por trait relevante** (de 30 armas, por trait ou prefixo `trait-dX`):

| Trait | Contagem | Observação |
|---|---|---|
| `agile` | 5 | Dagger, Dart, Hatchet, Kukri, Shortsword |
| `finesse` | 5 | Dagger, Kukri, Rapier, Shortsword, Whip |
| `deadly` | 5 | Composite Longbow/Shortbow, Longbow, Shortbow (`deadly-d10`), Rapier (`deadly-d8`) |
| `fatal` | **0** | nenhuma arma do pack tem `fatal-dX` |
| `reach` | 3 | Bo Staff, Gnome Flickmace, Whip |
| `two-hand` | 2 | Bastard Sword (`two-hand-d12`), Staff (`two-hand-d8`) |
| `thrown` | 7 | Club, Dagger, Dart, Hatchet, Javelin, Spear, Trident |
| `free-hand` | **0** | nenhuma arma do pack tem esse trait |
| `shove` | 2 | Maul, Warhammer |
| `trip` | 4 | Bo Staff, Flail, Kukri, Whip |
| `disarm` | 3 | Flail, Rapier, Whip |

**O que falta:** `fatal` e `free-hand` são os dois buracos totais — nenhuma arma do pack carrega
esses traits, então qualquer talento/regra do Guerreiro que teste `fatal` (crítico com dado extra
maior) ou `free-hand` (lutar com a outra mão livre) não tem dado real para se apoiar, mesmo que a
lógica de dano crítico por trait (`deadly`/`fatal`) já esteja implementada no motor
(`strikes.ts:91-140,310-433`; `derivations/character.ts:909-971` — computam a fórmula de dano
crítico certa, incluindo `fatal`, e ela é postada como roll real no chat) — o motor sabe calcular
`fatal`, só não há nenhuma arma no pack para testar isso de ponta a ponta com dado real.
`weaponGroup` também está marcado `[V2]` reservado no schema (`item-weapon.ts:54`) e não há
suporte a predicado `item:group`/`item:category` no motor — a mecânica de "proficiência por
grupo" central ao Guerreiro (Fighter Weapon Mastery, Weapon Legend) não tem como ser avaliada
mesmo com os 11 grupos que existem.
