# Molde de Ficha de Referência — Onda 7

**Objetivo:** Arquivo-molde para aceite não-circular das 29 fichas PF2e (níveis 1–3).

**Fonte de verdade:** Manual do Player Core Remaster + errata oficial, nunca dados dos packs.

---

## Como usar este molde

### 1. Chassis Comum (Imutável)

As 29 fichas usam **exatamente a mesma** ancestralidade, antecedente e distribuição de atributos. Isso torna as divergências atribuíveis à classe, não à combinação.

**Fixado (2026-09-22, Onda 7 fixer — achado C4, Alexandre indisponível, decidido pela regra do PF2e e registrado em `ficha3-reports/o7/fix-r1.md`; corrigido de novo na rodada 2, `fix-r2.md`, porque a rodada 1 ainda era ilegal em três pontos):**

- **Ancestralidade:** Human (Humano)
- **Herança:** Skilled Human (Humano Habilidoso) — treinado em Diplomacia no nível 1; Perito na mesma perícia a partir do nível 5. **Correção da rodada 2:** NÃO concede talento de perícia geral (isso é Versatile Human, uma herança diferente — a rodada 1 confundiu as duas).
- **Talento de ancestralidade (nível 1):** Cooperative Nature (+4 de circunstância em Auxiliar; a rodada 1 registrava +2, errado — conferido no pack)
- **Antecedente:** Scholar (Erudito) — treina Erudição Acadêmica (Lore, sempre) + uma perícia à escolha entre Arcana/Natureza/Ocultismo/Religião (Arcana escolhida arbitrariamente). **Correção da rodada 2:** o antecedente NUNCA treina Sociedade — a rodada 1 afirmava isso, errado (conferido no pack: a lista de escolha do Scholar é Arcana/Nature/Occultism/Religion). Scholar também concede o talento Assurance na perícia escolhida, mas essa escolha é um `ChoiceSet` ainda não implementado no motor (mesma limitação da perícia da Skilled Human) — pendência registrada, não bloqueia o resto do chassi.
- **Idiomas:** Comum + 2 extras (Élfico + Anão) — **correção da rodada 2:** Human ganha `additionalLanguages.count: 1` da própria ancestralidade SOMADO ao modificador de INT (aqui +1) = 2 extras, não 1 como a rodada 1 registrava. Para as 4 classes de habilidade-chave Inteligência (Wizard, Investigator, Inventor, Witch), o total sobe para 3 extras (INT do chassi vira 14, mod +2, +1 da ancestralidade). "Elvish" também foi corrigido para "Elven" — é o slug real do pack.
- **Atributos no nível 1** (antes do boost de habilidade-chave de cada classe, que soma +2 por cima e varia por classe):
  - STR: 14, DEX: 14, CON: 14, INT: 12, WIS: 14, CHA: 10
  - Boosts: ancestralidade em FOR/CON/DES (3 — ver pendência de pack abaixo), antecedente em INT (obrigatório)/SAB (livre), 4 boosts livres em FOR/DES/CON/SAB. Todos os valores são pares e alcançáveis (nenhum atinge 18, então nenhum boost cai para +1) — os valores anteriores (INT 13, CAR 11) eram ilegais: a partir de 10, só boosts de +2 (ou +1 acima de 18) são possíveis.
  - **Pendência de pack (rodada 2, não é regra do livro):** `ancestries-core` "Human" tem `boosts: ["free","free","free"]` (3, o Player Core Remaster manda 2) e uma `flaws: ["free"]` inerte (o motor a descarta, sem efeito numérico — não é uma habilidade real). O chassi absorve o 3º boost em Destreza explicitamente, em vez de deixá-lo cair por acidente no primeiro candidato do harness — DEX subiu de 12 para 14 por causa disso. Corrigir o pack é uma issue separada (ver seção Pendências do `fix-r2.md`).

Aplicar o chassi a **todas as 29 classes** sem variação. O boost de habilidade-chave de cada classe (+2, específico por classe) soma-se a estes valores e fica para T7.4 (preenchimento por classe).

### 2. O Que Preencher

#### Obrigatório

- **Escolhas de classe:** divindade (Cleric, Champion), research field (Alchemist), eidolon type (Summoner), etc.
- **Chassis:** ancestralidade, antecedente, atributos (una única vez, depois copia para todas as 29)

#### Verificar e Eventualmente Editar

- **Nomes de perícias treinadas:** variam por classe; listar exatamente conforme o livro
- **Talentos concedidos:** não pré-preencher; o builder deve fornecer; copiar do livro (ex: Ranger nv1 recebe "Hunted Shot" ou similar)
- **Proficiências:** listar por categoria (simples, marcial, defesa) conforme a classe

### 3. Campos Sempre em BRANCO

**NUNCA pré-preencher:**

- **HP** — derivado de classe + CON + aro de tamanho
- **CA** — derivado de DEX + treinamento + armadura
- **Salvaguardas (Fortitude, Reflex, Will)** — derivadas de atributos + treinamento
- **Slots de magia** — estrutura por círculo (dada) + proficiência (derivada)
- **Magias** — reservório espontâneo de conjuradores (repertório conhecido, não predeterminado)
- **Pool de foco** — derivado de features de classe
- **Idiomas** — ancestralidade (Human pega 1 extra) + INT modificador

