# Pesquisa: Starfinder 2e no Foundry VTT — Estado Atual e Relação com PF2e

> Documento de pesquisa para o projeto Fusion (VTT próprio).
> Escopo: Suporte ao Starfinder 2e no Foundry VTT, compatibilidade mecânica com PF2e, dados abertos e implicações arquiteturais.
> Data de referência: junho de 2026.

---

## 1. Estado do Suporte ao SF2e no Foundry VTT

### 1.1 Linha do Tempo

| Fase | Período | Descrição |
|---|---|---|
| Playtest (Field Test) | 2023–2024 | Módulo `starfinder-field-test-for-pf2e` — extensão sobre o sistema PF2e no Foundry |
| Módulo de transição | 2024–2025 | `sf2e-anachronism` — módulo sobre PF2e com conteúdo exclusivo de SF2e; repositório temporário em `TikaelSol/sf2e-anachronism` |
| Sistema próprio (GA) | 2025–presente | `sf2e` — sistema independente no Foundry, hospedado no repositório `foundryvtt/pf2e` |

### 1.2 Estado Atual (2026)

O **Starfinder Second Edition** possui, desde 2025, um **sistema Foundry próprio** (`sf2e`), separado do `pf2e` do ponto de vista de identidade (`"id": "sf2e"`), mas **hospedado no mesmo repositório GitHub** (`foundryvtt/pf2e`). As duas implementações compartilham codebase em TypeScript, infraestrutura de build e parte do engine de regras.

Dados do sistema em junho de 2026:

