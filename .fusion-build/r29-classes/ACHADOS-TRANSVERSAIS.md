# r29 — Achados transversais do levantamento das 12 classes

> Consolidado pelo orquestrador a partir dos 12 relatórios por classe, com o que
> **não cabe** num relatório de classe: defeitos vivos na base atual, lacunas de
> schema que atingem várias classes, e decisões que a integração central precisa
> tomar **uma vez só**. Cada item foi **verificado pelo orquestrador**, não
> apenas repassado do relatório do agente — onde a verificação contrariou o
> agente, está dito.

**Estado**: 12 de 12 levantamentos concluídos (Thaumaturge, Oracle, Summoner,
Exemplar, Animist, Witch, Swashbuckler, Guardian, Commander, Alchemist,
Inventor, Investigator). `loadClassCuration()` carrega **27 classes** sem
colisão; a união de class-features dá **390 nomes** (o dedupe por Set da R1
funcionando). Total: 32 eixos declarados, 11 conjuradoras, 14
`prerequisiteFixes`.

---

## A. Resolvido nesta rodada

### A1. 44 talentos do Psychic vazavam para o picker de toda classe — CORRIGIDO

Commit `f068074`. `KNOWN_CLASS_TRAITS` existia duplicado byte a byte em
`planVM.ts` e `characterSheetVM.ts`, sincronizado à mão porque o import reverso
faria ciclo (planVM já importa de characterSheetVM). Nada obrigava a sincronia e
nada comparava a lista com os packs.

Faltavam **6 slugs**: `animist`, `commander`, `exemplar`, `guardian`,
`psychic`, `thaumaturge`. Cinco são classes ainda não publicadas — falta sem
efeito. Mas o **Psychic está no pack desde o #95**: sem o slug, um talento cujo
único traço de classe é `psychic` não "parece taggeado" no ramo `classFeat` de
`isFeatEligible`, escapa do filtro e vira elegível para todas as classes.
Medido contra `feats-core`: **44 talentos**. O segundo uso da constante
(`planVM` ~2267) também deixava de sinalizar "classe errada" no plano.

Correção: lista extraída para `classTraits.ts` (terceiro módulo quebra o ciclo),
agora com as **27 classes do sistema** — entrada sobrando não custa nada,
entrada faltando é o vazamento. Gate novo em `classTraits.test.ts`: **não copia
a lista** (isso passaria com qualquer slug faltando), deriva as classes de
`classes-core` e afirma o comportamento — talento da classe A nunca elegível
para a classe B.

> **Correção a um relatório**: o levantamento do Inventor afirma que `inventor`
> estava ausente da lista e que 54 talentos vazariam. Conferido no commit
> anterior: `inventor` **já estava** lá. Os ausentes eram os 6 acima.

---

## B. Lacunas de schema (nenhuma é decisão de agente de classe)

### B1. Repertório de conjuração espontânea não existe — atinge classes JÁ publicadas

`spellcastingFor()` emite `cantripsKnown` + `slots`. Não há campo para
**repertório** (quantas magias o personagem _conhece_ por rank), grandeza
diferente do número de slots: o Oracle de nível 1 conhece 2 magias de rank 1 e
tem 3 slots. **Não é dívida nova**: Bard, Sorcerer e Psychic já estão curados e
nenhum declara repertório. O levantamento expôs um buraco no que já
considerávamos pronto.

### B2. Conjuração dupla na mesma classe (Animist)

O Animist tem duas conjurações que não se misturam — animista (preparada) e de
aparição (espontânea), pools próprios. `ClassSpellcastingSchema` aceita uma
entrada por classe. A curadoria carrega só a metade animista (a outra está em
`notes[]`), porque somar seria errado. **Sem uma segunda entrada, a ficha mostra
menos slots do que o personagem tem.**

### B3. Eixo repetível, com progressão, e hospedado fora do `items{}`

Quatro classes esbarraram na mesma limitação de `choiceAxes`, cada uma de um
jeito:

| Classe | Forma real | Como foi declarado |
| --- | --- | --- |
| Thaumaturge | mesmo eixo reabre em L1/L5/L15, sem excluir opção já escolhida | 3 entradas com a **mesma** `otherTag` — padrão inédito |
| Animist | escolhe N de 13, N cresce 2→3→4, **re-selecionável por dia** | `choose: 2` (primeira curadoria a não usar 1; campo é dado morto hoje) |
| Witch | `witch-lesson` é repetível **por talento de classe** (Basic L2 / Greater L6 / Major L10) | primeiro eixo em 16 classes **sem concessora no `items{}`**; `featureNameInItemsMap` preenchido sem alvo real |
| Exemplar | "Additional Ikon" é escolha que **concede outra escolha** | dívida declarada (lacuna que o `bard.json` já apontava) |

