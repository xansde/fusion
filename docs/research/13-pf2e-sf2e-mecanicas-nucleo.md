# Mecânicas Centrais de PF2e (Remaster) e SF2e para Implementação Digital

> Pesquisa de insumo para as specs do projeto Fusion VTT.
> Fontes: Archives of Nethys (ORC), GitHub pf2e (Apache-2.0), documentação pública Paizo.
> Conteúdo proprietário do Foundry VTT NÃO foi copiado; comportamentos e algoritmos foram descritos com palavras próprias.

---

## 1. Economia de Ações (Action Economy)

### 1.1 Estrutura Básica

Cada turno de um personagem em encontro (encounter mode) concede exatamente **3 ações** e **1 reação**. As categorias são:

| Categoria | Quantidade | Quando |
|---|---|---|
| Action (ação) | 3 por turno | No próprio turno |
| Reaction (reação) | 1 por rodada | Fora do turno, quando gatilho ocorre |
| Free Action (ação gratuita) | Ilimitada* | Conforme especificado |

*Ações gratuitas com o mesmo gatilho geralmente têm limite de uma por gatilho.

### 1.2 Custo de Atividades

Atividades (activities) são combinações de ações:
- **1 ação**: mover, atacar, levantar escudo, sacar arma, abrir porta
- **2 ações**: a maioria das magias, Stride + Strike com certos feats, Seek enquanto se move
- **3 ações**: algumas magias poderosas, atividades complexas
- **Reação**: Reactive Strike (ex-Attack of Opportunity), bloqueio com escudo, magias de reação

### 1.3 Traits de Ação com Implicações Mecânicas

| Trait | Efeito Mecânico |
|---|---|
| **Attack** | Gera MAP; conta para o limite de MAP da rodada |
| **Flourish** | Apenas uma ação com este trait por turno |
| **Open** | Pode ser usada somente se nenhuma outra ação com trait attack foi feita no turno |
| **Press** | Pode ser usada somente se fez pelo menos um Strike no turno |
| **Stance** | Muda para um estado persistente; só uma stance ativa por vez |
| **Concentrate** | Substitui componente verbal; pode ser interrompido |
| **Manipulate** | Substitui componente somático; provoca Reactive Strike |
| **Move** | Ação de deslocamento; afetada por condições de movimento |

### 1.4 Multiple Attack Penalty (MAP)

Cada ataque adicional além do primeiro na mesma rodada sofre penalidade cumulativa:

| Ataque | Penalidade padrão | Com arma Agile |
|---|---|---|
| 1º | 0 | 0 |
| 2º | −5 | −4 |
| 3º+ | −10 | −8 |

O MAP se aplica à jogada de ataque, não ao dano. É resetado no início de cada turno do personagem.

---

## 2. Graus de Sucesso (Degrees of Success)

### 2.1 Quatro Graus

| Grau | Condição de Resultado |
|---|---|
| **Critical Success** | Resultado ≥ DC + 10 |
| **Success** | Resultado ≥ DC (mas < DC + 10) |
| **Failure** | Resultado < DC (mas ≥ DC − 10) |
| **Critical Failure** | Resultado < DC − 10 |

### 2.2 Modificações por Dado Natural

- **Natural 20**: resultado sobe um grau de sucesso (Critical Failure → Failure, Failure → Success, Success → Critical Success)
- **Natural 1**: resultado cai um grau de sucesso
- Estas modificações são aplicadas **antes** de quaisquer outros efeitos que alterem grau de sucesso

### 2.3 Basic Saving Throws

Quando uma magia ou efeito exige um "basic saving throw", os quatro graus têm efeitos padronizados de dano:
- Critical Success: 0 dano
- Success: metade do dano
- Failure: dano completo
- Critical Failure: dano dobrado

### 2.4 Relevância para o VTT

O motor do VTT precisa calcular automaticamente o grau de sucesso em **toda jogada de verificação** (checks de ataque, salvaguardas, perícias) e aplicar o efeito correto conforme o grau. A maioria das ações em PF2e tem quatro resultados distintos codificados.

---

## 3. Proficiência e Cálculo de Bônus

### 3.1 Sistema TEML

PF2e usa cinco ranks de proficiência. O bônus de proficiência é calculado como:

| Rank | Bônus de Proficiência |
|---|---|
| Untrained | +0 (sem nível somado) |
| Trained | +2 + nível do personagem |
| Expert | +4 + nível do personagem |
| Master | +6 + nível do personagem |
| Legendary | +8 + nível do personagem |

### 3.2 Fórmula Geral de Check

```
Resultado = d20 + modificador de atributo + bônus de proficiência + bônus situacionais + penalidades
```

Os bônus se classificam em tipos: **item**, **status**, **circumstance**, **untyped**. Bônus do mesmo tipo não se acumulam (usa-se o maior); apenas bônus de tipos diferentes se somam.

### 3.3 Fórmula de Class DC

```
Class DC = 10 + modificador do atributo-chave da classe + bônus de proficiência em class DC
```

