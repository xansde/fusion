# 18 — Sistema Starfinder 2e

- **Título:** Sistema Starfinder 2e
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/11-starfinder2e-foundry.md`
  - `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md`

> Esta spec é clean-room: descreve a implementação do sistema SF2e no Fusion
> inspirada no _comportamento_ observável e em dados abertos (ORC/Apache-2.0),
> sem copiar código proprietário do Foundry VTT ou da Paizo.

> **Nota normativa de escopo de fase:** O sistema SF2e é classificado como
> **[V2] no escopo global** do Fusion (REQ-ESC-010 em `00-visao-e-escopo.md`).
> Todo o pacote `systems/sf2e` é desenvolvido após o MVP global (sessão de PF2e
> jogável) estar entregue. As tags **[MVP]** e **[V2]** ao longo desta spec
> referem-se ao **escopo interno do SF2e** — ou seja, ao que é necessário para
> "jogar uma sessão de SF2e funcional" versus o que pode ser adiado dentro do
> desenvolvimento do próprio sistema — e **não** ao MVP global do Fusion. Para
> evitar ambiguidade em ferramentas de rastreamento, interprete [MVP] nesta spec
> como **[SF2-CORE]** e [V2] como **[SF2-V2]**.

---

## Objetivo

Especificar o pacote `systems/sf2e` do Fusion — um sistema de jogo completo para
o **Starfinder Second Edition (SF2e)** construído sobre o mesmo motor 2e do PF2e
(`systems/engine-2e` para mecânicas 2e compartilhadas +
`packages/system-api` para o contrato de registro engine ↔ sistema). A spec define:

1. Quais elementos do PF2e são **herdados sem mudança**.
2. Quais elementos são **estendidos** (delta sobre PF2e).
3. Quais elementos são **exclusivos** do SF2e e exigem implementação nova.
4. O modelo de dados das entidades novas ou modificadas.
5. A ficha de personagem Svelte e suas variações.
6. A estratégia de importação dos compendium packs.
7. A tabela de cobertura MVP / V2 / manual.

---

## Escopo

### O que inclui

- Definição do pacote `systems/sf2e` e seus registros na system API.
- Mapeamento completo de herança e delta em relação ao `systems/pf2e`.
- Modelo de dados TypeScript para entidades SF2e novas: `AugmentationItem`,
  `TechWeaponItem`, extensões de `ActorSystemSF2e`, `StarshipCombatant`.
- Ficha de personagem SF2e (Svelte 5): estrutura de tabs e campos específicos.
- Skills exclusivos: Computers e Piloting.
- Sistema de armas tecnológicas: tiers de qualidade, traits exclusivos, munição/carga.
- Augmentações: tipos, slots corporais, limites, instalação.
- Moeda: créditos e credsticks.
- Regras de cobertura (idênticas ao PF2e remaster, confirmadas pela pesquisa).
- Ambientes espaciais: zero-g [V2], vácuo, radiação, atmosferas especiais [V2].
- Starship Combat cinematic como `CombatType` alternativo [V2].
- Dados: 26 compendium packs do SF2e via `tools/importer-pf2e` estendido.
- Condição exclusiva `Untethered`.

### O que NÃO inclui

- O motor de regras 2e compartilhado (three-action economy, graus de sucesso,
  proficiências, condições base) — mecânicas implementadas em
  `systems/engine-2e` (definido em `ver 17-sistema-pf2e.md` DEC-PF2-01);
  contrato de registro em `ver 15-api-de-sistemas.md`; esta spec só define o que
  o SF2e _adiciona_.
- Starship Combat **tático** com grid (Tech Core, outubro 2026) — [V2] fora do
  escopo da spec atual; mapeado apenas conceitualmente.
- Classes Mechanic e Technomancer (Tech Core) — dados chegam com o livro; o
  modelo de dados é o mesmo das outras classes, sem extensão especial de engine.
- Drift travel e viagem interestelar em escala galáctica — sistema macro fora
  do canvas tático, sem especificação neste ciclo.
- Hacking como hazard — subsistema de hazard do GM Core; implementado como
  variante de hazard do engine base [V2].
- Veículos terrestres (enercopter, etc.) — [V2]; dados virão do Tech Core.
- Sistema Etmos, PF2e e arquitetura geral do engine —
  `ver 15-api-de-sistemas.md`, `ver 17-sistema-pf2e.md`, `ver 01-arquitetura-geral.md`.

---

## Conceitos e Terminologia

| Termo                    | Definição                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **engine 2e**            | Motor de regras compartilhado entre PF2e e SF2e: three-action economy, proficiências TEML, graus de sucesso, condições base, effects data-driven. Lógica de mecânicas 2e compartilhadas implementada em `systems/engine-2e`; contrato de registro (API) em `packages/system-api`. Ambos os pacotes são reutilizados por `systems/pf2e` e `systems/sf2e`. |
| **delta SF2e**           | Conjunto de extensões que o `systems/sf2e` adiciona ao engine 2e: tipos de item novos, skills exclusivos, condição Untethered, tiers de qualidade de armas, augmentações, créditos.                                                                                                                                                                      |
| **Augmentation**         | Item do tipo `augmentation` representando uma modificação tecnológica ou biológica implantada no corpo do personagem.                                                                                                                                                                                                                                    |
| **Tech Weapon**          | Arma com o trait `Tech` — usa cargas de energia ou projéteis, sujeita a glitch, com tier de qualidade em vez de runas.                                                                                                                                                                                                                                   |
| **Tier de qualidade**    | Substituto funcional das runas fundamentais de armas no SF2e: Commercial → Tactical → Advanced → Superior → Elite → Ultimate → Paragon.                                                                                                                                                                                                                  |
| **Credstick**            | Item do tipo `equipment` representando um portador de créditos físico. A moeda contábil é o crédito (cr).                                                                                                                                                                                                                                                |
| **Untethered**           | Condição exclusiva do SF2e: criatura flutuando sem propulsão em ambiente zero-g, sem controle de direção.                                                                                                                                                                                                                                                |
| **Starship Scene**       | Encontro de combate cinemático envolvendo naves, mapeado como `CombatType = "starship"`. Os personagens assumem papéis funcionais na nave.                                                                                                                                                                                                               |
| **Papel na nave**        | Captain, Engineer, Gunner, Magic Officer, Pilot ou Science Officer — determina skill de iniciativa e ações disponíveis em Starship Scene.                                                                                                                                                                                                                |
| **Body Slot**            | Um dos slots corporais disponíveis para augmentações (brain, eyes, ears, throat, arms, hands, legs, feet, skin, spinal).                                                                                                                                                                                                                                 |
| **Compendium pack SF2e** | Um dos 26 packs de dados do SF2e hospedados no repositório `foundryvtt/pf2e`, licenciados Apache-2.0 e ORC.                                                                                                                                                                                                                                              |
| **Species**              | Denominação SF2e para ancestry. Mecanicamente idêntica: mesma estrutura de dados, apenas `displayName` diferente na ficha.                                                                                                                                                                                                                               |

---

## Decisões de Design

### D-SF2-01 — Motor 2e unificado: SF2e como extensão, não fork

**Decisão:** O `systems/sf2e` registra-se sobre o mesmo engine 2e do `systems/pf2e`.
Não existe fork de engine. Ambos os sistemas dependem de `systems/engine-2e`
(mecânicas 2e compartilhadas: three-action economy, proficiências TEML, graus de
sucesso, condições base, dying/wounded, IWR — definido em `ver 17-sistema-pf2e.md`
DEC-PF2-01) e de `packages/system-api` (contrato de registro engine ↔ sistemas —
`ver 15-api-de-sistemas.md`). O SF2e adiciona tipos de item, skills, condição e
subsistemas via APIs de extensão da system API.

**Alternativas rejeitadas:**

- Engine separado para SF2e: duplicaria toda a lógica de three-action economy,
  proficiências e effects data-driven sem nenhum benefício. Rejeitado.
- SF2e como módulo sobre PF2e (abordagem playtest): cria dependência de runtime
  e não permite evoluir os dois sistemas independentemente. Rejeitado.

**Racional:** A pesquisa confirma que a Paizo declarou SF2e "fully compatible with
Pathfinder 2nd Edition and the Remaster Project" e a implementação real do Foundry
confirma que engine unificado é viável e foi a escolha da comunidade.

---

### D-SF2-02 — Tiers de qualidade substituem runas de armas

**Decisão:** Armas com trait `Tech` no SF2e não usam o sistema de runas do PF2e.
Em vez disso, cada arma tem um campo `tier` (Commercial/Tactical/Advanced/Superior/
Elite/Ultimate/Paragon) que define o bônus de item ao ataque e o número de dados
de dano de forma análoga às runas Potency + Striking. O importer mapeia o campo
`tier` do JSON fonte para este campo.

**Alternativas rejeitadas:**

- Reutilizar runas PF2e para armas tech: semanticamente incorreto; runas são mágicas
  e o SF2e explicitamente usa tiers tecnológicos. Rejeitado.
- Tratar tier como um item separado aplicado sobre a arma: complexidade desnecessária;
  no SF2e o tier é intrínseco à arma, não adicionado depois. Rejeitado.

**Racional:** Armas Analog (sem trait Tech) no SF2e ainda podem usar o sistema de
runas normalmente — portanto os dois sistemas coexistem no mesmo pacote.

---

### D-SF2-03 — Augmentações como tipo de item dedicado com body slots

**Decisão:** Augmentações são itens do tipo `augmentation` com um campo `bodySlot`
obrigatório. A lógica de limite (máximo 4 augmentações não-apex instaladas) é
aplicada por um hook `preCreateItem` no servidor (REQ-SYS-061), que valida o
schema Zod antes de persistir o item. Apex augmentations têm flag `isApex: true`
e não contam para o limite.

**Alternativas rejeitadas:**

- Modelar como equipment genérico com flag: perderiam type-safety e a UI de
  inventário não saberia exibir os body slots. Rejeitado.
- Modelar como feats: semanticamente incorreto — augmentações são itens físicos
  com peso, custo e podem ser removidas (mas não revendidas/transferidas). Rejeitado.

**Racional:** A pesquisa confirma que augmentações são "vinculadas ao corpo" e têm
lógica de slot bem definida, justificando um tipo de item próprio.

---

### D-SF2-04 — Starship Combat cinemático como CombatType [V2]

**Decisão:** O combate cinemático de naves é implementado como uma variante
`CombatType = "starship"` do documento `Combat`. O engine base de combate suporta
`CombatType` extensível (ver `10-combate-e-iniciativa.md`). O `systems/sf2e`
registra o handler `starshipCombatType` que define: resolução de iniciativa por
papel, ações especiais de 2 ações por papel, e stats de nave como subdocumento.
Esta feature é inteira [V2].

**Alternativas rejeitadas:**

- Starship Combat como sistema de jogo separado fora do engine: forçaria duplicar
  toda a infraestrutura de tracker, turnos e UI. Rejeitado.
- Implementar no MVP: o Tech Core com starship combat tático só sai em outubro 2026
  e o cinematic combat é suficientemente complexo para não bloquear o MVP de SF2e.
  Rejeitado para MVP.

---

### D-SF2-05 — Moeda: créditos como campo numérico único

**Decisão:** O campo de moeda do ator SF2e é `currency: { credits: number }` em
vez do `{ cp, sp, gp, pp }` do PF2e. A UI da ficha exibe apenas "Créditos (cr)".
Credsticks são itens do tipo `equipment` (tipo herdado do engine 2e) com campo
`credits: number` que podem ser adicionados ao inventário.

**Alternativas rejeitadas:**

- Reutilizar o campo multi-denominação do PF2e com renomeação cosmética: o SF2e
  não tem subdivisões de moeda; forçar quatro campos causaria confusão. Rejeitado.

---

### D-SF2-06 — Zero-g como zona de mapa que aplica condições [V2]

**Decisão:** Zero-gravidade é implementada como uma zona especial no canvas
(`ZoneType = "zero-g"`, ver `06-canvas-e-renderizacao.md`) que aplica
automaticamente as condições `Clumsy 1`, `Off-Guard` e `Untethered` a todos os
tokens dentro dela no início de cada turno. A capacidade de carga ×10 e alcance
×10 de arremessadas são EffectRules condicionados ao flag `inZeroG`. Esta feature
é [V2] por depender de lógica de zona no canvas.

---

### D-SF2-07 — Dados via importer pf2e estendido; packs sf2e são separados

**Decisão:** O `tools/importer-pf2e` é estendido para processar os 26 compendium
packs SF2e do repositório `foundryvtt/pf2e`. Os packs SF2e são importados para
compendiums separados (prefixo `sf2e-`) e nunca misturados com packs PF2e.
O importer identifica packs pelo campo `"system": "sf2e"` no manifesto.

**Racional:** O repositório `foundryvtt/pf2e` (Apache-2.0) hospeda os dados SF2e
como JSONs estruturados prontos para consumo. Reutilizar o importer existente
minimiza esforço e mantém consistência no pipeline.

---

### D-SF2-08 — Species = Ancestry com displayName sobrescrito

**Decisão:** A entidade "species" do SF2e é mapeada para o tipo de documento
`ancestry` do engine. O `systems/sf2e` registra `displayName: "Species"` no
manifesto do sistema para que a UI exiba o termo correto. Nenhum dado estrutural
muda — a mecânica de ancestry (heritage, ancestry feats, stats) é idêntica.

---

### D-SF2-09 — Cobertura: idêntica ao PF2e remaster

**Decisão:** As regras de cobertura do SF2e (Lesser +1, Standard +2/+2/+2,
Greater +4/+4/+4) são confirmadas pela pesquisa como idênticas ao PF2e remaster.
O `systems/sf2e` não precisa sobrescrever nenhuma lógica de cobertura do engine.

---

## Escopo de MVP do SF2e

O **MVP global** do Fusion é "o grupo consegue jogar uma sessão de PF2e com mapa,
tokens, fichas funcionais, rolagens automatizadas e combat tracker" (ver
`ver 01-arquitetura-geral.md`). O SF2e **não** é o sistema alvo do MVP global —
ele é o segundo sistema a ser implementado após o PF2e estar jogável.

**MVP do SF2e** (definição local): o grupo consegue criar personagens SF2e com as
6 classes do Player Core, usar a ficha com fichas funcionais de armas tech e
augmentações, e rodar um combate básico usando o engine 2e herdado. Funcionalidades
que dependem de motor de effects plugáveis ([V2] da spec 15) ou de features não
ainda previstas na spec 15 são classificadas como [V2] mesmo que sejam mecânicas
centrais das classes SF2e.

Em particular:

- `SpecialResource` como tipo de efeito ou registrar method não está na spec 15
  MVP → features que dependem dele são [V2].
- EffectRule types plugáveis por sistema são [V2] (spec 15 D4/REQ-SYS-089).
- `AdjustModifier` e `DamageDice` condicional são [V2] (spec 17 DEC-PF2-04).

---

## Requisitos Funcionais

### Pacote e Registro

**REQ-SF2-001** [MVP] O pacote `systems/sf2e` deve se registrar na system API
com `id: "sf2e"`, `name: "Starfinder Second Edition"`, `version: semver` e
declarar dependência de engine 2e versão mínima especificada.

**REQ-SF2-002** [MVP] O sistema deve declarar os seguintes `documentTypes`
adicionais ao conjunto base herdado do engine 2e: `augmentation` (item).
Os actor subtypes `character`, `npc`, `hazard` e `loot` são herdados sem
modificação (mesmo conjunto MVP do PF2e). Os subtypes `vehicle` e `starship`
(actor [V2]) serão adicionados em [V2] quando os subsistemas correspondentes
forem implementados.

**REQ-SF2-003** [MVP] O sistema deve sobrescrever os labels de exibição dos
conceitos renomeados no SF2e via o catálogo i18n (REQ-SYS-048):
`ancestry` exibe "Species" e `currency` exibe "Credits (cr)". As chaves i18n
ficam em `sf2e-pt-BR.json` e `sf2e-en.json` no namespace `sf2e.*`.

---

### Herança do Engine 2e

**REQ-SF2-004** [MVP] O SF2e deve herdar sem modificação os seguintes subsistemas
do engine 2e: three-action economy, MAP, graus de sucesso, proficiências TEML,
condições base (exceto as SF2e-específicas), sistemas de magia (slots prepared/
spontaneous/innate, focus points, heightening), hero points, saving throws, bulk
e encumbrance, exploration mode, downtime mode.

**REQ-SF2-005** [MVP] O SF2e deve herdar as ações básicas compartilhadas (Strike,
Stride, Step, Raise a Shield, Seek, Hide, Sneak, Interact, Release, Delay [V2],
Ready [V2]) sem sobrescrita.

**REQ-SF2-006** [MVP] O SF2e deve herdar o sistema de condições base do engine 2e
e apenas adicionar a condição `Untethered` (ver REQ-SF2-022).

---

### Skills Exclusivos

**REQ-SF2-007** [MVP] O `systems/sf2e` deve registrar dois skills adicionais na
lista de perícias do ator:

| Skill       | Atributo-chave | Ações principais                                      |
| ----------- | -------------- | ----------------------------------------------------- |
| `computers` | Intelligence   | Hack, Access System, Recall Knowledge (tecnologia/IA) |
| `piloting`  | Dexterity      | Fly/Drive veículo ou nave, manobras avançadas         |

**REQ-SF2-008** [MVP] A ficha de personagem SF2e deve exibir Computers e Piloting
na seção de skills, com bônus calculado pelo engine (atributo + proficiência TEML).

---

### Classes SF2e

**REQ-SF2-009** [MVP] O compendium SF2e deve conter as 6 classes do Player Core
(Envoy, Mystic, Operative, Solarian, Soldier, Witchwarper) como itens do tipo
`class`, importados via `tools/importer-pf2e` estendido.

**REQ-SF2-010** [MVP] Cada classe deve ter seus feats de classe importados como
itens do tipo `feat` com `featType: "class"`, associados à classe por `system.class`.

**REQ-SF2-011** [V2] A ação especial **Aim** (Operative) depende dos tipos de
EffectRule `adjustDegreeOfSuccess`/`flatModifier` condicional e `damageDice`
condicional. O tipo `damageDice` condicional e `AdjustModifier` são [V2] conforme
DEC-PF2-04 da spec 17. A ação Aim será implementada como item com EffectRules
quando o motor de effects data-driven atingir cobertura [V2].

**REQ-SF2-012** [V2] O **ciclo cósmico do Solarian** (Graviton/Photon attunement)
depende do suporte a `SpecialResource` como tipo no motor de effects ou como
registrar method na system API, funcionalidade não prevista no MVP da spec 15
(REQ-SYS-082). No MVP, o atunement é rastreado manualmente pelo jogador nos campos
`system.classResources.solarian.*` via a ficha; a automação de atunement e feats
condicionados ao polo é [V2].
A UI da ficha deve exibir o rastreador de atunement com botões +/−
(REQ-SF2-042), mas sem automação de effects condicionais.

**REQ-SF2-013** [MVP] As **Directives do Envoy** devem ser modeladas como ações
importadas do compendium, ativadas via chat com resultado de rolagem de perícia
social quando aplicável.

**REQ-SF2-014** [V2] As classes Mechanic e Technomancer (Tech Core, outubro 2026)
serão adicionadas como packs de compendium adicionais após o lançamento do livro,
sem alteração estrutural do engine.

---

### Species (Ancestries)

**REQ-SF2-015** [MVP] O compendium SF2e deve conter as 10 species do Player Core
(Android, Barathu, Human, Kasatha, Lashunta, Pahtra, Shirren, Skittermander, Vesk,
Ysoki) e os 2 versatile heritages (Borai, Prismeni) como itens de tipo `ancestry`
e `heritage`.

**REQ-SF2-016** [MVP] O mecanismo de "standardized ancestry feats" (feats de
features fisiológicas compartilhadas entre species) deve ser suportado pelo modelo
existente de ancestry feats, sem extensão especial de engine.

**REQ-SF2-017** [V2] As 21 species adicionais do suplemento _Galactic Ancestries_
(2026) serão adicionadas como pack de compendium suplementar.

---

### Armas Tecnológicas

**REQ-SF2-018** [MVP] Itens de arma com o trait `Tech` devem ter o campo
`system.tier` obrigatório do tipo `WeaponTier`:

```typescript
type WeaponTier =
  | "commercial" // nível aprox. 0  — bônus e dados: ver QA-SF2-01
  | "tactical" // nível aprox. 2  — bônus e dados: ver QA-SF2-01
  | "advanced" // nível aprox. 4  — bônus e dados: ver QA-SF2-01
  | "superior" // nível aprox. 10 — bônus e dados: ver QA-SF2-01
  | "elite" // nível aprox. 12 — bônus e dados: ver QA-SF2-01
  | "ultimate" // nível aprox. 16 — bônus e dados: ver QA-SF2-01
  | "paragon"; // nível aprox. 19 — bônus e dados: ver QA-SF2-01