O loader deriva `category` da `otherTag`, então entradas repetidas colapsam num
`Map`. **É uma decisão só, não quatro.** A Witch sugere o contrato
`grantedByName` + `grantedByKind` para eixo hospedado em feat.

### B4. Quarta forma de escolha: opções que não são `classFeature` (Commander)

"Sem eixo" era verdade só em `class-features/**` (0 de 842). O eixo real do
Commander são **37 tactics em `actions/class/commander/`** — documentos do tipo
`action`, com 5 otherTags de tier —, escolhidos por ChoiceSet+GrantItem embutido
em 4 features do `items{}` e no feat repetível "Tactical Expansion".
`choiceAxes` é estruturalmente incompatível: só processa `classFeature`.
**Conteúdo não falta** (os 37 já estão em `actions-core`, que não depende de
curadoria) — falta o picker.

### B5. GrantItem dinâmico calculado a partir de escolha anterior — 3 classes

Mesma família, três graus de dificuldade:

- **Thaumaturge**: Adept/Paragon Benefit (20 docs) com lista computada de
  `flags.system.thaumaturge.adeptChoices`.
- **Alchemist**: Field Discovery / Advanced Vials / Greater Field Discovery
  (12 docs) via `{actor|flags.system.alchemist.*}`.
- **Inventor**: árvore de **46** class-features de modificação filtradas por
  predicado dinâmico sobre o item escolhido; Construct/Light Mortar só têm
  modificações em prosa, sem `@UUID`.

Nenhum entrou em `choiceAxes`. Resolver de uma vez, não três.

### B6. A convenção `<classe>-<eixo>` não é universal

`animistic-practice` (adjetivo, não o slug) quebra a derivação por prefixo do
§4 R3 do PLANO; a curadoria do Animist declara `category` explicitamente. Há
ainda um **typo no vendor**: `ready-aim-fire.json` traz `vcommander-master-tactic`.

### B7. `traditionByBloodline` virou mecanismo de três classes

Hoje é exclusivo do Sorcerer, e o `if (slotType === "bloodline")` de
`planVM.ts:~4099` é o único gatilho. **Summoner** (tradição vem do eidolon) e
**Witch** (tradição vem do patron: occult 6 / primal 6 / divine 3 / arcane 1)
declararam `tradition: null` + o mapa nesse mesmo campo, por ser o único que
`spellcastingFor()` propaga. Sem generalizar o gatilho, **as duas saem sem
entrada de conjuração e sem pool de foco** — e o fallback `"arcane"` erraria em
15 dos 16 patrons da Witch. Sugestão vinda da Witch: renomear para
`traditionByAxisOption`.

---

## C. O custo do piloto do Druid não se generaliza

A r28 mediu que a 15ª classe custou **1 arquivo de curadoria + 4 linhas no
`planVM` + 6 entradas no `choiceSetInventory`**, sem tocar
`transform.mjs`/`build-mvp-subset.mjs`. Isso vale para as classes de eixo
simples (Guardian, Swashbuckler, Investigator, Alchemist, Exemplar). **Não vale
para**:

- **Summoner** — B7 + ramo novo em `isSpellsCoreDoc` (o cantrip `Boost Eidolon`,
  concedido no nível 1, não entra no pack) + `Evolution Feat`, feature que
  escolhe um _talento_ por filtro declarativo (nem `CLASS_CHOICE_SLOTS` nem
  `GRANTED_FEAT_CHOICES` cobrem).
- **Animist** — B2 + B3 + B6.
- **Witch** — B7 + B3 + `isSpellsCoreDoc` (17 hexes-cantrip).
- **Commander** — B4.

### C1. Verificação que derrubou um "precedente" citado por dois agentes

Summoner e Witch citaram "o mesmo quirk dos truques de composição do Bard" como
defeito conhecido de `isSpellsCoreDoc`. Medição do orquestrador contra o vendor
e o pack: **os 20 spells com trait `composition` estão todos em `spells-core` —
faltando zero**. O quirk é **prospectivo** (atinge os 17 hexes-cantrip da Witch
quando ela entrar), não um defeito vivo do Bard.