### 3.4 Fórmula de Spell DC / Spell Attack

```
Spell DC = 10 + modificador do atributo de spellcasting + bônus de proficiência em spell attacks
Spell Attack = d20 + modificador do atributo de spellcasting + bônus de proficiência em spell attacks
```

---

## 4. Difficulty Classes (DCs)

### 4.1 Simple DCs por Proficiência

| Rank esperado | DC |
|---|---|
| Untrained | 10 |
| Trained | 15 |
| Expert | 20 |
| Master | 30 |
| Legendary | 40 |

### 4.2 Level-Based DCs (tabela parcial)

| Nível | DC | Rank de Magia | DC |
|---|---|---|---|
| 0 | 14 | 1 | 15 |
| 1 | 15 | 2 | 18 |
| 2 | 16 | 3 | 20 |
| 3 | 18 | 4 | 23 |
| 4 | 19 | 5 | 26 |
| 5 | 20 | 6 | 28 |
| 6 | 22 | 7 | 31 |
| 7 | 23 | 8 | 34 |
| 8 | 24 | 9 | 36 |
| 9 | 26 | 10 | 39 |
| 10 | 27 | — | — |
| 15 | 34 | — | — |
| 20 | 40 | — | — |

### 4.3 Ajustes de Dificuldade e Raridade

| Dificuldade | Ajuste | Raridade | Ajuste |
|---|---|---|---|
| Incredibly Easy | −10 | Common | 0 |
| Very Easy | −5 | Uncommon | +2 |
| Easy | −2 | Rare | +5 |
| Hard | +2 | Unique | +10 |
| Very Hard | +5 | | |
| Incredibly Hard | +10 | | |

---

## 5. Skills (Perícias)

### 5.1 Lista Completa com Atributo-Chave

| Skill | Atributo | Ações Principais |
|---|---|---|
| Acrobatics | Dexterity | Balance, Maneuver in Flight, Squeeze, Tumble Through |
| Arcana | Intelligence | Decipher Writing, Identify Magic, Recall Knowledge (arcane/constructs/dragons/elementals) |
| Athletics | Strength | Climb, Disarm, Grapple, High Jump, Long Jump, Reposition, Shove, Swim, Trip |
| Crafting | Intelligence | Craft, Earn Income, Identify Alchemy, Repair, Sabotage |
| Deception | Charisma | Create a Diversion, Feint, Lie, Impersonate |
| Diplomacy | Charisma | Gather Information, Make an Impression, Request |
| Intimidation | Charisma | Coerce, Demoralize |
| Lore | Intelligence | Earn Income, Recall Knowledge (área específica) |
| Medicine | Wisdom | Administer First Aid, Treat Disease, Treat Poison, Treat Wounds |
| Nature | Wisdom | Command an Animal, Identify Magic (primal), Recall Knowledge (animals/elementals/fey/fungi/plants) |
| Occultism | Intelligence | Identify Magic (occult), Recall Knowledge (aberrations/astral/dream/ethereal/occult creatures) |
| Performance | Charisma | Earn Income, Perform |
| Religion | Wisdom | Identify Magic (divine), Recall Knowledge (celestials/fiends/monitors/undead) |
| Society | Intelligence | Create Forgery, Decipher Writing, Recall Knowledge (humanoids/history/law), Subsist |
| Stealth | Dexterity | Conceal an Object, Hide, Sneak |
| Survival | Wisdom | Cover Tracks, Sense Direction, Subsist, Track |
| Thievery | Dexterity | Disable a Device, Palm an Object, Pick a Lock, Steal |

---

## 6. Combate: Strikes, Dano e Defesas

### 6.1 Tipos de Dano

**Dano Físico:**
- Bludgeoning (contundente)
- Piercing (perfurante)
- Slashing (cortante)

**Dano de Energia:**
- Acid, Cold, Electricity, Fire, Sonic

**Dano Especial/Mágico:**
- Force (energia mágica pura, raramente resistida)
- Spirit (afeta essência espiritual; substituiu dano de alinhamento no remaster)
- Void (drena vida; só afeta criaturas vivas)
- Vitality (cura vivos, dano em mortos-vivos; ex-positive energy)
- Mental, Poison, Bleed (físico persistente), Precision (amplifica dano existente)

### 6.2 Fórmula de Dano de Strike

**Corpo a corpo:**
```
Dano = dice da arma + modificador STR + bônus de runa (striking) + outros
```

**À distância:**
```
Dano = dice da arma [sem modificador de STR por padrão]
Propulsive: + metade do modificador de STR (se positivo)
Thrown: + modificador de STR completo
```

**Critical Hit:** dobrar o total de dano (incluindo modificadores, mas exceto efeitos especiais como fatal).

### 6.3 Traits de Arma Relevantes para o Motor