```

O campo `tier` é um enum sem semântica numérica fixa embutida no tipo. Os bônus
de item ao ataque e o número de dados de dano por tier **não foram tabelados na
pesquisa** (a pesquisa 13 §15.3 lista apenas nível aproximado e custo de upgrade
em créditos). Os valores exatos devem ser extraídos dos JSONs do compendium SF2e
do repositório `foundryvtt/pf2e` antes da implementação — ver QA-SF2-01.

**REQ-SF2-019** [MVP] Os seguintes traits exclusivos de armas SF2e devem ser
suportados pelo engine de traits com efeitos mecânicos:

| Trait        | Efeito mecânico                                                                              |
| ------------ | -------------------------------------------------------------------------------------------- |
| `Tech`       | Item eletrônico; sujeito a glitch por efeitos EMP; usa charges                               |
| `Automatic`  | Ativa disparo em rajada: burst (área) ou full-auto (múltiplos alvos); consome charges extras |
| `Area X`     | Atinge todos em área de X pés; sem roll separado por alvo; salvaguarda Reflex padrão         |
| `Tracking X` | Bônus de item +X ao ataque (cumulativo com tier)                                             |
| `Analog`     | Não tem trait Tech; imune a efeitos de glitch/EMP; não usa charges                           |
| `Injection`  | Ao acertar, pode entregar veneno ou item líquido via seringa                                 |
| `Line`       | Projétil em linha reta; atinge múltiplos alvos em sequência                                  |
| `Unwieldy`   | Não pode ser usada com MAP; máximo 1 Strike por turno                                        |
| `Seeking`    | Ignora penalidade de miss chance por concealment                                             |

**REQ-SF2-020** [MVP] Armas com trait `Tech` devem rastrear cargas (`charges`):
campo `system.charges.current` e `system.charges.max`. A ação `Reload` consome
1 ação para recarregar conforme `system.reloadActions`. A UI da ficha deve exibir
a barra de cargas ao lado da arma.

**REQ-SF2-021** [MVP] Armas `Analog` (sem trait `Tech`) no SF2e devem suportar o
sistema de runas do PF2e normalmente, para compatibilidade com armas físicas em
cenários mistos.

---

### Condição Untethered

**REQ-SF2-022** [MVP] A condição `Untethered` deve ser registrada pelo
`systems/sf2e` com a seguinte definição:

```typescript
interface UntetheredCondition {
  id: "untethered";
  // Personagem está flutuando sem propulsão em zero-g.
  // Não pode se mover voluntariamente sem Push Off, jetpack ou magia.
  // Pode ser removida ao agarrar superfície sólida ou usar propulsão.
  effects: [{ type: "RollOption"; option: "untethered"; value: true }];
}
```

A condição não concede penalidades mecânicas próprias além da restrição de
movimento — as penalidades de Clumsy 1 e Off-Guard vêm do ambiente zero-g, não
da condição em si.

---

### Augmentações

**REQ-SF2-023** [MVP] O tipo de item `augmentation` deve ter o seguinte schema:

```typescript
interface AugmentationItemSystem {
  augType: "biotech" | "cybernetic" | "magitech" | "apex";
  bodySlot: BodySlot;
  itemLevel: number;
  isApex: boolean;
  // Se true, não conta para o limite de 4 augmentações.
  installationTime: number; // horas; regra: 1h por 2 item levels
  requiresMedicineMaster: boolean;
  // Augmentações são vinculadas ao personagem; não podem ser revendidas.
  soulbound: true;
  bulk: string; // "L", "1", "2", etc.
  price: number; // em créditos
  description: string;
  effects: EffectRule[];
  // EffectRules (spec 15 REQ-SYS-082) aplicadas quando a augmentação está instalada.
  // Apenas tipos canônicos do MVP são suportados; EffectRule.type plugável é [V2].
}

