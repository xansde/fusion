# Sonda de criação de ficha — grupo "marciais-subsistema" (Ranger, Gunslinger, Investigator, Thaumaturge, Commander, Guardian)

Fonte: `git show origin/feat/classes-necromancer-runesmith:systems/pf2e/packs/<pack>/documents.json` dentro de `external/fusion-systems-2e` (HEAD detached, leitura apenas). Packs lidos: `classes-core`, `class-features-core`, `feats-core`, `equipment-core`, `weapons-core`, `actions-core`.

## Achado transversal (afeta as 6 classes e provavelmente o pack inteiro)

Toda regra `GrantItem` em `class-features-core.json` e `feats-core.json` referencia UUIDs no namespace `Compendium.pf2e.<pack-oficial-do-foundry>.Item.<Nome>` (2541 ocorrências, 0 no namespace próprio `Compendium.fusion.*`). Exemplos verificados:

- `Hunt Prey` (Ranger) → grant aponta para `Compendium.pf2e.actionspf2e.Item.Hunt Prey`, mas o item real já existe localmente em `actions-core` com `_id: JYF1ZF6KDvPO5mVi` — a referência não usa esse id, é um link morto para um pack que não existe neste projeto.
- `Devise a Stratagem` (Investigator), `Intercept Attack` (Guardian), `Amulet` (Thaumaturge implement), `Way of the Pistolero` (Gunslinger), `Empiricism Methodology` (Investigator) — todos com o mesmo padrão de UUID não convertido.

Ou seja: mesmo as features SEM escolha (ex.: a ação básica de Guardian) não conseguem se auto-conceder na criação, porque o importador nunca reescreveu os UUIDs cross-compendium para o namespace do próprio projeto. Isso é mais caro que qualquer mecanismo específico de classe — é um defeito de importação sistêmico.

Segundo achado transversal: **zero `ChoiceSet`** existe em `class-features-core.json` ou `feats-core.json` (grep completo = 0 ocorrências). Toda escolha de subtipo (edge, way, methodology, tactic, implement) é implementada como um `GrantItem` cujo `uuid` é um template `{item|flags.system.rulesSelections.<nome>}` — ou seja, o dado espera que uma flag `rulesSelections.<nome>` já exista no item antes de resolver o grant, mas nada no pack popula essa flag (nenhum ChoiceSet, nenhum código de seleção). As opções candidatas (edges, ways, methodologies, implements) existem como documentos separados em `class-features-core`, mas a escolha em si não é processável — não há prosa nem ChoiceSet, é um buraco funcional.

## Por classe