| Trait | Efeito |
|---|---|
| **Agile** | MAP reduzido (−4/−8 em vez de −5/−10) |
| **Deadly Xd#** | No crit, adiciona Xd# ao dano dobrado |
| **Fatal d#** | No crit, substitui o die da arma por d# e adiciona 1 die extra |
| **Finesse** | Pode usar DEX em vez de STR para ataque corpo a corpo |
| **Reach** | Aumenta alcance (geralmente de 5 para 10 pés) |
| **Thrown X** | Pode ser arremessada até X pés; usa STR para dano |
| **Versatile P/S/B** | Pode trocar tipo de dano |
| **Two-Hand d#** | Empunhado com duas mãos, troca die por d# maior |
| **Sweep** | +1 circunstancial em ataque se já atacou alvo diferente no turno |
| **Trip/Disarm/Grapple** | Arma pode usar o maneuver correspondente |

### 6.4 Immunities, Weaknesses, Resistances

Ordem de aplicação: **Imunidade → Fraqueza → Resistência**

- **Immunity**: ignora completamente o dano do tipo (ou condição)
- **Weakness X [tipo]**: ao receber dano do tipo indicado, adiciona X ao dano total
- **Resistance X [tipo]**: reduz dano do tipo indicado em X (mínimo 0)

Fraquezas e resistências se aplicam ao dano **após** qualquer multiplicação de critical hit.

### 6.5 Persistent Damage

Dano persistente ocorre no final de cada turno do alvo:
- Padrão: DC 15 flat check para acabar com o dano persistente no final do turno
- Assistência (apagar fogo, etc.): DC 10
- Depois de ~1 minuto fora de combate: encerra automaticamente
- Tipos comuns: bleed, fire, acid, electricity, poison

---

## 7. Condições Completas

### 7.1 Penalidades a Atributos

| Condição | Efeito Mecânico |
|---|---|
| **Clumsy X** | Penalidade de status −X em jogadas/DCs de DEX (AC, Reflex, ranged attacks, Acrobatics, Stealth, Thievery) |
| **Drained X** | Penalidade de status −X em jogadas/DCs de CON; perde HP = nível × X; max HP reduzido; reduz 1 por descanso |
| **Enfeebled X** | Penalidade de status −X em jogadas/DCs de STR (ataques corpo a corpo, dano, Athletics) |
| **Stupefied X** | Penalidade de status −X em jogadas/DCs de INT/WIS/CHA; ao conjurar magia: Flat Check DC 5+X ou magia falha |

### 7.2 Estados de Detecção

| Condição | Efeito |
|---|---|
| **Blinded** | Não enxerga; terreno é difícil; falha automática em Perception visual; imune a efeitos visuais; sobrepõe Dazzled |
| **Concealed** | DC 5 flat check para ser mirado; localização conhecida mas posição não |
| **Dazzled** | Criaturas/objetos são Concealed para o afetado se dependerem só de visão |
| **Deafened** | Falha automática em Perception auditiva; −2 penalidade em checks de som; ações auditory precisam DC 5 flat check; imune a auditory |
| **Hidden** | Espaço conhecido, posição não; alvo é Off-Guard; DC 11 flat check para mirar |
| **Invisible** | Undetected por todos; Seek pode detectar (DC vs Stealth); pode ficar Hidden se visto antes |
| **Observed** | Estado padrão; visível |
| **Undetected** | Presença no espaço desconhecida; Off-Guard contra o atacante; DC 11 flat check (rolado secretamente) |
| **Unnoticed** | Presença completamente desconhecida; também é Undetected |

### 7.3 Movimento e Ações

| Condição | Efeito |
|---|---|
| **Encumbered** | Clumsy 1; −10 pés de Speed (mínimo 5 pés) |
| **Grabbed** | Off-Guard + Immobilized; ações Manipulate requerem DC 5 flat check |
| **Immobilized** | Não pode usar ações com trait Move |
| **Paralyzed** | Off-Guard; só pode usar Recall Knowledge e ações mentais puras |
| **Prone** | Off-Guard; −2 penalidade em ataques; só Crawl/Stand como ações de mover; +4 contra ranged com Take Cover |
| **Quickened** | +1 ação por turno (uso limitado conforme fonte) |
| **Restrained** | Off-Guard + Immobilized + só Escape/Force Open; sobrepõe Grabbed |
| **Slowed X** | Reduz ações recuperadas por X no início do turno |
| **Stunned X** | Perde X ações; stunned diminui conforme ações são perdidas; sobrepõe Slowed |

### 7.4 Mental e Sensorial

| Condição | Efeito |
|---|---|
| **Confused** | Off-Guard; sem aliados; ataca/conjura aleatoriamente; recupera com DC 11 flat check ao receber dano |
| **Controlled** | Controlador dita todas as ações |
| **Fascinated** | −2 penalidade em Perception/perícias; ações concentrate devem se relacionar à fascinação; termina com ação hostil |
| **Frightened X** | Penalidade de status −X em todas as jogadas e DCs; reduz 1 por turno ao final |
| **Sickened X** | Penalidade de status −X em todas as jogadas e DCs; não pode ingerir itens voluntariamente; recupera com Fortitude vs DC (−1 em sucesso, −2 em crit) |