type BodySlot =
  | "brain"
  | "eyes"
  | "ears"
  | "throat"
  | "arms"
  | "hands"
  | "legs"
  | "feet"
  | "skin"
  | "spinal";
```

**REQ-SF2-024** [MVP] A validação do limite de augmentações deve ocorrer no
servidor via hook `preCreateItem` (REQ-SYS-061): antes de persistir um item do
tipo `augmentation`, o servidor verifica se o ator já tem 4 augmentações não-apex
instaladas e, se sim, retorna `false` cancelando a operação. A validação é
realizada por lógica imperativa em `systems/sf2e/src/hooks/augmentation.ts`, não
como EffectRule custom (effects plugáveis por sistema são [V2] — spec 15 D4/
REQ-SYS-089).

**REQ-SF2-025** [MVP] A ficha de personagem SF2e deve ter uma aba "Augmentations"
que exibe cada augmentação instalada agrupada por `bodySlot`, o indicador de
`X/4 slots usados` (excluindo apex), e o botão de remoção com confirmação (remoção
envolve cirurgia — aviso na UI).

**REQ-SF2-026** [V2] O GM deve poder registrar a augmentação como "em processo de
instalação" com timer de downtime (1h por 2 item levels), via tracker de downtime.

---

### Moeda: Créditos

**REQ-SF2-027** [MVP] O schema do ator SF2e deve ter `system.currency.credits`
como número inteiro (em vez do `{ cp, sp, gp, pp }` do PF2e).

**REQ-SF2-028** [MVP] A ficha SF2e deve exibir o campo de créditos com o sufixo
"cr" e suportar adição/subtração direta pelo jogador.

**REQ-SF2-029** [MVP] Credsticks devem ser modelados como itens do tipo
`equipment` (tipo existente no engine 2e, herdado do PF2e — spec 17) com campo
`system.credits: number` e flag `system.isCredstick: true`. Ao usar o item, os
créditos são transferidos para `system.currency.credits` do ator com confirmação.

---

### Ambientes Espaciais

**REQ-SF2-030** [MVP] As seguintes condições de ambiente espacial devem ser
modeladas como efeitos de hazard aplicáveis pelo GM via chat/scene:

| Ambiente          | Efeito mecânico (MVP: manual via GM)                                       |
| ----------------- | -------------------------------------------------------------------------- |
| Vácuo             | Aplicar 1d6 bludgeoning/round + sufocação imediata como efeito persistente |
| Descompressão     | Aplicar 3d6 bludgeoning extra ao transitar de pressurizado para vácuo      |
| Radiação baixa    | Aplicar efeito de veneno (poison, 4 níveis: low/medium/high/severe)        |
| Atmosfera espessa | GM rola Fortitude DC 15+1/check por hora; falha = sickened                 |

No MVP estes efeitos são aplicados manualmente pelo GM via drag de efeito no token.
A automação de zonas de mapa é [V2].

**REQ-SF2-031** [V2] O canvas deve suportar zonas `ZoneType = "vacuum"`,
`"zero-g"`, `"radiation-low"`, `"radiation-medium"`, `"radiation-high"`,
`"radiation-severe"`, `"thick-atmosphere"`, aplicando automaticamente os efeitos
correspondentes ao início de turno de tokens dentro da zona.

**REQ-SF2-032** [V2] Tokens em zona `zero-g` devem receber automaticamente as
condições `Clumsy 1`, `Off-Guard` e `Untethered` no início de cada turno enquanto
não tiverem fonte de propulsão ativa (item com flag `hasPropulsion: true`).

**REQ-SF2-033** [V2] Em zona `zero-g`, a capacidade de carga do token deve ser
multiplicada por 10 e o alcance de armas com trait `Thrown` deve ser multiplicado
por 10. Criaturas com fly Speed natural sem trait `Cosmic` não podem usar esse
Speed em zero-g.

---

### Combate de Naves (Starship Scenes)

**REQ-SF2-034** [V2] O `systems/sf2e` deve registrar `CombatType = "starship"`
no engine de combate. Um encontro do tipo starship tem as seguintes propriedades
adicionais:

```typescript
interface StarshipCombatData {
  combatType: "starship";
  playerShip: StarshipStatblock; // nave dos PCs
  threats: StarshipThreat[]; // naves inimigas / hazards / megafauna
  phase: "initiative" | "active" | "ended";
  victoryPoints: number;
  victoryCondition: string; // descrição textual
}