### Ranger — VERMELHO
- Features 1-3: **3** (Hunter's Edge [1], Hunt Prey [1], Will Expertise [3]). Rules vazias: **1/3** (Will Expertise).
- Escolha exigida: qual Hunter's Edge (Flurry / Outwit / Precision — as 3 existem como `classFeature` separados). Não processável: `GrantItem` usa template `rulesSelections.huntersEdge` sem ChoiceSet em lugar nenhum do pack.
- Mecanismo específico: **Hunter's Edge** (escolha) + **Hunt Prey** (ação nomeada, grant quebrado — link morto `Compendium.pf2e.actionspf2e`).
- Talentos nível 1-2: 16 no pack, 4 com prerequisites não-vazio.
- Proficiências iniciais: `attacks`/`defenses` estruturados normalmente (martial/simple/unarmed weapons, light/medium armor). Sem item específico exigido.

### Gunslinger — VERMELHO
- Features 1-3: **3** (Gunslinger's Way [1], Slinger's Precision [1], Stubborn [3]). Rules vazias: **1/3** (Stubborn).
- Escolha exigida: qual Way (6 existem: Drifter, Pistolero, Sniper, Spellshot, Triggerbrand, Vanguard). Mesma falha — sem ChoiceSet, template `rulesSelections.way` nunca resolvido.
- Mecanismo específico: **Way** (escolha, não processável) + **arma de fogo nomeada**: `weapons-core` tem 30 armas e **zero** com traço `firearm` ou grupo `firearm` — não existe arma de fogo no pack inteiro, então nem a proficiência nem o item inicial do Gunslinger existem.
- Talentos nível 1-2: 14 no pack, 3 com prerequisites.

### Investigator — VERMELHO
- Features 1-3: **6** (On the Case [1], Methodology [1], Devise a Stratagem [1], Strategic Strike [1], Keen Recollection [3], Skillful Lessons [3]). Rules vazias: **1/6** (Skillful Lessons).
- Escolha exigida: qual Methodology (4 existem: Alchemical Sciences, Empiricism, Forensic Medicine, Interrogation) + perícia dirigida. Mesmo padrão sem ChoiceSet.
- Mecanismo específico: **Methodology** (escolha não processável) + **Devise a Stratagem**, a ação nuclear da classe, com `GrantItem` apontando para o mesmo link morto `Compendium.pf2e.actionspf2e`.
- Talentos nível 1-2: 15 no pack, 2 com prerequisites.

### Thaumaturge — VERMELHO
- Features 1-3: **5** (First Implement and Esoterica [1], Esoteric Lore [1], Implement's Empowerment [1], Exploit Vulnerability [1], Reflex Expertise [3]). Rules vazias: **1/5** (Reflex Expertise).
- Escolha exigida: qual Implemento — as 9 corretas existem como `classFeature` (Amulet, Bell, Chalice, Lantern, Mirror, Regalia, Tome, Wand, Weapon). Sem ChoiceSet, template `rulesSelections.implement` nunca resolvido.
- Mecanismo específico: **Implemento é ITEM** — cada implemento (ex.: Amulet) tenta conceder `Compendium.pf2e.equipment-srd.Item.Amulet Implement`, um item físico que **não existe em `equipment-core`** (18 itens no pack, nenhum é implemento). Ou seja, 2 falhas empilhadas: escolha não processável + item físico do implemento inexistente localmente.
- Talentos nível 1-2: 12 no pack, 2 com prerequisites.

### Commander — VERMELHO (mais caro do grupo)
- Features 1-3: **5** (Commander's Banner [1], Tactics [1], Drilled Reactions [1], Shield Block [1], Warfare Expertise [3]). Rules vazias: **2/5** (Drilled Reactions, Warfare Expertise).
- Escolha exigida: Banner + folio de Tactics (`firstTactic`/`secondTactic`, mais `thirdTactic`/`fourthTactic` só para Commander puro). Aqui a falha é pior que nas outras classes: busquei qualquer documento com o traço `tactic` em `feats-core` + `class-features-core` — **zero resultados**. Os itens com traço `commander` existem (43 feats), mas nenhum carrega o traço `tactic` que a mecânica real exige para ser elegível ao slot de Tactics. A categoria-alvo do grant simplesmente não existe no dado, não é só falta de ChoiceSet.
- Mecanismo específico: **Banner** (item/escolha) + **Tactics** (categoria de item inexistente) — 2 mecanismos, o segundo sem dado nenhum.
- Shield Block também presente (nível 1) mas sem escudo no `equipment-core` (ver Guardian).
- Talentos nível 1-2: 12 no pack, 0 com prerequisites.

### Guardian — AMARELO
- Classe existe no dado (confirmado, não é lacuna de pack).
- Features 1-3: **5** (Taunt [1], Guardian's Techniques [1], Shield Block [1], Guardian's Armor [1], Tough To Kill [3]). Rules vazias: **0/5**.
- Sem escolha de subtipo (não tem edge/way/methodology/tactic/implemento) — fluxo de criação é o mais próximo do genérico do grupo.
- Mecanismo específico único: **Shield Block** exige um escudo, e `equipment-core` (18 itens) **não tem nenhum escudo** — único gap específico de classe encontrado (fora do achado transversal de GrantItem quebrado que também a afeta).
- Talentos nível 1-2: 16 no pack, 2 com prerequisites.

## Conclusão de cor
Ranger, Gunslinger, Investigator, Thaumaturge e Commander = VERMELHO. Guardian = AMARELO (seria o único perto de VERDE se o achado transversal de GrantItem fosse resolvido).
