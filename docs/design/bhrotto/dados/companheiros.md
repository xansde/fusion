# Companheiros animais (remaster) — regras, estágios, Urso e Antílope

Fontes (AoN, ORC): Player Core pp. 206-207, 211 (Rules.aspx?ID=2113-2120, Actions.aspx?ID=2665 Support); Howl of the Wild p. 90 (AnimalCompanions.aspx?ID=84). Vendor (Apache-2.0, foundryvtt/pf2e) usado só para cruzar feats. Descrições em palavras próprias.

## (a) Regras gerais do companheiro jovem (young)

Traits: animal, minion. Só ganha ações se o dono usar **Command an Animal**: o companheiro recebe **2 ações** na vez do dono (substitui o efeito normal da ação e **dispensa o teste de Natureza**). Pode ter **1** companheiro por vez (exceção: Beastmaster, até 4, 1 ativo). Se morrer: 1 semana de downtime para substituir, sem custo.

| Campo            | Fórmula                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `level`          | = nível do dono                                                                                                                            |
| Atributos        | mods do tipo (stat block); sobem por estágio                                                                                               |
| `hp`             | `ancestryHP(tipo) + level × (6 + mod Con)`                                                                                                 |
| Prof. rank       | treinado (2) em: ataques desarmados, defesa sem armadura, barding, **todos os saves, Percepção, Acrobacia, Atletismo** + 1 perícia do tipo |
| Bônus de prof.   | `level + rank` (trained=2, expert=4, master=6, legendary=8)                                                                                |
| AC               | `10 + level + 2 + mod Des + bônus de item (max +3, só barding)`                                                                            |
| Fort / Ref / Von | `level + rank + mod Con / Des / Sab`                                                                                                       |
| Percepção        | `level + rank + mod Sab`                                                                                                                   |
| Perícia          | `level + rank + mod do atributo` (Acro=Des, Atl=For, Intim=Car, Surv=Sab)                                                                  |
| Ataque desarmado | `level + rank(trained=2) + mod For` (ou Des se `finesse`)                                                                                  |
| Dano desarmado   | dado do tipo (1 dado) + mod **For** (finesse não troca o dano)                                                                             |
| Itens            | só bônus de item em Velocidade e CA                                                                                                        |
| Limite           | não usa ações que exijam Int alta (Coerce, Decipher Writing) sem especialização                                                            |
| Support          | ação do companheiro: dono ganha o _Support Benefit_ do tipo; só pode usar movimentos básicos além disso; não vale se já agiu               |

Hunt Prey (Ranger com feat Animal Companion): o companheiro recebe os benefícios do Hunt Prey e do Hunter's Edge do dono (PC p. 127). Cavalgar: ver `montaria.md`.

## (b) Avanço (Player Core p. 211)

| Estágio                | Muda                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mature                 | Medium ou menor cresce 1 tamanho; For/Des/Con/Sab +1; Percepção e todos os saves -> expert; Intimidação, Furtividade, Sobrevivência -> treinado (se já treinado pelo tipo -> expert); dano desarmado de 1 para 2 dados. Ranger: feat _Mature Animal Companion_ (nível 6): 1 ação independente (Strike/Stride) na vez do dono sem Command       |
| Nimble (de mature)     | Des +2; For/Con/Sab +1; Acrobacia -> expert; +2 dano desarmado; ataques mágicos p/ resistências; aprende a Advanced Maneuver                                                                                                                                                                                                                   |
| Savage (de mature)     | cresce 1 tamanho se Medium-; For +2; Des/Con/Sab +1; Atletismo -> expert; +3 dano desarmado; mágico; aprende Advanced Maneuver                                                                                                                                                                                                                 |
| Incredible/Specialized | Specialized: ataques -> expert; saves/Percepção -> master; Des +1, Int +2; 2 dados -> 3 dados; extra 2->4 ou 3->6; + especialização (Ambusher, Bully, Daredevil, Racer, Tracker, Wrecker). "Incredible" é nome do feat de Ranger/Beastmaster que concede Specialized/avanço — NÃO CONFIRMADO o texto exato do feat (fora do escopo, nível 8+). |