interface StarshipStatblock {
  name: string;
  ac: number;
  fortitudeSave: number;
  reflexSave: number;
  hullPoints: { current: number; max: number };
  shieldPoints: { current: number; max: number; regenPerRound: number };
  speed: number;
  powerCoreLimit: number; // ações poderosas por turno
}

type StarshipRole =
  | "captain"
  | "engineer"
  | "gunner"
  | "magic_officer"
  | "pilot"
  | "science_officer";
```

**REQ-SF2-035** [V2] Em um encontro starship, cada `Combatant` deve ter um campo
`starshipRole: StarshipRole`. O engine deve usar a skill mapeada ao papel para
determinar a iniciativa:

| Papel           | Skill de iniciativa               |
| --------------- | --------------------------------- |
| Captain         | Diplomacy ou Intimidation (maior) |
| Engineer        | Engineering (Crafting)            |
| Gunner          | attack bonus (arma escolhida)     |
| Magic Officer   | spell attack                      |
| Pilot           | Piloting                          |
| Science Officer | Computers                         |

**REQ-SF2-036** [V2] Cada papel deve ter uma lista de ações especiais de 2 ações
importadas do compendium (`featType: "starship-role"`). Estas ações consomem 2 das
3 ações do turno do personagem; a 1ª ação pode ser usada para outras atividades.

**REQ-SF2-037** [V2] O tracker de combate starship deve exibir: HP e Shields da
nave dos PCs (com barra visual), Victory Points acumulados, papel de cada jogador
e ações disponíveis por papel no turno ativo.

**REQ-SF2-038** [V2] Ameaças (naves inimigas) devem usar "rotinas pré-definidas"
importadas do compendium (`type: "starship-threat"`). O GM pode substituir rotinas
ad-hoc durante o encontro.

---

### Ficha de Personagem

**REQ-SF2-039** [MVP] A ficha de personagem SF2e deve ser um componente Svelte 5
registrado como `sheet: "ActorSheetSF2ePC"` para atores do tipo `character`.
A estrutura de tabs deve ser:

| Tab               | Conteúdo                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- |
| **Core**          | Stats principais, saves, AC, speed, HP; skills (incluindo Computers e Piloting); iniciativa |
| **Actions**       | Ações básicas, ações de classe, itens ativáveis                                             |
| **Inventory**     | Armas (com barra de charges para Tech), armaduras, equipment; créditos                      |
| **Augmentations** | Lista de augmentações por body slot; contador de slots (X/4)                                |
| **Feats**         | Feats de classe, ancestry, general, skill                                                   |
| **Spells**        | Slots por rank, spell list (apenas para Mystic e Witchwarper)                               |
| **Biography**     | Background, description, notes em rich text                                                 |

**REQ-SF2-040** [MVP] O campo de moeda da aba Inventory deve exibir apenas
"Créditos: [valor] cr" sem subdivisões de denominação.

**REQ-SF2-041** [MVP] Armas na aba Inventory com trait `Tech` devem exibir um
indicador de cargas no formato `[charges.current]/[charges.max]` com ícone de
bateria. Botão de Reload deve decrementar `reloadActions` ações do turno ativo.

**REQ-SF2-042** [MVP] A aba Core deve exibir o tracker de atunement do Solarian
(Graviton/Photon, 0–3 pontos em cada polo) quando a classe do ator é Solarian.
O tracker usa botões +/- e muda o ícone do token conforme o polo dominante [V2].

**REQ-SF2-043** [MVP] A ficha de NPC SF2e (`ActorSheetSF2eNPC`) deve herdar a
estrutura da ficha de NPC do PF2e com as seguintes modificações: campo `tier` em
vez de runas para armas Tech, campo `credits` em vez de moedas GP/SP/CP.

---

### Compendiums e Importação

**REQ-SF2-044** [MVP] O `tools/importer-pf2e` deve ser estendido para processar
entradas com `"system": "sf2e"` nos packs do repositório `foundryvtt/pf2e`,
gerando compendiums com prefixo `sf2e-`.

**REQ-SF2-045** [MVP] Os seguintes 8 packs SF2e devem ser importados no MVP
(subconjunto crítico para jogar uma sessão):

| Pack                        | Conteúdo                                  |
| --------------------------- | ----------------------------------------- |
| `sf2e-alien-core-bestiario` | Criaturas do Alien Core                   |
| `sf2e-classes`              | 6 classes do Player Core                  |
| `sf2e-species`              | 10 species + 2 heritages                  |
| `sf2e-equipment`            | Armas, armaduras, equipment, augmentações |
| `sf2e-feats`                | Feats de classe, ancestry, general, skill |
| `sf2e-spells`               | Magias de Mystic e Witchwarper            |
| `sf2e-conditions`           | Condições (incluindo Untethered)          |
| `sf2e-actions`              | Ações básicas e de classe                 |

**REQ-SF2-046** [V2] Os 18 packs restantes (Starfinder Society, backgrounds,
hazards, NPCs do GM Core, starship threats, etc.) serão importados em releases
subsequentes à medida que o sistema Foundry SF2e amadurece.

**REQ-SF2-047** [MVP] O importer deve mapear o campo `system.tier` dos JSONs
fonte para o campo `WeaponTier` do Fusion, e `system.charges` para
`{ current, max }`.

**REQ-SF2-048** [MVP] O importer deve rejeitar entradas com `"system":
"pf2e"` que estejam erroneamente incluídas em packs SF2e (ex.: o pack
`bestiary-effects` que referencia `"system": "pf2e"` na pesquisa), logando
um aviso e pulando a entrada.

---

## Requisitos Não-Funcionais

**REQ-SF2-049** [MVP] O `systems/sf2e` não deve introduzir nenhuma dependência
de runtime além das já presentes no engine 2e e nos pacotes declarados no
`package.json` do workspace.

**REQ-SF2-050** [MVP] A preparação de ator SF2e (cálculo de stats derivados)
deve completar em menos de 50ms para um personagem com até 30 itens (incluindo
augmentações e armas tech), na mesma máquina alvo do MVP.

**REQ-SF2-051** [MVP] Os schemas TypeScript de `AugmentationItemSystem`,
`TechWeaponExtension` e `ActorSystemSF2e` devem ser validados com Zod em runtime
no servidor antes de persistir qualquer documento SF2e.

**REQ-SF2-052** [MVP] O pacote `systems/sf2e` deve exportar um type discriminated
union `SF2eItemSystem` cobrindo todos os tipos de item SF2e para uso pelo
compilador TypeScript sem `any`.

**REQ-SF2-053** [MVP] Toda string visível ao usuário na ficha SF2e deve estar
no catálogo i18n `sf2e-pt-BR.json` (primário) e `sf2e-en.json` (secundário),
incluindo nomes de skills exclusivos, tipos de augmentação e nomes de papéis
de nave.

---

## Modelo de Dados

### ActorSystemSF2e (campos adicionados sobre PF2eActorSystem)

```typescript
interface ActorSystemSF2e extends ActorSystemPF2e {
  // Sobrescreve currency do PF2e
  currency: {
    credits: number;
  };