### 7.5 Combate

| Condição | Efeito |
|---|---|
| **Off-Guard** | −2 penalidade de circumstance na AC |
| **Persistent Damage** | Sofre X dano [tipo] ao final do turno; DC 15 flat check para encerrar |

### 7.6 Morte e Recuperação

| Condição | Efeito |
|---|---|
| **Doomed X** | Valor máximo de Dying é reduzido por X; Doomed 4 = morte imediata; reduz 1 por descanso completo |
| **Dying X** | Inconsciente; recovery check no início de cada turno (DC 10 + valor de dying); chega a 4 = morte |
| **Petrified** | Não pode agir/sentir; vira objeto (AC 9, Hardness 8, Bulk dobrado) |
| **Unconscious** | Não pode agir; −4 de status em AC/Perception/Reflex; Blinded + Off-Guard; não acorda se Dying a 0 HP |
| **Wounded X** | Aumenta 1 ao perder Dying; ao ganhar Dying, soma X ao valor inicial; encerra com Treat Wounds ou HP cheio + 10 min descanso |

### 7.7 Outras

| Condição | Efeito |
|---|---|
| **Fatigued** | −1 penalidade de status em AC e salvaguardas; não pode usar atividades de Exploration; encerra após descanso completo |
| **Fleeing** | Deve gastar ações fugindo da fonte; não pode Delay ou Ready |
| **Broken** (objetos) | Não funciona; armadura mantém bônus de AC mas aplica penalidade de status (−1 light, −2 medium, −3 heavy) |

---

## 8. Vida, Morte e Recuperação

### 8.1 Knocked Out

Quando um personagem chega a 0 HP:
- Ganha condição **Dying 1** (ou Dying 2 se causado por crit ou critical failure)
- Se o dano for não-letal: apenas Unconscious, sem Dying
- Instant death: HP negativos ≥ max HP total ou efeito de morte imediata

### 8.2 Recovery Check

No início de cada turno enquanto Dying, flat check (DC = 10 + valor atual de Dying):
- **Critical Success**: Dying −2
- **Success**: Dying −1
- **Failure**: Dying +1
- **Critical Failure**: Dying +2

Receber dano enquanto Dying: +1 ao Dying (ou +2 se crit).

### 8.3 Wounded e Progressão

- Ao perder o status Dying (qualquer forma): ganha Wounded 1 (ou +1 se já tiver)
- Ao ganhar Dying enquanto Wounded X: valor inicial de Dying é Dying (1 + X)
- Doomed X reduz o máximo de Dying antes da morte (Doomed 1 → morre em Dying 3)

### 8.4 Hero Points

- Máximo: 3 por sessão; concedidos pelo GM por roleplay exemplar
- **Gasto de 1**: reroll em uma jogada (deve usar o segundo resultado; fortune effect)
- **Gasto de todos** (mínimo 1): Heroic Recovery — perde condição Dying completamente, estabiliza com 0 HP
- Nenhum dos dois é uma ação; pode ser feito mesmo incapacitado

---

## 9. Magia (Spellcasting)

### 9.1 Tradições e Atributo-Chave por Classe

| Tradição | Descrição | Classes Principais |
|---|---|---|
| **Arcane** | Lógica; lista mais ampla; fraca em espírito/vida | Wizard, Magus, Witch (alguns) |
| **Divine** | Fé em deidades; forte em espírito e vida | Cleric, Champion (alguns), Oracle |
| **Occult** | Estudo do inexplicável; forte em mente e espírito | Bard, Psychic, Witch (alguns) |
| **Primal** | Conexão instintiva com natureza; forte em matéria e vida | Druid, Ranger (alguns), Primal Sorcerer |

### 9.2 Ranks de Magia

Magias existem em ranks 1–10. "Nível de magia" foi renomeado para "rank" no remaster.
- Cantrips: sempre heightened para metade do nível do personagem (arredondado para cima)
- Focus Spells: idem, sempre heightened automaticamente

### 9.3 Prepared vs. Spontaneous

| Tipo | Mecânica |
|---|---|
| **Prepared** | Prepara diariamente magias em slots de ranks específicos; cantrips ilimitados após preparados; slot consumido ao conjurar |
| **Spontaneous** | Conhece um repertório fixo de magias; conjura qualquer magia conhecida usando slots do rank correspondente; pode heighten gastando slot maior |
| **Innate** | Atributo padrão CHA; não concede status de conjurador para feats |

### 9.4 Focus Spells

- Pool separado de Focus Points (máximo 3, ou quantidade de focus spells conhecidas)
- Recuperam 1 ponto com Refocus (atividade de 10 min de exploração)
- Não podem ser usadas em spell slots normais
- Heightened automaticamente para metade do nível do personagem

### 9.5 Heightening