- **Versão mais recente:** 1.2.0 (system.sf2e.json no branch `v14-dev`)
- **Compatibilidade:** Foundry VTT 14.360+ (verificado em 14.363)
- **Versão anterior (Foundry 13):** 0.0.10 (Foundry 13.348+)
- **Pacote oficial:** [foundryvtt.com/packages/sf2e](https://foundryvtt.com/packages/sf2e)
- **Designação:** parceria oficial entre Foundry Gaming LLC e Paizo Inc.
- **Equipe:** SF2e For Foundry VTT Volunteer Development Team (voluntários)
- **Distribuição:** gratuita, com endorsement da Foundry Gaming LLC

### 1.3 Relação com o PF2e — Evolução das Implementações

#### Fase playtest: módulo sobre PF2e

O `starfinder-field-test-for-pf2e` foi um **módulo Foundry** que rodava sobre o sistema `pf2e`. Não era um sistema independente. O repositório `TikaelSol/starfinder-field-test` registra 25 releases e teve atividade até maio de 2026 (release 10.0.2), indicando que ainda é mantido para usuários que queiram rodar o playtest.

#### Fase de transição: sf2e-anachronism

O `sf2e-anachronism` foi um repositório temporário criado para hospedar o **módulo de conteúdo SF2e para mundos PF2e** enquanto o sistema sf2e próprio não estava pronto. O README do repositório (`TikaelSol/sf2e-anachronism`) confirma:

- O repositório **não é mais mantido** ativamente.
- Issues e correções de conteúdo devem ser submetidos ao repositório upstream PF2e.
- A transição para o usuário final seria transparente — uma mudança de manifest URL durante um update futuro.
- O módulo **não incluía** conteúdo já publicado para Pathfinder, apenas exclusivos de SF2e.

#### Sistema atual: sf2e como sistema próprio

O `system.sf2e.json` no branch `v14-dev` do repositório `foundryvtt/pf2e` define o SF2e como sistema distinto:

- ID único: `"sf2e"`
- Scripts próprios: `vendor.mjs` e `sf2e.mjs`
- Stylesheet própria: `sf2e.css`
- Arquivo de overrides de tradução: `lang/sf2e-overrides-en.json`
- **26 compendium packs** exclusivos de SF2e (Alien Core bestiary, Starfinder Society, etc.)
- Uma curiosidade: o pack `bestiary-effects` referencia `"system": "pf2e"` — indicando definições de efeitos ainda compartilhadas entre os dois sistemas.

O codebase principal é **TypeScript (84,7%)** com Handlebars, SCSS e Svelte. O repositório tem 237 releases, 32.562 commits e estava em versão 8.2.0 (PF2e) em junho de 2026, com changelog separado (`CHANGELOG (SF2E).md`) para o SF2e.

---

## 2. Compatibilidade Mecânica SF2e × PF2e

### 2.1 Fundação Compartilhada

O Starfinder 2e foi desenhado pela Paizo para usar **o mesmo motor do Pathfinder 2e Remaster**:

- Sistema de três ações (three-action economy)
- Proficiências (Untrained → Legendary)
- Estrutura de ancestralidade + background + classe
- Feats como moeda universal de customização (classes usam "feats", não termos proprietários como "improvisations" ou "exploits")
- Condições e sistema de modificadores (circumstance, status, item)
- Ações básicas compartilhadas

A Paizo declarou explicitamente que SF2e é "fully compatible with Pathfinder 2nd Edition and the Remaster Project".

### 2.2 O Que é Compartilhado

| Elemento | Compartilhado PF2e ↔ SF2e |
|---|---|
| Economy de ações (3 ações/reação) | Sim |
| Sistema de proficiências | Sim |
| Estrutura de feats | Sim (mesma terminologia) |
| Condições base (off-guard, flat-footed, etc.) | Sim |
| Estrutura de ancestralidade + heritage | Sim (chamadas "species" no SF2e mas mecânica igual) |
| Skill list base | Quase igual (SF2e adiciona habilidades sci-fi) |
| Sistema de magias/spells | Sim (Mystic e Witchwarper usam o mesmo framework) |
| Regra de variante: Proficiency Without Level | Sim |
| Regra de variante: Free Archetype | Sim |

### 2.3 O Que Difere — Mecânicas Exclusivas do SF2e

#### Augmentações (Augmentations)

Sistema inexistente no PF2e. Permite modificações tecnológicas e biológicas no corpo do personagem:

- **Limite:** 4 augmentações implantadas simultaneamente (apex augmentations não contam)
- **Tipos:** Biotech (biológico), Cybernetics (circuitos/máquinas), Magitech (híbrido mágico-tecnológico), Apex (bônus de atributo)
- **Instalação:** cirurgião ou Medicine master; 1 hora por 2 item levels
- **Vinculação:** coded ao corpo do personagem — não podem ser revendidas ou transferidas
- **Ativação:** algumas contínuas, outras requerem interação/concentração

Implica um novo tipo de item no data model e novas regras de equipamento/inventário.

#### Zero-Gravidade

Regras exclusivas para ambientes zero-g:

- Personagens em zero-g ganham automaticamente: **clumsy 1, off-guard e untethered**
- Capacidade de carga aumenta 10×; alcance de armas arremessadas aumenta 10×
- Movimento: personagens **não se movem** sem propulsão (jetpack, magia, ação "Push Off")
- Criaturas com fly Speed natural **não podem** usar esse speed em zero-g (exceto com o trait "cosmic")
- Propulsão disponível: jetpacks, thrusters, feitiços (*fly*, *void vessel*), Push Off (objetos próximos)

Implica novos estados de mapa/ambiente e condições no engine.

#### Combate em Naves Estelares (Starship Combat)

SF2e possui dois sistemas de combate naval:

**Cinematic Starship Combat** (GM Core, disponível agora):
- Naves tratadas como **hazards complexas** (complex hazards)
- Personagens assumem papéis na nave (piloto, atirador, engenheiro, etc.) com ações específicas
- Combate resolve por condições de vitória (victory conditions)
- Power Core trait determina limite de ações poderosas por turno

**Tactical Starship Combat** (Tech Core, lançamento outubro 2026):
- Sistema tático completo com grid
- Regras de construção, tripulação e upgrades de naves
- Naves inimigas de exemplo e hazards espaciais

Implica um subsistema de combate completamente diferente do combate padrão, com suas próprias regras de iniciativa e resolução.

#### Hacking como Hazard

Sistemas de computador são tratados como **hazard encounters** dinâmicas. Os personagens interagem com a rede/computador como se fosse um encontro de dungeon, com ações específicas para hackear, defender e comprometer sistemas. Mecânica inexistente no PF2e base.

#### Veículos Terrestres

Regras para veículos como o enercopter e outros. Estrutura ainda em desenvolvimento (Tech Core trará mais).

#### Ambiente e Condições Espaciais

Mecânicas de ambiente únicas no SF2e:

| Condição/Ambiente | Regra |
|---|---|
| Vácuo | 1d6 bludgeoning/round + sufocação imediata |
| Descompressão | 3d6 bludgeoning extra ao transitar de pressurizado para vácuo |
| Radiação | Poison effect com 4 níveis (low/medium/high/severe); afeta CON, pode causar radiation sickness |
| Atmosfera espessa | Fortitude DC 15+1/check por hora; falha = sickened |
| Proteção ambiental | Armor concede proteção em atmosferas thin/thick, vácuo e líquido não-hazardoso |

#### O Drift (Plano de Hyperspace)

Mecânica de viagem interestelar via plano alternativo:

- Acesso via Drift Engines (tecnologia pura)
- Navegação baseada em Drift Beacons; Near Space vs. the Vast (distâncias)
- Pós-Drift Crisis (AG 321): Drift Lanes permitem viagem ainda mais rápida
- Magias de summoning e planar gates **não funcionam** no Drift

Implica um sistema de viagem/exploração em escala galáctica.

#### Crafting com Tecnologia de Fabricação

Crafting em SF2e é significativamente mais rápido que em PF2e devido a tecnologia de fabricação (fabricators). O sistema de aquisição de itens também é diferente — busca via Infosphere e entrega por drones.

#### Economia de Itens Tech

Armas de energy (laser rifles, plasma weapons, etc.) têm perfis mecânicos distintos de armas físicas. Armor do futuro é superior à armor medieval em termos de proteção base. O sistema de itens tem propriedades como "tracking" e "area" em weapons que não existem no PF2e.

### 2.4 Classes do SF2e (Player Core — 2025)

O Player Core lançado em julho de 2025 inclui 6 classes, nenhuma delas existente no PF2e:

| Classe | Descrição |
|---|---|
| **Envoy** | Líder de suporte; bônus para aliados via "directives" |
| **Mystic** | Spellcaster com conexão divina/ocult/primal do universo |
| **Operative** | Combatente preciso; usa Aim action para dano por precisão |
| **Solarian** | Guerreiro que canaliza ciclos cósmicos (stellar energy) |
| **Soldier** | Especialista em armas e HP alto |
| **Witchwarper** | Altera realidade via possibilidades de universos paralelos |

O Tech Core (outubro 2026) adicionará duas novas classes:

- **Mechanic** — engenheiro com augmentações cybernéticas e drone companion
- **Technomancer** — hacker que combina magia e software

### 2.5 Ancestralidades (Species)

O Player Core inclui 10 species (chamadas "ancestries" mecanicamente):

Android, Barathu, Human, Kasatha, Lashunta, Pahtra, Shirren, Skittermander, Vesk e Ysoki.

Mais 2 versatile heritages: Borai e Prismeni (tocados pela energia do Drift).

O suplemento *Galactic Ancestries* (2026) adiciona 21 novas species. O mecanismo de "standardized ancestry feats" permite que features fisiológicas compartilhadas entre species sejam expressas com o mesmo feat — reduzindo duplicação de dados.

---

## 3. Dados do SF2e em Formato Aberto

### 3.1 Licença ORC

O Starfinder 2e foi lançado completamente fora da OGL (Open Game License) e adota a **ORC License (Open RPG Creative License)**, em alinhamento com o Pathfinder Remaster. Pontos-chave:

- Mecânicas de jogo designadas como "Licensed Material" sob a ORC podem ser usadas em publicações ORC de terceiros
- Material reservado inclui: trademarks, personagens, localizações, organizações, deidades, eventos, arte e mapas da Paizo
- **Exceção importante:** produtos publicados na plataforma Starfinder Infinite **não** podem republicar conteúdo como Licensed Material sob a ORC — esse ecossistema é fechado

### 3.2 Archives of Nethys (SRD Oficial)

Todo o conteúdo publicado do Starfinder 2e está disponível gratuitamente no **Archives of Nethys SF2e** ([2e.aonsrd.com](https://2e.aonsrd.com)):

- Ancestralidades, backgrounds, classes, feats, spells, items, hazards, bestiários
- Regras de ambiente (zero-g, vácuo, radiação, atmosferas)
- Regras de combate de naves (cinematic)
- Regras de augmentações
- Interface web de consulta

O AoN não expõe uma API de dados estruturada ou exportação JSON oficial. O conteúdo é HTML renderizado a partir de dados internos.

### 3.3 Dados no Repositório foundryvtt/pf2e

O repositório `foundryvtt/pf2e` (Apache-2.0) contém os **compendium packs do SF2e em formato JSON** compilável:

- Dados armazenados como JSONs individuais por entry
- Build tool compila para LevelDB (formato runtime do Foundry v11+)
- Estrutura de cada entry: `_id`, `name`, `type`, `img`, `system`, `folder`
- Campo `system.rules` contém Rule Elements codificados como JSON
- Campo `system` varia por tipo (actor, item, effect, etc.) — schema definido por TypeScript
- Metadados de publicação incluem: `license` ("ORC"), `remaster`, `title`
- IDs são base62 de 16 caracteres — estáveis; nunca alterar após criação

Estes dados são **open source sob Apache-2.0** e podem ser usados no Fusion como referência para estrutura e como base de importação de conteúdo.

---

## 4. Arquitetura do Engine de Regras PF2e/SF2e no Foundry

### 4.1 Rule Elements — O Coração do Engine

O sistema PF2e/SF2e no Foundry usa **Rule Elements (REs)** como mecanismo central de automação de regras. Cada RE é uma entrada JSON no campo `system.rules` de um item, processada pelo engine no momento de preparação do actor.

Fluxo de processamento:
1. Actor data é preparada
2. O sistema itera todos os items do actor
3. Para cada item: instancia subclasses de `RuleElement` a partir de `system.rules`
4. REs são aplicados por ordem de `priority` (default 100; menor = primeiro)
5. Resultado: actor stats finais, com todos os modificadores aplicados

Propriedades base de todo RE:
- `key` — tipo do RE (ex: `"FlatModifier"`, `"AELike"`, `"RollOption"`)
- `priority` — ordem de execução
- `predicate` — lógica condicional (quando o RE se aplica)
- `requiresEquipped` / `requiresInvestment` — enforcement de estado do item

### 4.2 Categorias de Rule Elements

| Categoria | Exemplos de uso |
|---|---|
| Modifiers & Statistics | bônus de attack, dano, speeds, caps de atributo |
| Strikes & Combat | novas ações de ataque, grants de proficiência, efeitos críticos |
| Grants & Effects | itens concedidos automaticamente, efeitos temporários, cura |
| IWR | immunities, weaknesses, resistances |
| Senses & Token | tipos de visão, mudanças de token appearance |
| Actor Properties | traits, size, auras, battle forms |
| Special Resources | focus points, hero points, recursos limitados |

### 4.3 Extensibilidade

Módulos podem registrar **tipos customizados de RE** via `RuleElements.custom`. Isso permite extensão do engine sem modificar o core — relevante para o Fusion implementar mecânicas proprietárias de SF2e (augmentações, zero-g, etc.) como extensões do engine base.

### 4.4 Compendium Data Pipeline

```
JSON files (fonte) → build tool → LevelDB packs (runtime Foundry)
```

O processo inverso para edição:
```
Edição no Foundry (UI) → extractPacks → JSON files (diff para PR)
```

Links entre entries usam `@UUID` referenciando nomes (não IDs) para resiliência. O build tool resolve nomes para IDs no momento da compilação.

---

## 5. Implicações para o Fusion

### 5.1 Viabilidade de Motor 2e Compartilhado

A evidência do projeto real (`foundryvtt/pf2e`) confirma que **um motor 2e unificado para PF2e e SF2e é viável e foi a abordagem escolhida pela comunidade Foundry**. Os dois sistemas rodam no mesmo TypeScript engine com:

- Rule Elements compartilhados
- Pipeline de compendium compartilhado
- Actor e Item schemas base compatíveis
- Compendium packs separados por sistema

Para o Fusion, a estratégia análoga seria:

- **Core engine:** motor de regras 2e compartilhado (three-action economy, proficiências, condições, Rule Elements)
- **Data packs separados:** `pf2e-core`, `sf2e-core`, `etmos-core`
- **Feature flags / subsystems:** módulos opcionais ativados por sistema (ex: augmentações, starship combat, zero-g, Drift travel)

### 5.2 Mecânicas SF2e que Exigem Extensão do Engine Base

As seguintes mecânicas do SF2e **não existem no PF2e** e precisarão de implementação específica no Fusion:

| Mecânica | Impacto no Engine |
|---|---|
| Augmentações (4 slots, body-coded) | Novo tipo de item; lógica de slot/limite |
| Zero-gravidade (condições automáticas de mapa) | Ambiente/zona no canvas que aplica condições |
| Combate de naves (cinematic/tático) | Subsistema de combate alternativo |
| Hacking como hazard | Subsistema de hazard estendido |
| Radiação (poison por zona) | Tipo de hazard ambiental persistente |
| Vácuo e descompressão | Dano automático por ambiente |
| Drift travel (viagem interestelar) | Sistema de viagem macro (fora do canvas tático) |
| Itens tech (tracking, area, energy types) | Propriedades adicionais em weapon items |

### 5.3 Dados Disponíveis para Importação

Para o Fusion, os dados SF2e são acessíveis via:

1. **JSON packs do `foundryvtt/pf2e`** (Apache-2.0) — dados estruturados e validados, prontos para importação
2. **Archives of Nethys SF2e** (2e.aonsrd.com) — referência de regras via scraping (HTML)
3. **Conteúdo ORC** — mecânicas de regras podem ser implementadas livremente sob ORC; apenas lore/trademarks são reservados

### 5.4 Estado de Maturidade do SF2e em 2026

| Componente | Status |
|---|---|
| Player Core (classes, ancestries, spells, items) | Publicado (julho 2025) |
| GM Core (hazards, cinematic starship combat, ambientes) | Publicado (2025) |
| Galactic Ancestries | Publicado (2026) |
| Tech Core (Mechanic, Technomancer, tactical starship combat) | Lançamento outubro 2026 |
| Foundry SF2e system v1.x | Ativo (versão 1.2.0 em junho 2026) |
| Compendium completo no Foundry | Em progresso (voluntários atualizam conforme livros saem) |

O sistema no Foundry ainda está em maturação — a versão 1.x indica que recursos e compendium ainda estão sendo adicionados. O Tech Core (outubro 2026) trará mecânicas centrais (starship combat tático, Mechanic, Technomancer) que provavelmente precisarão de suporte adicional no Foundry system após o lançamento.

---

## 6. Resumo Executivo

O Starfinder 2e evoluiu de um módulo experimental sobre o sistema PF2e (playtest, 2023–2024) para um **sistema Foundry independente** (`sf2e`) em 2025–2026, hospedado no mesmo repositório do PF2e e compartilhando grande parte de sua infraestrutura TypeScript. Essa arquitetura confirma na prática a hipótese central do Fusion: **um motor de regras 2e unificado, com data packs e subsistemas separados por sistema-alvo, é a abordagem correta**.

As mecânicas exclusivas do SF2e — augmentações, zero-g, combate de naves, hacking como hazard, ambientes espaciais — são adições bem delimitadas sobre o core 2e, não mudanças fundamentais de engine. O licenciamento ORC cobre as mecânicas de regras para implementação livre. Os dados estruturados estão disponíveis open source (Apache-2.0) no repositório `foundryvtt/pf2e`.

---

## Fontes

- [Starfinder Second Edition — Foundry VTT](https://foundryvtt.com/packages/sf2e)
- [Pathfinder Second Edition — Foundry VTT](https://foundryvtt.com/packages/pf2e/)
- [GitHub: foundryvtt/pf2e (repositório oficial)](https://github.com/foundryvtt/pf2e)
- [GitHub: TikaelSol/starfinder-field-test](https://github.com/TikaelSol/starfinder-field-test)
- [GitHub: TikaelSol/sf2e-anachronism](https://github.com/TikaelSol/sf2e-anachronism)
- [system.sf2e.json no branch v14-dev](https://github.com/foundryvtt/pf2e/blob/v14-dev/system.sf2e.json)
- [Archives of Nethys: Starfinder 2nd Edition](https://2e.aonsrd.com/)
- [Archives of Nethys SF2e — Augmentations](https://2e.aonsrd.com/rules/268-augmentations)
- [Archives of Nethys SF2e — Zero Gravity](https://2e.aonsrd.com/rules/928-zero-gravity)
- [Archives of Nethys SF2e — Classes](https://2e.aonsrd.com/classes)
- [PF2e for Foundry VTT — Rule Elements](https://mintlify.wiki/foundryvtt/pf2e/concepts/rule-elements)
- [PF2e for Foundry VTT — Adding Compendium Content](https://mintlify.wiki/foundryvtt/pf2e/guides/adding-compendium-content)
- [Starfinder Player Core — loja Paizo](https://store.paizo.com/starfinder-2e-player-core/)
- [Starfinder Tech Core — loja Paizo](https://store.paizo.com/starfinder-tech-core/)
- [New Starfinder Tech Core — TTRPGFans](https://ttrpgfans.com/starfinder-tech-core/)
- [Starfinder 2e GM Core Review — BJK Games](https://bjkeeton.substack.com/p/starfinder-2e-gm-core-review-sf2e)
- [Starfinder Player Core Review — Gaming Trend](https://gamingtrend.com/reviews/starfinder-2nd-edition-player-core-review-the-precision-of-pf2e-now-with-plasma-rifles/)
- [Paizo — Licenças (ORC e Community Use)](https://paizo.com/licenses)
- [Paizo Blog — New and Revised Licenses](https://paizo.com/blog/new-and-revised-licenses)
- [Paizo — Starfinder 2e anunciado na Gen Con (Gizmodo)](https://gizmodo.com/paizo-starfinder-second-edition-pathfinder-orc-gen-con-1850701088)
- [Paizo Forums — SF2e Foundry Update](https://paizo.com/threads/rzs727g1?Starfinder-2e-Foundry-VTT-Update=)
- [Foundry VTT v11 LevelDB Packs](https://foundryvtt.com/article/v11-leveldb-packs/)