  // Augmentações instaladas (rastreamento de slots)
  augmentations: {
    installed: AugmentationSlot[];
    apexCount: number; // apex augmentations (não contam para limite)
    regularCount: number; // contagem atual (máx 4)
  };

  // Skills adicionais (além das 16 perícias core do PF2e — REQ-PF2-012)
  skills: ActorSystemPF2e["skills"] & {
    computers: SkillData;
    piloting: SkillData;
  };

  // Recursos especiais de classes SF2e
  classResources?: {
    // Solarian
    solarian?: {
      gravitonAttunement: number; // 0-3
      photonAttunement: number; // 0-3
      pole: "graviton" | "photon" | "balanced";
    };
  };

  // [V2] Flag de ambiente para zero-g
  environmentFlags?: {
    inZeroG: boolean;
    hasPropulsion: boolean; // jetpack, thrusters, etc.
  };
}

interface AugmentationSlot {
  itemId: string;
  bodySlot: BodySlot;
  augType: "biotech" | "cybernetic" | "magitech" | "apex";
  isApex: boolean;
}
```

### TechWeaponExtension (campos adicionais em WeaponItemSystem)

```typescript
interface TechWeaponExtension {
  // Presente quando o item tem o trait "Tech"
  tier: WeaponTier;
  charges: {
    current: number;
    max: number;
  };
  reloadActions: 0 | 1 | 2 | 3;
  // Traits SF2e adicionais
  sfTraits: Array<
    | "automatic"
    | "area"
    | "tracking"
    | "analog"
    | "injection"
    | "line"
    | "unwieldy"
    | "seeking"
    | "bright"
  >;
  trackingBonus?: number; // valor numérico do trait Tracking X
  areaSize?: number; // tamanho da área em pés (trait Area X)
  automaticMode?: "burst" | "full-auto";
}
```

### AugmentationItemSystem

```typescript
interface AugmentationItemSystem {
  augType: "biotech" | "cybernetic" | "magitech" | "apex";
  bodySlot: BodySlot;
  itemLevel: number;
  isApex: boolean;
  soulbound: true;
  installationTime: number; // horas
  requiresMedicineMaster: boolean;
  bulk: string;
  price: number; // créditos
  description: string;
  publication: PublicationData;
  effects: EffectRule[]; // tipos canônicos MVP (spec 15 REQ-SYS-082); plugáveis [V2]
}