- **Prepared**: prepara em slot de rank maior que o mínimo da magia
- **Spontaneous**: conhece em rank alvo ou usa "signature spell" para heighten com slots maiores
- Heightened (+X): bônus cumulativo a cada X ranks acima do rank base

### 9.6 Counterspell / Counteract

Fórmula do counteract check:
```
Resultado = d20 + modificador do atributo de spellcasting + bônus de proficiência em spell attacks
```

Determinação de sucesso pelo grau:
| Grau | Resultado |
|---|---|
| Critical Success | Neutraliza se rank do alvo ≤ rank do efeito +3 |
| Success | Neutraliza se rank do alvo ≤ rank do efeito +1 |
| Failure | Neutraliza se rank do alvo < rank do efeito |
| Critical Failure | Falha |

Para criaturas/efeitos sem rank de magia: rank = nível ÷ 2 (arredondado para cima, mínimo 0).

### 9.7 Componentes (Remaster)

No remaster, os componentes verbais/somáticos/materiais foram removidos. Substituídos pelos traits:
- **Concentrate**: equivalente ao verbal (requer fala)
- **Manipulate**: equivalente ao somático (requer movimento de mãos)
- **Subtle** trait: modifica a regra geral de que magias exigem fala

---

## 10. Runas e Equipamento Mágico

### 10.1 Runas Fundamentais

| Runa | Aplica em | Efeito |
|---|---|---|
| **Weapon Potency +1/+2/+3** | Arma | Bônus de item no ataque; determina # de runas de propriedade |
| **Striking / Greater / Major Striking** | Arma | +1 / +2 / +3 dados de dano extra |
| **Armor Potency +1/+2/+3** | Armadura | Bônus de item na AC; determina # de runas de propriedade |
| **Resilient / Greater / Major Resilient** | Armadura | +1 / +2 / +3 bônus de item em salvaguardas |
| **Reinforcing** | Escudo | Aumenta Hardness, HP e BT |

### 10.2 Runas de Propriedade

- Concedidas por runas fundamentais: arma/armadura +1 → 1 propriedade; +2 → 2; +3 → 3
- Striking/Resilient não contam contra o limite
- Exemplos: Flaming, Corrosive, Holy, Vorpal, Speed, Shadow

### 10.3 Transferência de Runas

- Usa atividade Craft (1 dia)
- Custo = 10% do preço da runa (grátis de runestone)
- Runas fundamentais e de propriedade são categorias separadas

---

## 11. Bulk e Encumbrance

### 11.1 Valores de Bulk

| Classificação | Quantidade | Exemplos |
|---|---|---|
| **Bulk X** (número) | 1 Bulk = ~5–10 lbs | Armadura, armas de duas mãos |
| **L (Light)** | 10 L = 1 Bulk | Adaga, poção, tocha, corda |
| **— (Negligível)** | Não conta | Moedas individuais, papel |

### 11.2 Limites por STR

| Limiar | Bulk |
|---|---|
| Sem penalidade | ≤ 5 + modificador STR |
| Encumbered (Clumsy 1, −10 ft Speed) | 6 + mod STR a 10 + mod STR |
| Máximo absoluto | ≤ 10 + modificador STR |

### 11.3 Bulk por Tamanho de Criatura

| Tamanho | Bulk máximo "sem penalidade" |
|---|---|
| Tiny | 1 |
| Small | 3 |
| Medium | 6 |
| Large | 12 |
| Huge | 24 |
| Gargantuan | 48 |

Arrastar (dragging): trata o Bulk como metade.

---

## 12. Modos de Jogo

### 12.1 Encounter Mode

- Tempo em rodadas de 6 segundos
- Ordem de jogo: Iniciativa determinada por Perception (padrão) ou outra perícia conforme atividade de Exploration
- Cada criatura recebe 3 ações + 1 reação por rodada

### 12.2 Iniciativa

- Padrão: Perception check (1d20 + Perception modifier)
- Atividades de Exploration alteram a perícia usada:
  - **Avoid Notice**: usa Stealth; se bem-sucedido, pode iniciar como Hidden
  - **Scout**: +1 circunstancial à iniciativa de TODO o grupo
  - **Investigate**: usa Recall Knowledge como secret check para pistas

### 12.3 Exploration Mode

Fora de combate, sem rodadas formais. Velocidades de movimento:
- 10 pés Speed → 100 pés/min ou 8 milhas/dia
- 30 pés Speed → 300 pés/min ou 24 milhas/dia (padrão humano)
- Terreno difícil: metade; terreno muito difícil: um terço

**Atividades principais:**
- **Avoid Notice**: Stealth a half speed; inicia próximo combate com Stealth como iniciativa
- **Scout**: half speed; +1 initiativa para o grupo
- **Search**: Seek em busca de portas ocultas, armadilhas, criaturas; half speed
- **Investigate**: Recall Knowledge como secret check enquanto se move
- **Defend**: escudo levantado antes de iniciativa

### 12.4 Downtime Mode