Nota: o nome "Support Benefit dobra se nimble ou savage" vem do stat block (2d8 / 2d6).

## (c) Tipos

### Urso (Bear) — Player Core p. 207 (AoN Companions ID=70)

Size Small · Atrib For+3 Des+2 Con+2 Int-4 Sab+1 Car+0 · ancestry HP **8** · Perícia Intimidação · Sentidos visão na penumbra, faro (impreciso 30 pés) · Velocidade 35 · Ataques: jaws 1d8 P; claw (agile) 1d6 S · Support: até o início do próximo turno, cada Strike do dono que acerte criatura no alcance do urso causa +1d8 cortante do urso (2d8 se nimble/savage) · Advanced Maneuver: **Bear Hug** (requer último ataque = claw que acertou; novo claw no mesmo alvo; se acertar, alvo fica grabbed).

### Antílope (Antelope) — Howl of the Wild p. 90 (AoN ID=84)

Size **Medium ou Large** · Atrib For+2 Des+3 Con+2 Int-4 Sab+1 Car+0 · ancestry HP **6** · Perícia Sobrevivência · Sentidos visão na penumbra · Velocidade 40 · Especial: **mount** · Ataques: horns (finesse) 1d6 P; hoof (agile, finesse) 1d4 B · Support: até o início do próximo turno, enquanto o dono cavalga o antílope, seus Strikes que causem dano a criatura no alcance do antílope causam +1d6 sangramento persistente (2d6 se nimble/savage) · Advanced Maneuver: **Bounding Retreat** (Leap duas vezes; pode deixar o cavaleiro em espaço vazio ao sair).

## (d) Conferência nível 3 (Pathbuilder da nota)

| Campo                      | Fórmula                  | Calculado            | Pathbuilder | Bate? |
| -------------------------- | ------------------------ | -------------------- | ----------- | ----- |
| Urso PV                    | 8 + 3×(6+2)              | 32                   | 32          | sim   |
| Urso CA                    | 10+3+2+Des2              | 17                   | 17          | sim   |
| Urso Fort/Ref/Von          | 3+2+(Con2/Des2/Sab1)     | 7/7/6                | 7/7/6       | sim   |
| Urso Percepção             | 3+2+1                    | 6                    | 6           | sim   |
| Urso Jaws/Claw             | 3+2+For3                 | +8                   | +8          | sim   |
| Urso dano                  | 1d8+3 / 1d6+3            | idem                 | idem        | sim   |
| Urso Acro/Atl/Intim        | 5+Des2 / 5+For3 / 5+Car0 | 7/8/5                | 7/8/5       | sim   |
| Antílope PV                | 6 + 3×8                  | 30                   | 30          | sim   |
| Antílope CA                | 10+3+2+Des3              | 18                   | 18          | sim   |
| Antílope Fort/Ref/Von      | 5+(2/3/1)                | 7/8/6                | 7/8/6       | sim   |
| Antílope Percepção         | 5+1                      | 6                    | 6           | sim   |
| Antílope Horns/Hoof        | 5+**Des**3 (finesse)     | +8                   | +8          | sim   |
| Antílope dano              | 1d6+For2 / 1d4+For2      | idem                 | idem        | sim   |
| Antílope Acro/Atl/Surv     | 5+3 / 5+2 / 5+1          | 8/7/6                | 8/7/6       | sim   |
| Tamanhos / Vel. / sentidos | stat block               | Small 35 / Medium 40 | idem        | sim   |

Resultado: **todos os campos batem**, sem divergência. Observação: o Antílope jovem como Medium é escolha válida (tipo permite Medium ou Large); como o Leshy é Small, serve de montaria (precisa ser >= 1 tamanho maior). Ao virar mature cresce para Large.

## O que o vendor codifica

`animal-companion-ranger.json`: apenas ItemAlteration de descrição (Hunt Prey). `mature-animal-companion-ranger.json`: rules[] vazio (só prosa). Não há dados de tipo (Urso/Antílope) no vendor: as fórmulas acima são código a implementar no Fusion.
