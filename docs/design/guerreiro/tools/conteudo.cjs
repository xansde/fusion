#!/usr/bin/env node
/** Escreve as notas de cobertura de conteúdo do Guerreiro no vault. */
const fs = require("fs");
const path = require("path");
const OUT =
  "C:/Users/xansd/OneDrive/Área de Trabalho/Nova pasta/Documentos/Obsidian vaults/Claude Seazone/Projects/fusion/guerreiro/conteudo";
const HOJE = "2026-09-16";
fs.mkdirSync(OUT, { recursive: true });

const notas = {
  "gue-conteudo-armas": {
    fm: `type: conteudo-pf2e
classe: guerreiro
name: "Armas — cobertura no Fusion"
armas_total: 30
grupos_presentes: 11
grupos_pf2e: 16
traits_fatal: 0
traits_free_hand: 0`,
    body: `# Armas — cobertura no Fusion

O Guerreiro é a classe que vive da arma que empunha: a maestria dele é por **grupo de arma**, e
dezenas de talentos testam um trait (ágil, acuidade, alcance, arremesso, derrubar, desarmar).
Por isso o pack de armas é, para esta classe, tão crítico quanto o pack de talentos.

\`external/fusion-systems-2e/systems/pf2e/packs/weapons-core/documents.json\` tem **30 armas**:
19 marciais, 10 simples, 1 avançada (Gnome Flickmace). Nenhuma desarmada (vêm de outro lugar).

## Grupos

Presentes (**11 de 16**): sword (5), club (4), bow (4), axe (3), flail (3), crossbow (2),
knife (2), dart (2), hammer (2), spear (2), sling (1).

Ausentes: **Bomb, Brawling, Firearm, Pick, Polearm, Shield**. Um Guerreiro que escolhesse maestria
em Polearm, Firearm ou Brawling não teria nenhuma arma do grupo no jogo — e, de todo modo, a
escolha do grupo não existe (ver [[mec-weapon-group]]).

## Traits que as regras do Guerreiro testam

| Trait | Armas | Observação |
|---|---|---|
| \`agile\` | 5 | Dagger, Dart, Hatchet, Kukri, Shortsword |
| \`finesse\` | 5 | Dagger, Kukri, Rapier, Shortsword, Whip |
| \`deadly\` | 5 | arcos (d10) e Rapier (d8) |
| \`fatal\` | **0** | buraco total |
| \`reach\` | 3 | Bo Staff, Gnome Flickmace, Whip |
| \`two-hand\` | 2 | Bastard Sword (d12), Staff (d8) |
| \`thrown\` | 7 | Club, Dagger, Dart, Hatchet, Javelin, Spear, Trident |
| \`free-hand\` | **0** | buraco total |
| \`shove\` | 2 | Maul, Warhammer |
| \`trip\` | 4 | Bo Staff, Flail, Kukri, Whip |
| \`disarm\` | 3 | Flail, Rapier, Whip |

\`fatal\` e \`free-hand\` zerados são o achado que importa: o motor até calcula dano crítico por
trait, mas **não há nenhuma arma no jogo para exercitar \`fatal\`** — o que também esconde o defeito
registrado em [[mec-deadly-fatal]] (fatal tratado como deadly). E \`free-hand\` é o trait que
sustentaria boa parte dos talentos de mão livre (ver [[mec-new-hand-state]]).

## Mecanismos

- ❌ [[mec-weapon-group]]
- 🟡 [[mec-deadly-fatal]]
- ❌ [[mec-new-hand-state]]

## Relacionados

- [[guerreiro-indice]]
- [[guerreiro-lacunas]]
`,
  },
  "gue-conteudo-acoes": {
    fm: `type: conteudo-pf2e
classe: guerreiro
name: "Ações básicas — cobertura no Fusion"
acoes_referenciadas: 14
acoes_presentes: 14
pack_total: 521`,
    body: `# Ações básicas — cobertura no Fusion

Os textos dos 129 documentos do Guerreiro referenciam **14 ações básicas** distintas: Recall
Knowledge, Raise a Shield, Shove, Escape, Reposition, Disarm, Hide, Take Cover, Leap, Reactive
Strike, Trip, High Jump, Long Jump, Demoralize.

O pack \`actions-core\` do pin v0.1.1 tem **521** ações, e as **14 de 14 estão presentes**. Nenhuma
ausente — a cobertura de dado aqui é completa.

## A ressalva que muda tudo

Existir no pack significa existir como **documento navegável com descrição**. A aba Ações da ficha
é um browser de texto, não um executor: nenhuma dessas ações é clicável para rolar contra a CD de
alguém. Derrubar, Agarrar, Empurrar, Desarmar e Reposicionar aparecem em 16 documentos do Guerreiro
e continuam sendo ❌ [[mec-maneuver]] mesmo com o documento publicado.

Esse é o padrão que o inventário do Alquimista já tinha registrado para a aba de Ações, e que se
repete aqui: **presença no pack ≠ ação executável**.

## Mecanismos

- ❌ [[mec-maneuver]]
- ❌ [[mec-raise-shield]]
- ❌ [[mec-new-skill-vs-dc]]

## Relacionados

- [[guerreiro-indice]]
- [[guerreiro-lacunas]]
`,
  },
  "gue-conteudo-condicoes": {
    fm: `type: conteudo-pf2e
classe: guerreiro
name: "Condições — cobertura no Fusion"
condicoes_referenciadas: 16
condicoes_presentes: 16
pack_total: 43`,
    body: `# Condições — cobertura no Fusion

Os documentos do Guerreiro referenciam **16 condições** distintas: Off-Guard (16 vezes — a mais
citada de todo o inventário), Frightened (5), Stunned, Concealed, Grabbed, Prone, Hidden, Invisible,
Clumsy, Drained, Enfeebled, Confused, Restrained, Undetected, Slowed, Quickened.

O pack \`conditions\` do pin tem **43** condições, e as **16 de 16 estão presentes**.

## O que já funciona, e o que não

Off-Guard tem motor de verdade: modificador de -2 na CA mais roll option
(\`external/fusion-systems-2e/systems/pf2e/src/conditions.ts:122-131\`), com o toggle testado ponta
a ponta. O problema não é a condição — é **de onde ela vem**:

- **Flanquear não gera off-guard**: não há geometria de posição ligada a regra em nenhum dos dois
  repos (❌ [[mec-off-guard-pos]]).
- **Ninguém aplica condição em outro ator a partir do jogo**: fila de combate, cabeça de turno e
  painel de NPCs só exibem chips; o único caminho de escrita é a ficha aplicando em si mesma
  (🟡 [[mec-condition]]).

Ou seja: o Guerreiro impõe condição em 22 documentos, e em nenhum deles o alvo recebe a condição
sozinho — é sempre o Mestre marcando à mão.

## Mecanismos

- 🟡 [[mec-condition]]
- ❌ [[mec-off-guard-pos]]

## Relacionados

- [[guerreiro-indice]]
- [[guerreiro-lacunas]]
`,
  },
  "gue-conteudo-efeitos": {
    fm: `type: conteudo-pf2e
classe: guerreiro
name: "Efeitos — cobertura no Fusion"
efeitos_referenciados: 4
efeitos_presentes: 0`,
    body: `# Efeitos — cobertura no Fusion

Quatro documentos do Guerreiro aplicam um documento de efeito do vendor: \`Effect: Assisting Shot\`,
\`Effect: Guardian's Deflection\`, \`Effect: Resounding Bravery\` (todos \`feat-effects\`) e
\`Effect: Cover\` (\`other-effects\`).

**Nenhum dos quatro existe.** O pin v0.1.1 publica 15 packs (actions-core, ancestries-core,
ancestry-features-core, backgrounds-core, bestiary-core, classes-core, class-features-core,
conditions, equipment-core, familiar-abilities-core, feats-core, heritages-core, spells-core,
weapons-core) e **nenhum é de efeitos**. Existe o *tipo* de documento
(\`systems/pf2e/src/schemas/item-effect.ts\`) e existe o motor que leria as regras de um efeito —
não existe o conteúdo.

Confirma, para o eixo marcial, o mesmo achado que o inventário do Animista registrou para as
magias: [[ani-conteudo-efeitos]] contou 13 efeitos referenciados e 0 presentes.

## Mecanismos

- 🟡 [[mec-effects-pack]]
- ❌ [[mec-effect-dur]]

## Relacionados

- [[guerreiro-indice]]
- [[guerreiro-lacunas]]
- [[ani-conteudo-efeitos]]
`,
  },
  "gue-conteudo-arquetipo": {
    fm: `type: conteudo-pf2e
classe: guerreiro
name: "Arquétipo do Guerreiro — cobertura no Fusion"
talentos_arquetipo: 6
publicados: 0
pt_br: 0`,
    body: `# Arquétipo do Guerreiro — cobertura no Fusion

Um personagem de outra classe que quisesse a dedicação de Guerreiro não consegue: **Fighter
Dedication não está publicada**. O pack \`feats-core\` tem 1.807 talentos e apenas **6** com o trait
\`dedication\` — Alchemist, Avenger, Bloodrager, Rogue, Runelord e Vindicator. Nenhuma do Guerreiro.

## O trabalho já existe, parado no meio do caminho

A extração local do vendor no **core** (\`tools/importer-pf2e/out/feats/\`, 5.987 talentos, três
estágios: \`raw\` → \`normalized\` → \`transformed\`) já tem os **6 talentos do arquétipo do
Guerreiro**, com a conversão de regra quase limpa:

| Talento | Nível | Regras não convertidas |
|---|---|---|
| Fighter Dedication | 2 | 2 |
| Basic Maneuver | 4 | 1 |
| Fighter Resiliency | 4 | 0 |
| Reactive Striker | 4 | 0 |
| Advanced Maneuver | 6 | 0 |
| Diverse Weapon Expert | 12 | 0 |

Nenhum tem pt-BR, e nenhum está em pack publicado. O submodule não tem a pasta \`out/\` — a
extração vive só no core.

## O que falta

Levar os 6 da saída do importador para o pipeline de curadoria e publicação do satélite, traduzir,
e aí sim avaliar mecanismo. Hoje a lacuna é **de dado**, não de motor — e é diferente da do
Animista, onde publicar a dedicação exigia código novo.

## Mecanismos

- 🟡 [[mec-archetype]]

## Relacionados

- [[guerreiro-indice]]
- [[guerreiro-lacunas]]
`,
  },
};

for (const [slug, n] of Object.entries(notas)) {
  const content =
    "---\n" +
    n.fm +
    `\ntags: [fusion, guerreiro, conteudo]\ncreated: ${HOJE}\nupdated: ${HOJE}\n---\n\n` +
    n.body;
  fs.writeFileSync(path.join(OUT, slug + ".md"), content, "utf8");
  console.log("escrito: " + slug);
}