### C2. Teste que reprova ao publicar

`pregen-parity.test.ts:192` tem `expect(CLASSES_WITHOUT_PREGEN).toEqual(["Magus"])`
— literal. Publicar **Summoner** ou **Guardian** reprova até a lista incluí-los
(verificado: não há pregen dessas duas nos 25 personagens de `iconics/`). Gate
deliberado: atualizar com racional, nunca afrouxar. Ao contrário do que as
tarefas presumiam, **existem** pregens de Commander (Ulka), Inventor (Droven),
Animist (Samo) e Thaumaturge (Mios).

---

## D. Dívidas de conteúdo (declaradas, fora do escopo desta rodada)

### D1. Magias faltando em `spells-core`

| Classe | Faltando |
| --- | --- |
| Witch | 17 dos 39 com o trait (todos cantrips-hex) |
| Animist | 16 do repertório de aparição |
| Oracle | 7 das 41 divinas dos mistérios (uma é truque de nível 1) |
| Summoner | 2 de 7 |

Panorama da base: **arcana completa**; divine, occult e primal exclusivas em
torno de 10% (primal 7 de 73, divine 6 de 47, occult 7 de 40).

### D2. Itens alquímicos — o buraco maior

824 itens alquímicos no vendor. Elixir 31/217 (14%) e bomba 24/168 (14%);
**poison 0 de 171 e mutagen 0 de 70 — não existe pack para eles**
(`equipment-core` só aceita potion/elixir/talisman). Sem isso, os talentos do
Alchemist não fazem nada. O Inventor tem versão menor do mesmo problema (Power
Suit / Subterfuge Suit ausentes).

### D3. Perícia concedida por opção de eixo — 5 classes pedem o mesmo

Druid (dívida já registrada), Witch, Swashbuckler, Investigator e Oracle
concedem treino de perícia pela opção do eixo, e o pipeline não aplica. No
Investigator o caso é o mais fácil: **todos os documentos concedidos já existem**
nos packs, falta só aplicar o treino.

### D4. Efeitos e atores que não existem

`Effect: Panache` (Swashbuckler) vive em `feat-effects/`, pack fora da nossa
varredura — sem ele, 15 predicados nunca resolvem. Eidolon (Summoner) como ator:
**64 dos 84 documentos jogáveis** dele só produzem efeito com o eidolon
existindo. Companheiro animal (Druid) e construto (Inventor) na mesma família.
Familiar (Witch) é a dívida **menor**: `familiar-abilities-core` está 111/111.

---

## E. Decisões que precisam sair da integração central (uma vez, não por classe)

1. **Gate de multiclasse com traço múltiplo** — feats com trait de mais de uma
   classe: o predicado vira `{"any": [{"class_level": …}, …]}`? Levantado pelo
   Fighter na r21 e repetido por Thaumaturge, Exemplar, Guardian, Alchemist e
   Investigator. **6ª vez que aparece sem decisão.**
2. **B1–B7** acima, cada um uma decisão de schema.
3. **Publicar o Summoner com 64 documentos inertes** enquanto o eidolon não
   existe como ator, ou segurar a classe. (A dúvida "publicar classe legado" está
   respondida: o Magus, também `remaster: false`, foi a primeira classe do
   projeto — ver errata no `summoner-relatorio.md`.)
4. **Catálogo de poison/mutagen** (D2) — decidir se entra pack novo.

---

## F. Defeitos de dado encontrados no vendor (registrados, não corrigidos)

- `ready-aim-fire.json` com a tag `vcommander-master-tactic` (typo).
- O journal `classes.json` embeda o UUID de "Military Expertise" (Commander) na
  seção "Unbreakable Expertise" do Guardian.
- Um arquivo de tactic do Commander mal-pasteado com conteúdo de Exemplar.
- 5 tactics de splatbook sem tag de tier.
- `Wish Market` (Animist) é focus spell órfã: nenhum documento do vendor a concede.
- 15 dos 65 candidatos do Alchemist têm `publication.remaster: false`, um deles
  com nota textual de incompatibilidade com o Alchemist do Player Core 2.

## G. Correção pendente em curadoria já mergeada

`sorcerer.json` afirma que o Counterspell da Witch é **Spontaneous**; o
documento (`EpBG4CFMNSZQx7vI`) é **Prepared**. Achado pelo levantamento da
Witch, que corretamente **não editou** arquivo de outra classe.