type BodySlot =
  | "brain"
  | "eyes"
  | "ears"
  | "throat"
  | "arms"
  | "hands"
  | "legs"
  | "feet"
  | "skin"
  | "spinal";
```

### StarshipStatblock [V2]

```typescript
interface StarshipStatblock {
  name: string;
  tier: number; // tier numérico da nave (0.5, 1, 2, ... 20)
  size: "Huge" | "Gargantuan";
  ac: number;
  fortitudeSave: number;
  reflexSave: number;
  hullPoints: ResourcePool;
  shieldPoints: ResourcePool & { regenPerRound: number };
  speed: number; // em unidades de hex (1 hex = 500 milhas)
  powerCoreLimit: number;
  weapons: StarshipWeapon[];
  roles: Partial<Record<StarshipRole, string>>; // roleId -> actorId
}

interface StarshipWeapon {
  name: string;
  type: "direct-fire" | "tracking";
  range: "short" | "medium" | "long";
  damage: string; // ex: "4d6"
  arcs: Array<"forward" | "aft" | "port" | "starboard" | "turret">;
  pcuCost: number; // Power Core Units consumidos por disparo
}
```

---

## Tabela de Cobertura MVP / V2 / Manual

| Funcionalidade                                                                           | MVP | V2  | Manual/Narrativo         |
| ---------------------------------------------------------------------------------------- | --- | --- | ------------------------ |
| Engine 2e herdado (three-action, MAP, graus)                                             | X   |     |                          |
| Skills Computers e Piloting                                                              | X   |     |                          |
| 6 classes (Envoy, Mystic, Operative, Solarian, Soldier, Witchwarper)                     | X   |     |                          |
| 10 species + 2 heritages                                                                 | X   |     |                          |
| Ação Aim (Operative) — depende de effects [V2]                                           |     | X   |                          |
| Rastreador Graviton/Photon na ficha (manual)                                             | X   |     |                          |
| Automação de feats condicionados ao polo Solarian                                        |     | X   |                          |
| Armas Tech com tiers de qualidade e charges                                              | X   |     |                          |
| Traits exclusivos: Automatic, Area, Tracking, Analog, Injection, Line, Unwieldy, Seeking | X   |     |                          |
| Augmentações (tipos, body slots, limite 4, regra apex)                                   | X   |     |                          |
| Ficha PC SF2e com aba Augmentations e barra de charges                                   | X   |     |                          |
| Ficha NPC SF2e                                                                           | X   |     |                          |
| Créditos como moeda única                                                                | X   |     |                          |
| Credsticks como itens de equipment                                                       | X   |     |                          |
| Condição Untethered                                                                      | X   |     |                          |
| Cobertura (igual PF2e remaster)                                                          | X   |     |                          |
| 8 packs de compendium MVP                                                                | X   |     |                          |
| Efeitos de vácuo e descompressão (aplicação manual pelo GM)                              | X   |     |                          |
| Efeitos de radiação (aplicação manual pelo GM)                                           | X   |     |                          |
| Efeitos de atmosfera espessa (manual)                                                    | X   |     |                          |
| Token muda ícone por polo Solarian                                                       |     | X   |                          |
| Mechanic e Technomancer (Tech Core)                                                      |     | X   |                          |
| 21 species adicionais (Galactic Ancestries)                                              |     | X   |                          |
| 18 packs de compendium restantes                                                         |     | X   |                          |
| Augmentação: timer de instalação em downtime                                             |     | X   |                          |
| Zonas de ambiente no canvas (zero-g, vácuo, radiação)                                    |     | X   |                          |
| Condições automáticas em zonas (Clumsy 1, Off-Guard, Untethered)                         |     | X   |                          |
| Carga ×10 e alcance ×10 em zero-g                                                        |     | X   |                          |
| Starship Combat cinemático (CombatType starship)                                         |     | X   |                          |
| Papéis na nave e ações de papel                                                          |     | X   |                          |
| Stats de nave (hull/shields, regeneração)                                                |     | X   |                          |
| Tracker visual de combate de naves                                                       |     | X   |                          |
| Starship Combat tático com grid (Tech Core)                                              |     |     | X (fora de escopo atual) |
| Drift travel / viagem interestelar                                                       |     |     | X (fora de escopo atual) |
| Hacking como hazard                                                                      |     | X   |                          |
| Veículos terrestres                                                                      |     | X   |                          |
| Roleplay e negociação social (Diplomacy, Intimidation)                                   |     |     | X                        |
| Papéis narrativos em Starship Scene                                                      |     | X   |                          |

---

## API e Eventos

### Registro do sistema (system manifest)

```typescript
// systems/sf2e/src/index.ts
import { defineSystem } from "@fusion/system-api";
import { buildSF2eModels } from "./models";
import { buildSF2eSheets } from "./sheets";