Dias como unidade básica. Atividades de semanas/meses. Exemplos:
- **Craft**: mínimo 2 dias (1 com fórmula); depois reduz custo de materials por Income Earned table
- **Earn Income**: usa perícia relevante (Crafting, Lore, Performance, etc.)
- **Treat Wounds**: requer Medicine; cura HP fora de descanso
- **Refocus**: 10 min; recupera 1 Focus Point (mais pontos com feats)
- **Rest**: 8 horas; recupera HP = CON mod × nível; prepara magias

---

## 13. Recall Knowledge

### 13.1 Mecânica

- Ação de 1 ação durante encontro; atividade de exploração no Exploration Mode
- O GM rola a verificação em segredo (secret check)
- DC: level-based DC da criatura (ajustado por raridade)
- Sucesso: aprende atributo mais conhecido (immunidade notória, habilidade especial)
- Critical Success: aprende algo sutil (fraqueza pouco óbvia, gatilho de reação)

### 13.2 Mapeamento Criatura → Skill

| Trait da Criatura | Skill |
|---|---|
| Aberration | Occultism |
| Animal | Nature |
| Astral / Dream / Ethereal / Ooze / Occult / Spirit / Time | Occultism |
| Beast | Arcana ou Nature |
| Celestial / Fiend / Monitor / Shade / Undead | Religion |
| Construct | Arcana ou Crafting |
| Dragon | Arcana |
| Elemental | Arcana ou Nature |
| Fey / Fungus / Plant | Nature |
| Humanoid | Society |

---

## 14. Principais Mudanças do Remaster

O Remaster de 2023 (Player Core / GM Core) introduziu quebras de compatibilidade significativas:

| Área | Mudança |
|---|---|
| **Alinhamento** | Completamente removido. Holy/Unholy traits substituem bom/mau. Spirit damage substitui dano de alinhamento. |
| **Escolas de magia** | 7 de 8 escolas removidas (restou Illusion como trait). Wizards e Witches ganham novos frameworks. |
| **Componentes de magia** | Verbal/Somático/Material removidos. Substituídos pelos traits Concentrate e Manipulate. |
| **Linguagens** | 11 renomeadas: Abyssal→Chthonian, Aquan→Thalassic, Celestial→Empyrean, Infernal→Diabolic, Sylvan→Fey, etc. |
| **Class features** | Attack of Opportunity → Reactive Strike; Divine Spellcasting (cleric) → Cleric Spellcasting; Wild Empathy → Voice of Nature; etc. |
| **Ranks de magia** | "Level" de magia → "Rank" (1–10). Spell levels 1–10 sem alteração numérica, apenas nomenclatura. |
| **Positive/Negative energy** | → Vitality/Void damage |
| **Feats e magias** | Centenas renomeadas/mescladas: Scorching Ray→Blazing Bolt, Stunning Fist→Stunning Blows, etc. |

---

## 15. Starfinder 2e — Diferenças Mecânicas Principais

SF2e usa o mesmo motor do PF2e remaster como base, mas adiciona e modifica:

### 15.1 Base Compartilhada

- Economia de 3 ações + reação idêntica
- TEML proficiência + bônus por nível idêntico
- Degrees of success idênticos (natural 20/1 upgrade/downgrade)
- Conditions: mesma lista base; SF2e adiciona Untethered

### 15.2 Classes Exclusivas do SF2e

| Classe | Papel | Mecânica Distintiva |
|---|---|---|
| **Envoy** | Suporte/Líder | Directives de batalha; bônus a aliados; excelência social |
| **Mystic** | Conjurador/Curador | Vitality network; conexão cósmica (divine/occult/primal) |
| **Operative** | Precisão/Furtividade | Ação Aim: reduz cover do alvo, aplica dano de precisão |
| **Solarian** | Combatente Cósmico | Ciclo entre Graviton/Photon attunement; manifesta solar arms/armor |
| **Soldier** | Tanque/DPS de área | Armas de área; supressão; grande pool de HP |
| **Witchwarper** | Conjurador/Controle | Warp field de realidade alternada; distorce inimigos e ambiente |

### 15.3 Sistema de Armas Tecnológicas

**Tiers de qualidade (substitui runas):**

| Tier | Nível Aproximado | Custo de Upgrade |
|---|---|---|
| Commercial | 0 | — |
| Tactical | 2 | +350 cr |
| Advanced | 4 | +650 cr |
| Superior | 10 | +9.000 cr |
| Elite | 12 | +10.000 cr |
| Ultimate | 16 | +80.000 cr |
| Paragon | 19 | +300.000 cr |

**Traits únicos de armas SF2e:**
- **Tech**: eletrônica com fonte de energia; sujeito a glitch
- **Automatic**: pode disparar rajada (burst/full-auto), atingindo área ou múltiplos alvos
- **Area**: atinge todos em área; não requer roll separado por alvo
- **Tracking X**: bônus de item +X ao ataque (acumulado com tier de qualidade)
- **Analog**: não tem o trait Tech; não sujeito a efeitos tecnológicos adversos
- **Injection**: pode entregar veneno ou seringa por acerto
- **Line**: projétil em linha reta atingindo múltiplos alvos
- **Unwieldy**: não pode ser usada com MAP (apenas 1 ataque por turno)
- **Bright**: ilumina área ao disparar/na ponta
- **Seeking**: ignora penalidade de miss chance por concealment