> **Por quê em branco?** Preencher com dados dos packs reintroduziria a circularidade da #48: teste circular conviveu com 60 defeitos invisíveis. A fonte é externa (livro), não interna (pack).

### 4. Lotes

#### Lote 1 (8 Classes) — Um Representante de Cada Mecanismo

Prioridade: apareça defeito de mecanismo cedo, conserte antes de contaminar o lote 2.

1. **Fighter** — marcial puro
2. **Ranger** — marcial + animal companion (testa companheiro)
3. **Cleric** — divino preparado + divindade obrigatória
4. **Bard** — espontâneo com repertório
5. **Magus** — híbrido marcial + magia
6. **Alchemist** — research field (testa mecanismo de escolha)
7. **Summoner** — companheiro (testa criação de dois atores)
8. **Kineticist** — elemento + impulso cinético

#### Lote 2 (21 Classes) — Cobertura de Dado

Barbarian, Rogue, Monk, Gunslinger, Swashbuckler, Investigator, Guardian, Wizard, Sorcerer, Witch, Druid, Oracle, Psychic, Animist, Thaumaturge, Inventor, Champion, Exemplar, Necromancer, Runesmith.

---

## Ordem de Execução do Preenchimento

1. O **chassis comum** já está fixado (ver seção 1 acima): Human/Skilled Human/Cooperative Nature, Scholar, STR/DEX/CON/INT/WIS/CHA = 14/14/14/12/14/10 (antes do boost de habilidade-chave da classe)
   - Só reabrir (`metadata.chassis_common`) com instrução literal do Alexandre

2. **Lote 1 (8 classes):** preencher manualmente, um por um, lendo o Player Core Remaster
   - Cada entrada pode levar 10–15 min
   - Total lote 1: ~2h

3. **Lote 2 (21 classes):** idem
   - Total lote 2: ~3.5h

4. **Total estimado:** ~5.5h de trabalho manual

---

## Campos Específicos por Tipo de Classe

### Marcial (Fighter, Ranger, Barbarian, Rogue, Monk, Gunslinger, etc.)

```json
{
  "proficiencies": {
    "attacks": ["simple", "martial"],  // ou incluir "advanced" se aplicável
    "defense": "trained"               // ou "expert"
  },
  "trained_skills": ["Athletics", "Perception"],  // nomes exatos
  "granted_feats": ["Feat Name", ...],
  "focus_pool": null
}
```

### Conjurador — Preparado (Cleric, Wizard)

```json
{
  "spells": {
    "circle_0_cantrips": ["Cantrip Name", ...],
    "circle_1_prepared": ["Spell Name", ...],  // lista preparada, não slot vazio
    "circle_1_slots": 2,
    "circle_2_slots": 0  // Wizard nv3 ganha círculo 2
  }
}
```

### Conjurador — Espontâneo (Bard, Sorcerer, Psychic)

```json
{
  "spells": {
    "circle_0_cantrips_known": ["Cantrip 1", "Cantrip 2"], // conhecidas
    "circle_1_slots": 2,
    "circle_1_spells_known": ["Spell 1", "Spell 2"], // repertório
    "focus_pool": 1
  }
}
```

### Com Companheiro (Ranger, Summoner + eidolon)

```json
{
  "animal_companion": {
    "type": "Wolf",  // ou similar
    "hp": null,
    "ac": null,
    "saves": { "fortitude": null, ... }
  }
}
```

### Summoner (Dois Atores)

```json
{
  "eidolon": {
    "type": "Winged",  // ou outra forma escolhida
    "hp": null,
    "ac": null,
    "saves": { "fortitude": null, ... }
  }
}
```

---

## Validação (Automática, Onda 7)

Após preencher, o teste `T7.2` (comparador) vai:

1. Criar a ficha pelo builder
2. Comparar cada campo com o molde preenchido
3. Reportar divergências

Se o campo foi deixado em branco no molde (como deve ser para valores derivados), o teste vai ignorar.

Se o molde tem um número explícito (ex.: `hp: 12`), o teste vai exigir correspondência.

---

## Notas Importantes

- **Não inferir dados.** Só preencher com o livro na mão.
- **Não pre-preencher derivados.** HP, CA, salvaguardas, etc. ficam `null`.
- **Não editar o arquivo `character-templates.json` à mão depois de começar a preencher.** Cada classe tem um subsection; editar diretamente ou via ferramenta aprovada.
- **Registrar cada preenchimento.** Para rastreabilidade: anotar data/hora e página do livro ao lado (comentário ou campo `source_page` se necessário).

---

## Contato

Se surgir dúvida sobre um campo ou um valor do livro conflitar com o esperado pelo builder, abrir uma issue no repo (`xansde/fusion`) com o título "T7.1: [classe] — [dúvida]" e a página do livro citada.