// O manifest segue SystemManifest (spec 15, REQ-SYS-003):
// - engineCompat: range semver da engine (substitui engineVersion/requiredEngine)
// - documentTypes: mapa de documentType → subtypes adicionais declarados pelo SF2e
// - languages: lista de arquivos i18n (REQ-SYS-048)
const manifest = {
  id: "sf2e",
  title: "Starfinder Second Edition",
  version: "0.1.0",
  engineCompat: ">=1.0.0 <2.0.0",
  authors: [{ name: "Fusion SF2e Authors" }],
  documentTypes: {
    // actor subtypes suportados [MVP]; starship [V2] e vehicle [V2] adicionados depois
    Actor: ["character", "npc", "hazard", "loot"],
    // item subtypes adicionados além do conjunto base do engine 2e
    Item: ["augmentation"],
  },
  languages: [
    { lang: "pt-BR", name: "Português (Brasil)", path: "lang/sf2e-pt-BR.json" },
    { lang: "en", name: "English", path: "lang/sf2e-en.json" },
  ],
} satisfies import("@fusion/system-api").SystemManifest;

export default defineSystem(manifest, (r) => {
  // ── Models (schemas Zod por subtype) ──────────────────────────────────────
  buildSF2eModels(r);
  // Registra o schema de AugmentationItemSystem (REQ-SF2-023, REQ-SYS-010/011)
  // r.defineModel({ documentType: "Item", subtype: "augmentation", schema: AugmentationSchema })

  // ── Skills adicionais ─────────────────────────────────────────────────────
  // SF2e adiciona Computers e Piloting ao conjunto de skills do engine 2e
  // via um DeriveStep que estende o array de skills do ator (REQ-SF2-007).
  r.derive({
    id: "sf2e.skills.extra",
    documentType: "Actor",
    subtypes: ["character", "npc"],
    phase: "base",
    reads: [],
    writes: ["system.skills.computers", "system.skills.piloting"],
    run(actor, _ctx) {
      /* inicializa computers e piloting */
    },
  });

  // ── Condições ─────────────────────────────────────────────────────────────
  // Registra a condição exclusiva Untethered (REQ-SF2-022, REQ-SYS-043)
  r.condition({
    slug: "untethered",
    label: "sf2e.condition.untethered.label", // via i18n (REQ-SYS-048)
    img: "systems/sf2e/icons/conditions/untethered.webp",
    valued: false,
    effects: [{ type: "rollOption", domain: "all", option: "untethered" }],
  });

  // ── Sheets ────────────────────────────────────────────────────────────────
  buildSF2eSheets(r);
  // r.sheet({ documentType: "Actor", subtypes: ["character"],
  //           component: ActorSheetSF2ePC, makeDefault: true, label: "SF2e PC Sheet" });
  // r.sheet({ documentType: "Actor", subtypes: ["npc"],
  //           component: ActorSheetSF2eNPC, makeDefault: true, label: "SF2e NPC Sheet" });

  // ── Iniciativa ────────────────────────────────────────────────────────────
  r.initiativeFormula({
    id: "sf2e.perception",
    label: "Perception",
    build: (_combatant, _ctx) => "1d20 + @perception.mod",
  });

  // ── Validação de slots de augmentação [MVP] ───────────────────────────────
  // O limite de 4 augmentações não-apex é aplicado via hook preCreateItem
  // no servidor (REQ-SYS-061 / REQ-SF2-024), não como EffectRule custom
  // (effects plugáveis por sistema são [V2] — spec 15 D4/REQ-SYS-089).
  // A lógica de validação vive em src/hooks/augmentation.ts.

  // ── [V2] CombatType starship ──────────────────────────────────────────────
  // O registro de CombatType "starship" (REQ-SF2-034) depende da API
  // de CombatType extensível (ver 10-combate-e-iniciativa.md) e é [V2].

  // ── [V2] Effects plugáveis (StarshipRole, ZeroGEnvironment) ──────────────
  // EffectRule.type custom registrado por sistema é [V2] (spec 15 REQ-SYS-089).
  // Esses efeitos aguardam o motor de effects plugáveis antes de serem
  // registrados.
});
```

### Eventos emitidos pelo sistema

| Evento                           | Quando                         | Payload                               |
| -------------------------------- | ------------------------------ | ------------------------------------- |
| `sf2e:augmentation:installed`    | Augmentação adicionada ao ator | `{ actorId, itemId, bodySlot }`       |
| `sf2e:augmentation:removed`      | Augmentação removida           | `{ actorId, itemId }`                 |
| `sf2e:weapon:reload`             | Arma Tech recarregada          | `{ actorId, itemId, chargesAfter }`   |
| `sf2e:solarian:attunement`       | Polo Solarian muda             | `{ actorId, pole, graviton, photon }` |
| `sf2e:starship:hullDamage` [V2]  | Nave recebe dano               | `{ combatId, hpAfter, shieldsAfter }` |
| `sf2e:starship:roleChanged` [V2] | Jogador muda de papel          | `{ combatId, actorId, role }`         |

---

## Dependências (specs irmãs)

| Spec / Pacote                        | Dependência                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ver 02-modelo-de-dados.md`          | Tipo base `Item`, `Actor`, `EffectRule`, `PublicationData`                                                                                                |
| `ver 08-motor-de-rolagens.md`        | Rolagem de dados no servidor; inline rolls para ações de classe                                                                                           |
| `ver 10-combate-e-iniciativa.md`     | `CombatType` extensível; `CombatLifecycleEvent` para expirar efeitos                                                                                      |
| `ver 11-ui-framework-e-fichas.md`    | Registro de `ActorSheet` Svelte; sistema de tabs; ativação de itens                                                                                       |
| `ver 15-api-de-sistemas.md`          | `defineSystem(manifest, build)`, `SystemRegistrar`, `ConditionDefinition`, `InitiativeFormula`, motor de effects data-driven (REQ-SYS-082)                |
| `ver 16-compendiums-e-importacao.md` | Pipeline de importação; extensão do importer para packs SF2e                                                                                              |
| `ver 17-sistema-pf2e.md`             | `systems/engine-2e` (mecânicas 2e compartilhadas: TEML, degrees of success, dying/wounded, IWR, MAP); tipos base PF2e herdados; runas (para armas Analog) |
| `ver 06-canvas-e-renderizacao.md`    | `ZoneType` extensível [V2]; tokens em zonas                                                                                                               |
| `ver 26-licencas-e-legal.md`         | ORC License para mecânicas SF2e; Apache-2.0 para dados do compendium                                                                                      |