**Munição e carregamento:**
- Armas tecnológicas usam cargas/células de energia (charges) ou projéteis
- Capacidade e ação de Reload especificadas por arma
- Custo: 10 projéteis por crédito (para armas de projéteis simples)

### 15.4 Habilidades Únicas do SF2e

Dois skills não existem no PF2e:
- **Computers** (INT): Hack, Access System, Recall Knowledge (tecnologia/IA)
- **Piloting** (DEX): Fly/Drive veículo ou nave, manobras avançadas

### 15.5 Gravidade

SF2e define ambientes de gravidade variável:

| Nível | Efeito |
|---|---|
| **Zero Gravity** | Clumsy 1 + Off-Guard + Untethered; capacidade de carga ×10; alcance de arremessadas ×10; voo natural inoperante salvo trait cosmic |
| **Low Gravity** | Saltador pode ir mais longe/alto; regras específicas por fonte |
| **Standard Gravity** | Normal |
| **High Gravity** | Bulk efetivo aumentado; penalidades à velocidade |

Movimento em zero-g requer: trait cosmic, propulsão (jetpack/thrusters), magia (fly/void vessel), ou Push Off de objeto próximo.

A condição **Untethered** é exclusiva do SF2e: criatura flutuando sem propulsão.

### 15.6 Cobertura (Cover) em SF2e

| Tipo | Bônus (AC, Reflex, Stealth) |
|---|---|
| **Lesser Cover** | +1 AC (concedida por criatura interposta) |
| **Standard Cover** | +2 AC, +2 Reflex, +2 Stealth; permite Hide |
| **Greater Cover** | +4 AC, +4 Reflex, +4 Stealth; obtida com Take Cover a partir de standard |

Regra de linha de efeito: traça linha do centro do atacante ao centro do alvo. Terreno bloqueante = standard cover; criatura interposta = lesser cover (exceto se a criatura for 2+ tamanhos maior → standard).

### 15.7 Créditos (Moeda)

SF2e usa créditos em vez de GP/SP/CP. Transações via credsticks.

### 15.8 Combate em Naves (Cinematic Starship Scenes)

Sistema de cenas de encontro especial:
- Ocorre em encounter mode (rodadas normais)
- Cada jogador escolhe um **papel na nave** (Captain, Engineer, Gunner, Magic Officer, Pilot, Science Officer)
- Papel determina skill usada para iniciativa
- Cada papel tem ações especiais de 2 ações; PC ainda tem 3 ações por turno
- Nave tem: AC, Fortitude/Reflex saves, Hull Points, Shield Points (regeneram por rodada)
- Ameaças (naves inimigas, megafauna, hazards) usam "rotinas pré-definidas"
- Vitória por: reduzir HP a 0, acumular Victory Points, sobreviver X rodadas
- Naves a 0 HP: desabilitadas (raramente destruídas)
- XP concedido independente de sucesso/fracasso

---

## 16. Automação no VTT: O Que Automatizar vs. Deixar Manual

### 16.1 Candidatos à Automação Total

| Mecânica | Complexidade de Impl. |
|---|---|
| Grau de sucesso (±10, nat20/nat1) | Baixa — algoritmo simples |
| MAP acumulado por turno | Baixa — contador por turno |
| Bônus de proficiência por rank+nível | Baixa — lookup table |
| Condições numéricas (Frightened, Sickened, etc.) | Média — decrementar por turno |
| Persistent damage (flat check DC 15) | Média — fim de turno automático |
| Dying/Recovery check | Média — flat check automático a cada turno |
| Wounded acumulando ao sair de Dying | Média — event listener |
| Immune/Weak/Resist aplicados ao dano | Média — lookup no stat block |
| Bulk encumbrance (soma de inventário) | Média — soma contínua |
| Spell slot tracking (prepared/spontaneous) | Média — contadores por rank |
| Focus Point tracking | Baixa — contador simples |
| Cantrips sempre disponíveis | Baixa |
| Heightening automático de cantrips/focus | Baixa — fórmula nível ÷ 2 |
| Level-based DCs para Recall Knowledge | Baixa — lookup table |
| Hero Points (max 3, reroll) | Baixa |
| Iniciativa por skill de exploração | Média — configurável por PC |

### 16.2 Candidatos à Automação Parcial (Com Input Manual)

