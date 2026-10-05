# Itens

Fontes AoN: Armor.aspx?ID=46 (Player Core p. 273); Weapons.aspx?ID=402 (Player Core p. 278); Equipment.aspx?ID=2829 (Striking) e ID=2830 (Weapon Potency), GM Core p. 236. Vendor: `equipment/chain-mail.json`, `war-flail.json`, `striking*.json`, `weapon-potency-*.json` (confere em todos os números).

## War Flail
| Campo | Valor |
|---|---|
| category / group | martial / flail |
| damage | 1d10 bludgeoning (B) |
| hands | 2 (held-in-two-hands) |
| traits | disarm, sweep, trip |
| bulk | 2 |
| price | 2 po |
| level | 0 |
| range / reload | melee, sem alcance (Grasping Reach dá `reach` 10 pés e rebaixa 1 passo o dado: d10 -> d8) |

## Chain Mail
| Campo | Valor |
|---|---|
| category / group | medium / chain |
| ac_bonus | +4 |
| dex_cap | +1 |
| check_penalty | -2 (em perícias de For/Des com armadura, exceto ataques) |
| speed_penalty | -5 pés |
| strength | 3 (se For menor, penalidades extras) |
| traits | flexible, noisy |
| bulk | 2 |
| price | 6 po |

Requisito de For (3 = modificador): com For +4 o Bhrotto cumpre, então a penalidade de check some e a de Velocidade cai 5 pés (regra geral de armadura, Player Core cap. de equipamento). Conferência da CA: 10 + nível 3 + 4 (armadura) + Des 0 (cap +1) + treinado 2 = **19** = PDF. Velocidade 25 = base Leshy.

## Runas de arma
| Runa | Nível | Preço | Efeito |
|---|---|---|---|
| Weapon Potency (+1) | 2 | 35 po | +1 bônus de item nas jogadas de ataque; 1 slot de runa de propriedade; craft: expert em Artesanato |
| Weapon Potency (+2) | 10 | 935 po | +2; 2 slots; master |
| Weapon Potency (+3) | 16 | 8.935 po | +3; 3 slots; legendary |
| Striking | 4 | 65 po | 2 dados de dano da arma |
| Striking (Greater) | 12 | 1.065 po | 3 dados |
| Striking (Major) | 19 | 31.065 po | 4 dados |

Regras: runas de potency/striking são "etched onto a weapon"; podem ser melhoradas pagando a diferença de preço. Slots de runas de propriedade = valor da potency (0 sem potency). Lista de runas de propriedade fora de escopo.

## Conferência com o PDF
Ataque: nível 3 + treinado 2 + For 4 = **+9** = PDF (sem runa de potency; o Ranger só chega a expert em armas no nível 5). Dano: striking = 2 dados: 2d10 + For 4 = **2d10+4** = PDF. Conferido.