---

## Critérios de Aceitação

**CA-SF2-01** [MVP] Um personagem SF2e pode ser criado com classe, species, background
e skills (incluindo Computers e Piloting), e a ficha exibe todos os bônus calculados
corretamente pelo engine 2e.

**CA-SF2-02** [MVP] Uma arma Tech (ex: laser rifle Advanced) com tier `advanced`
exibe o bônus de item e o número de dados de dano conforme a tabela extraída do
compendium SF2e (ver QA-SF2-01), além da barra de charges. Reload consome a ação
correta do turno.

**CA-SF2-03** [V2] A ação Aim do Operative aplica dano de precisão e reduz cobertura
do alvo via EffectRules do item (depende de effects [V2] — REQ-SF2-011).

**CA-SF2-04** [MVP] Um Solarian pode alternar entre polo Graviton e Photon via
botões +/− na aba Core; o rastreador na ficha reflete o estado atual.
A ativação/desativação automática de feats condicionados ao polo é [V2] (REQ-SF2-012).

**CA-SF2-05** [MVP] Uma augmentação pode ser adicionada a um ator; ao tentar adicionar
a 5ª augmentação não-apex, o servidor rejeita a operação com mensagem de erro
`"sf2e.augmentation.slotLimit"` e nenhuma mudança é persistida.

**CA-SF2-06** [MVP] O saldo de créditos do personagem pode ser editado na ficha;
usar um credstick de 500 cr transfere os créditos e remove o item do inventário.

**CA-SF2-07** [MVP] O importer processa os 8 packs MVP do SF2e sem erros; entradas
com `"system": "pf2e"` em packs SF2e são ignoradas com log de aviso.

**CA-SF2-08** [MVP] Uma sessão completa pode ser conduzida com PF2e e SF2e ativos
simultaneamente no mesmo servidor sem conflito de IDs ou tipos de documento.

**CA-SF2-09** [V2] Um encontro Starship Scene pode ser criado; jogadores escolhem
papéis; iniciativa é rolada pelo skill do papel; o tracker exibe HP/Shields da nave.

---

## Questões em Aberto

**QA-SF2-01** Os valores exatos de bônus de item e número de dados por tier de
qualidade não foram completamente tabelados na pesquisa (apenas o custo de upgrade
em créditos foi listado). É necessário mapear tier → (bônus de ataque, nº de dados)
a partir dos JSONs do compendium SF2e do repositório `foundryvtt/pf2e` antes de
implementar o campo `WeaponTier`. Alternativa: scraping da tabela de weapons no
Archives of Nethys SF2e.

**QA-SF2-02** A pesquisa menciona que o pack `bestiary-effects` do SF2e referencia
`"system": "pf2e"` — indicando efeitos ainda compartilhados entre os dois sistemas.
É necessário auditar todos os 26 packs antes da importação para identificar outros
casos de referências cruzadas inesperadas e decidir se devem ser copiadas, linkadas
ou ignoradas.

**QA-SF2-03** O Tech Core (outubro 2026) adicionará Mechanic e Technomancer.
O Mechanic tem um drone companion — precisamos decidir se o drone é modelado como
sub-ator independente (similar a animal companions no PF2e) ou como item do tipo
`companion`. Esta decisão afeta o modelo de dados e deve ser feita quando o livro
for lançado.

**QA-SF2-04** As regras de Low Gravity e High Gravity foram mencionadas na pesquisa
mas não detalhadas mecanicamente. A implementação das zonas de mapa [V2] precisará
dos valores exatos de penalidade/bônus para estas condições de gravidade. Fonte:
GM Core / Archives of Nethys SF2e.

**QA-SF2-05** O Starship Combat tático (Tech Core, outubro 2026) usa grid — não
definido nesta spec. Quando o Tech Core for lançado, uma sub-spec ou addendum de
`18-sistema-sf2e.md` deve detalhar o sistema de grid de combate espacial (escala,
hexes vs. squares, arcos de disparo) e como ele se integra com o canvas do Fusion.

**QA-SF2-06** A Paizo lançou Starfinder Infinite como ecossistema fechado onde
conteúdo ORC não pode ser republicado. Precisamos confirmar que nenhum dos 26 packs
do compendium SF2e inclui conteúdo exclusivo de Starfinder Infinite. A auditoria
de licença deve ocorrer antes da importação pública (ver `ver 26-licencas-e-legal.md`).

**QA-SF2-07** Não está claro na pesquisa se o SF2e tem regras próprias para itens
mágicos além das augmentações magitech. Em particular: runas existem para armas
Analog, mas existe algum equivalente SF2e para armaduras? Verificar no compendium
JSON antes de finalizar o schema de armor SF2e.

---

## Referências

- `docs/research/11-starfinder2e-foundry.md` — Estado do SF2e no Foundry; relação
  com PF2e; dados disponíveis; mecânicas exclusivas; implicações para o Fusion.
- `docs/research/13-pf2e-sf2e-mecanicas-nucleo.md` — Mecânicas centrais SF2e:
  classes, armas tech, tiers, augmentações, zero-g, cobertura, créditos, starship combat.
- [Archives of Nethys SF2e](https://2e.aonsrd.com) — SRD oficial com todas as regras publicadas.
- [GitHub: foundryvtt/pf2e](https://github.com/foundryvtt/pf2e) — Repositório Apache-2.0
  com compendium packs SF2e em JSON.
- [Starfinder Player Core — Paizo](https://store.paizo.com/starfinder-2e-player-core/)
- [Starfinder Tech Core — Paizo](https://store.paizo.com/starfinder-tech-core/)
- [Paizo — Licenças ORC](https://paizo.com/licenses)
- `ver 15-api-de-sistemas.md` — System API; contratos de registro.
- `ver 16-compendiums-e-importacao.md` — Pipeline de importação e estrutura de packs.
- `ver 17-sistema-pf2e.md` — Engine 2e compartilhado; modelo de dados base PF2e.
- `ver 10-combate-e-iniciativa.md` — CombatType extensível; lifecycle events.
- `ver 26-licencas-e-legal.md` — Análise de licença ORC e Apache-2.0.