| Mecânica | O Que Automatizar | O Que É Manual |
|---|---|---|
| Strikes (melee) | Rolar d20 + bônus, calcular dano, MAP | GM decide contexto (flanking, cobertura) |
| Strikes (ranged) | Rolar d20 + bônus, range penalty | Posicionamento no grid |
| Counteract check | Rolar + comparar ranks | GM decide qual efeito aplicar |
| Recall Knowledge | Rolar secretamente, apresentar resultado | GM escolhe qual informação revelar |
| Basic saving throws | Rolar, aplicar fórmula de dano por grau | — |
| Conditions de detecção | Rastrear estado Hidden/Undetected | Grid/posição de mapa |
| Crafting downtime | Calcular redução de custo | GM valida materiais e fórmulas disponíveis |
| Runes (transferência) | Rastrear slots disponíveis | Ação do GM/jogador para transferir |

### 16.3 Deixar Manual / Assistido

| Mecânica | Motivo |
|---|---|
| Roleplay e diálogos (Diplomacy, Deception, Intimidation) | Narrativo por natureza |
| Exploration activities (escolha do jogador) | Decisão de jogador |
| Flanking (posicionamento exato) | Requer grid ou julgamento do GM |
| Efeitos de crítico especial (weapon critical spec) | Podem variar muito por grupo de arma |
| Terrain e cobertura | Depende do mapa |
| Recall Knowledge: qual informação revelar | Exclusivo do GM |
| Cinematic Starship Scenes (SF2e) | Subsistema complexo, opcional |
| Zero-g movement (SF2e) | Depende de contexto de mapa |

### 16.4 Referência: Como o Sistema pf2e do Foundry Lida com Isso

O sistema oficial pf2e no Foundry (open-source, Apache-2.0) usa **Rule Elements** — instruções JSON aplicadas a itens. Tipos principais:

- **FlatModifier**: adiciona bônus/penalidade flat (item/status/circumstance)
- **AdjustModifier**: modifica modificadores existentes
- **ActiveEffectLike**: modifica dados do ator (add/subtract/override/upgrade/multiply)
- **ChoiceSet**: opções de escolha (feats com opções múltiplas)
- **DamageDice**: dados de dano adicionais (incluindo critical-only, persistent, splash)
- **AdjustDegreeOfSuccess**: altera grau de sucesso de rolls
- **RollOption**: cria flags condicionais para predicates
- **TokenImage**: troca imagem do token conforme estado

A abordagem do Fusion deve ser análoga: um sistema de "efeitos" ou "regras" aplicáveis a entidades (itens, feats, condições) que modificam os valores dos atores de forma declarativa, sem hardcode por caso.

---

## 17. Fontes Consultadas

1. [Action Economy — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=1026)
2. [Conditions — Archives of Nethys PF2e](https://2e.aonprd.com/Conditions.aspx)
3. [Hit Points, Healing, and Dying — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2319)
4. [Difficulty Classes — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2627)
5. [Level-Based DCs — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2629)
6. [Chapter 7: Spells — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2221)
7. [Focus Spells — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2228)
8. [Runes — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=3162)
9. [Fundamental Runes — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=3167)
10. [Damage Rolls — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2301)
11. [Degree of Success — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2286)
12. [Counteracting — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=3280)
13. [Recall Knowledge Rules — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2638)
14. [Skills — Archives of Nethys PF2e](https://2e.aonprd.com/Skills.aspx)
15. [Bulk — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2153)
16. [Exploration Mode — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2440)
17. [Traits — Archives of Nethys PF2e](https://2e.aonprd.com/Traits.aspx)
18. [Remaster Changes — GitHub foundryvtt/pf2e Wiki](https://github.com/foundryvtt/pf2e/wiki/Remaster-Changes)
19. [Rule Elements Quickstart — GitHub foundryvtt/pf2e Wiki](https://github.com/foundryvtt/pf2e/wiki/Quickstart-guide-for-rule-elements)
20. [Home — Archives of Nethys SF2e](https://2e.aonsrd.com/)
21. [Cover Rules — Archives of Nethys SF2e](https://2e.aonsrd.com/rules/420-cover)
22. [Zero Gravity — Archives of Nethys SF2e](https://2e.aonsrd.com/rules/928-zero-gravity)
23. [Cinematic Starship Scenes — Archives of Nethys SF2e](https://2e.aonsrd.com/rules/1179-cinematic-starship-scenes)
24. [Classes — Archives of Nethys SF2e](https://2e.aonsrd.com/classes)
25. [Weapon Tiers — Archives of Nethys SF2e](https://2e.aonsrd.com/rules/228-weapons)
26. [Starfinder 2E Player Core Review — Gaming Trend](https://gamingtrend.com/reviews/starfinder-2nd-edition-player-core-review-the-precision-of-pf2e-now-with-plasma-rifles/)
27. [Remaster Transition Guide — RPGBOT](https://rpgbot.net/p2/remaster-transition-guide/)
28. [RPGBOT Fundamental Math of PF2e](https://rpgbot.net/p2/characters/fundamental-math/)
29. [Hero Points — Archives of Nethys PF2e](https://2e.aonprd.com/Rules.aspx?ID=2333)
30. [PF2e DC Calculator](https://pf2calc.com/dc/)
