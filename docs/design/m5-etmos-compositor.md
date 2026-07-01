# M5 — Compositor de Magias por Partículas (Etmos)

> **Documento de design arquitetural.** Pré-batch M5 (sistema Etmos). Detalha o
> **Compositor de Magias** — a peça central e inédita do Etmos, sem equivalente
> no PF2e para copiar de molde. Fonte de requisitos: `specs/19-sistema-etmos.md`
> (REQ-ETM-_). Fonte canônica de regras: `docs/research/12b-etmos-fontes-locais.md`
> (§3, §9, §11, §12, §18) e os packs já estruturados em
> `systems/etmos/packs-src/_.json`.
>
> **Escopo deste doc:** modelo de dados, motor de composição no servidor, UI do
> compositor no cliente, fichas mínimas, plano de batches M5 e riscos. **Não**
> reescreve a spec 19 — a operacionaliza para execução multi-agente.
>
> **Clean-room / legal.** Nenhum código, arte ou prosa proprietária. Apenas
> identificadores mecânicos (palavras Etmos, nomes de Partículas) — precedente já
> aberto pelos `packs-src` commitados. Material Balde Galáctico não vai ao remoto
> além desses identificadores. Distribuição do pacote depende de autorização
> editorial (spec 19 Q2 / `specs/26`); não bloqueia o desenvolvimento local.
>
> **Convenções.** TS strict; rolagens SEMPRE no servidor; nenhuma dependência
> nova. Código/identificadores em inglês, docs em pt-BR.

---

## 0. TL;DR das decisões-chave

1. **Frase Mágica = Item `frase_magica` embedded no Actor** (favoritos/"magia
   conhecida"), e **card de conjuração = ChatMessage com flag `etmos.conjuracao`**
   como máquina de estados (`proposta→arbitrada→rolada→resolvida`). A composição
   viva (antes de salvar) é estado de VM no cliente; o servidor só vê o payload
   ao propor.
2. **Slots referenciam Partículas por `slug` estável** (ex.: `et`, `imu`, `mor`),
   não por `_id` embedded — o Grimório e os packs compartilham o mesmo slug, e a
   frase precisa sobreviver a re-import de packs. `_id` embedded é resolvido só
   para exibição.
3. **O motor valida a SINTAXE (determinística) e calcula CUSTO (determinístico);
   a COMPLEXIDADE é arbitrada pelo Narrador** (9 parâmetros subjetivos do SRD, não
   automatizáveis — D4/D8 da spec 19). Isto separa limpo o automatizável do
   arbitrado.
4. **Grau de sucesso binário próprio** (`success`/`failure` + margem), via
   `computeDegreeOfSuccess` — conjunto próprio do Etmos, sem reusar os 4 graus da
   engine-2e (D6).
5. **Três extensões mínimas à `system-api`** são necessárias (todas pequenas e
   genéricas, úteis a outros sistemas): (a) superfície de **roll data**
   registrada, (b) superfície de **degree-of-success** registrada, (c)
   **`compare(a,b)` na initiative formula**. Detalhadas em §2.6. Tudo o mais cabe
   na API atual (chatCard, action, derive, condition, setting, hooks).
6. **A frase falada** (`montarFrase`) é função pura, testável, com regras de fusão
   Função+Objeto e posicionamento de Complementos derivadas dos exemplos canônicos
   dos packs.

---

## 1. Modelo de dados

### 1.1 Como uma magia composta é representada

Há **três representações distintas**, propositalmente separadas:

| Representação          | Onde vive                                   | Papel                                                      | Persistência              |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------- | ------------------------- |
| **Composição viva**    | VM do cliente (`CompositorVM`)              | rascunho enquanto o jogador monta                          | efêmera (não persistida)  |
| **Frase Mágica salva** | Item `frase_magica` embedded no Actor       | "magia conhecida"/favorito reutilizável (REQ-ETM-034 [V2]) | persistida no Actor       |
| **Card de conjuração** | `flags.etmos.conjuracao` de uma ChatMessage | a instância negociada GM↔jogador (a máquina de estados)    | persistida na ChatMessage |

**Decisão: `frase_magica` é Item embedded, não documento próprio.** Segue o
precedente PF2e (spell é Item subtype embedded no Actor). Reusa CRUD, ownership,
compendium e a resolução de slug. O card de conjuração **não** é um Item — é uma
ChatMessage flag, porque seu ciclo de vida é o do chat (histórico, reconexão,
broadcast redigido), exatamente como decidido na spec 19 D5.

### 1.2 Slots e por que slug, não `_id`

Uma Frase referencia Partículas. Cada slot guarda o **slug estável** da Partícula
(o `id` do pack: `"et"`, `"imu"`, `"mor"`, `"ada"`…), **não** o `_id` da cópia
embedded no Grimório. Motivos:

- O mesmo slug identifica a Partícula no pack (`particulas.json`) e no Grimório
  do Actor. Uma frase salva sobrevive a re-import/reset de packs.
- A validação de "o Orador conhece esta Partícula?" é `grimorio.has(slug)`.
- `_id` embedded é resolvido apenas para render (ícone/placeholder, tooltip).

Para Complementos Criadores que se ligam a uma Característica (`Ada-`, `No-`,
`Mut-`) ou entre duas (`Ag`), o slot carrega o **vínculo** (a qual Característica/
posição o Criador se aplica), não só o slug — ver §1.4.

### 1.3 Schema Zod esboçado

Tipos auxiliares (reusam os da spec 19 §Modelo de dados):

```ts
// systems/etmos/src/types.ts
export const Complexidade = z.enum(["trivial", "regular", "dificil", "complexa", "milagre"]);
export type Complexidade = z.infer<typeof Complexidade>;

export const CategoriaParticula = z.enum(["funcao", "objeto", "caracteristica", "complemento"]);
export const SubtipoComplemento = z.enum(["modificador", "criador"]);
```

**Item Partícula** (compendium + Grimório embedded) — REQ-ETM-003/046:

```ts
// systems/etmos/src/schemas/item-particula.ts
export const ParticulaSystemSchema = z.object({
  slug: z.string().min(1), // "et", "imu", "mor", "ada" — estável, = id do pack
  palavra_etmos: z.string().min(1), // "Et", "Imu", "Mor", "Ada-"
  categoria: CategoriaParticula,
  significado: z.string(), // "Controlar", "Mente", "Maior"
  // apenas complementos:
  nivel_grimorio: z.number().int().min(1).max(4).nullable().default(null),
  subtipo_complemento: SubtipoComplemento.nullable().default(null),
  // conectividade sintática (derivada da categoria/subtipo; ver §1.4):
  //   "prefix"   → Ada-/No-/Mut- (prefixa uma característica/objeto)
  //   "connector"→ Ag (entre duas características)
  //   "suffix"   → Mor/Min/San/Sar/Sin/Itam (palavra final)
  //   null       → funções/objetos/características regulares
  ligacao: z.enum(["prefix", "connector", "suffix"]).nullable().default(null),
  descricao: z.string().default(""),
  icone_runico: z.string().nullable().default(null), // placeholder tipográfico no MVP (D7)
  verify: z.boolean().default(false), // dado ambíguo do pack (ex.: "Mat", "Bhas-")
});
```

**Slots resolvidos de uma Frase** — o coração da composição:

```ts
// systems/etmos/src/schemas/frase.ts

/** Um Complemento Criador ligado a um alvo dentro da frase. */
export const CriadorAplicadoSchema = z.object({
  slug: z.string(), // "ada" | "no" | "mut" | "ag"
  // prefix (Ada-/No-/Mut-): índice do característica/objeto-alvo em `caracteristicas`
  // connector (Ag): par de índices [a, b] em `caracteristicas`
  alvo: z.union([z.number().int(), z.tuple([z.number().int(), z.number().int()])]),
});

export const FraseMagicaSystemSchema = z.object({
  funcao_slug: z.string(), // exatamente 1 Função
  objeto_slugs: z.array(z.string()).min(1), // ≥1 Objeto
  caracteristica_slugs: z.array(z.string()).default([]), // 0+ (ordem importa)
  criadores: z.array(CriadorAplicadoSchema).default([]), // Complementos Criadores ligados
  modificador_slugs: z.array(z.string()).default([]), // Complementos Modificadores (finais)
  intencao: z.string().default(""), // texto livre declarado
  // gerado/arbitrado:
  frase_completa: z.string().default(""), // saída de montarFrase() (cache display)
  complexidade: Complexidade.nullable().default(null), // null até arbitragem do Narrador
  estresse_gerado: z.number().int().min(0).default(0), // custo aplicado (Tabela A + rank Totem)
  favorita: z.boolean().default(false), // aparece como "magia conhecida"
});
export type FraseMagicaSystem = z.infer<typeof FraseMagicaSystemSchema>;
```

> Nota de design: separamos `caracteristica_slugs` (a lista ordenada de
> Características puras) de `criadores` (os Complementos Criadores e a que
> Característica cada um se liga) e de `modificador_slugs` (Modificadores finais).
> Essa separação torna `montarFrase()` e `validarFrase()` puras e diretas, e
> espelha a gramática do SRD (§9.1–9.2 do 12b): Criadores modificam Características
> **antes** da montagem; Modificadores são palavras **finais**.

**Card de conjuração** — `flags.etmos.conjuracao` de uma ChatMessage (REQ-ETM-029):

```ts
// systems/etmos/src/schemas/conjuracao-card.ts
export const EstadoConjuracao = z.enum([
  "proposta",
  "arbitrada",
  "rolada",
  "resolvida",
  "recusada",
  "cancelada",
]);

export const ConjuracaoCardSchema = z.object({
  estado: EstadoConjuracao,
  conjurador_actor_id: z.string(),
  frase: FraseMagicaSystemSchema, // snapshot da frase proposta (imutável após propor)
  // preenchido pelo Narrador (arbitragem):
  complexidade: Complexidade.nullable().default(null),
  custo_estresse: z.number().int().nullable().default(null),
  notas_narrador: z.string().default(""),
  // resultado:
  roll_message_id: z.string().nullable().default(null), // vínculo ao ChatMessage da rolagem
  dificuldade_alvo: z.number().int().nullable().default(null),
  sucesso: z.boolean().nullable().default(null),
  margem: z.number().int().nullable().default(null), // total - dc
  classe_dificuldade: z.string().nullable().default(null), // "mediano" | "arduo" | ...
  // controle de Fadiga (Exausto/Esgotado — REQ-ETM-025):
  controle_fadiga: z
    .object({
      rolou: z.boolean(),
      valor: z.number().int().nullable(),
      falhou: z.boolean(),
      morreu: z.boolean(),
    })
    .nullable()
    .default(null),
});
export type ConjuracaoCard = z.infer<typeof ConjuracaoCardSchema>;
```

### 1.4 Regras de conectividade (derivadas dos packs)

O campo `ligacao` de cada Complemento é derivado do pack no boot (não é dado
duplicado — é uma tabela de 10 entradas em `systems/etmos/src/particulas-syntax.ts`):

| slug                          | palavra             | subtipo     | ligação     | posição na frase                                             |
| ----------------------------- | ------------------- | ----------- | ----------- | ------------------------------------------------------------ |
| `mor`,`min`,`san`,`sar`,`sin` | Mor/Min/San/Sar/Sin | modificador | `suffix`    | palavras finais                                              |
| `itam`                        | Itam                | modificador | `suffix`    | palavra final                                                |
| `ag`                          | Ag                  | criador     | `connector` | entre 2 Características (`QuanAgAer`)                        |
| `ada`,`no`                    | Ada-/No-            | criador     | `prefix`    | prefixo de 1 Característica (`adaQuan`, `noTum`)             |
| `mut`                         | Mut-                | criador     | `prefix`    | prefixo de 1 **Objeto** usado como Característica (`Mutexa`) |

Fonte: `particulas.json` (campos `subtipo`/`nivel_grimorio`) + exemplos `exemplo_uso`.

---

## 2. Motor de composição (servidor)

Todo o motor é **funções puras** em `systems/etmos/src/compositor/` (testáveis
isoladamente, REQ-ETM-NFR-001) mais **handlers de socket** no servidor que aplicam
essas funções e persistem/broadcast de forma autoritativa (REQ-ETM-NFR-002/003).

### 2.1 Onde cada peça vive

```
systems/etmos/src/
├── index.ts                       # defineSystem(...) — registro do sistema
├── types.ts                       # enums Zod (Complexidade, Categoria…)
├── particulas-syntax.ts           # tabela ligacao (10 complementos) — pura
├── compositor/
│   ├── montar-frase.ts            # montarFrase() — pura (fusão + posicionamento)
│   ├── validar-frase.ts           # validarFrase() — pura (sintaxe)
│   ├── custo.ts                   # custoEstresse(), complexidadeMaxima() — puras
│   └── degree.ts                  # computeDegreeOfSuccess(), classeDificuldade() — puras
├── derivations/                   # DeriveSteps (limites, fadiga) — puros
├── initiative.ts                  # etmosInitiativeFormula + compare()
├── conjuracao/
│   └── state-machine.ts           # transições válidas + guardas (pura)
└── schemas/                       # Zod: orador, antagonista, particula, frase, habilidade…

packages/server/src/etmos/         # (novo) handlers de socket do Compositor
└── conjuracao-handlers.ts         # propor/arbitrar/rolar/resolver/cancelar
```

Regra arquitetural: `systems/etmos` **não** importa de `server`/`client`
(REQ-ARQ-005). As funções puras vivem no sistema; a orquestração I/O (persistir
ChatMessage, chamar RollService, broadcast) vive no `server`, consumindo as
funções puras e a state-machine do sistema.

### 2.2 Validação da combinação (`validarFrase`) — determinística

Regras do SRD (12b §9.1) traduzidas em predicados puros. Entrada: os slots +
o Grimório do Orador (`Set<slug>`). Saída: `{ valido, erros: string[] }`.

Regras obrigatórias (REQ-ETM-028):

1. **Exatamente 1 Função.** 0 ou >1 → erro.
2. **≥1 Objeto.** 0 → erro.
3. **Características, Criadores, Modificadores são opcionais** (0+).
4. **Toda Partícula usada deve estar no Grimório** do conjurador (por slug), salvo
   override do Narrador. (Complementos de nível 1 estão disponíveis por padrão —
   12b §5; mas ainda checamos que o nível do Grimório do Orador cobre o
   Complemento: `Ag` exige nível 2, `Ada-/No-/Mut-` nível 3, `Itam` nível 4.)
5. **Criador `prefix` (`Ada-`,`No-`) liga-se a uma Característica** existente em
   `caracteristica_slugs`; `Mut-` liga-se a um **Objeto** (converte-o em
   Característica). Alvo fora de range → erro.
6. **Criador `connector` (`Ag`) liga exatamente 2 Características** (par de índices
   válido, distintos). Fora disso → erro.
7. **Modificadores (`suffix`) não têm alvo** — apenas se acumulam ao final.
   Duplicar `Mor` e `Min` na mesma frase é permitido pela sintaxe mas gera
   **aviso** (não erro) — arbitragem do Narrador.

Erros são chaves i18n (`etmos.compositor.erro.semFuncao`, etc.), não strings
cruas — REQ-ETM-051.

### 2.3 Montagem da frase falada (`montarFrase`) — determinística

Regra de fusão do SRD (12b §9.1, exemplo canônico `Et`+`Imu`→`Etimu`):

Algoritmo (puro):

1. **Núcleo:** funde `funcao.palavra` + primeiro `objeto.palavra`, minúsculo no
   segundo termo, colando: `Et` + `Imu` → `Etimu`. (Fusão = concatenação
   lowercasing do segundo; validada contra os `exemplo_uso` dos packs — ver §5.)
2. **Objetos extras:** anexados como palavras separadas após o núcleo.
3. **Características:** cada uma vira palavra separada, **na ordem** de
   `caracteristica_slugs`, **exceto** as que são alvo de um Criador:
   - `prefix` (`Ada-`,`No-`): o Criador cola no início da Característica-alvo,
     lowercasing a característica: `Ada-`+`Quan` → `adaQuan`; `No-`+`Tum` → `noTum`.
   - `connector` (`Ag`): funde as duas Características-alvo: `Quan`+`Ag`+`Aer` →
     `QuanAgAer`.
   - `Mut-` prefixa o Objeto-alvo usado como característica: `Mut-`+`Exa`→`Mutexa`.
4. **Modificadores (`suffix`):** anexados por último, cada um palavra separada,
   na ordem escolhida: `… Mor`, `… Min`, `… Itam`.

Saída: `frase_completa` (string exibível) + a lista de tokens (para render por
cor/categoria na UI). Exemplos verificados em §5.

### 2.4 Custo, Complexidade e degree-of-success

**Funções puras** (`custo.ts`, `degree.ts`), todas testadas contra as Tabelas A–D
de `tabelas.json`:

```ts
// Tabela B / C
export function limiteFerimentos(corpo: number): number {
  return 4 + Math.floor(corpo / 2);
}
export function limiteEstresse(alma: number): number {
  return 4 + alma;
}

// Tabela A — Complexidade Máxima por Mente
export function complexidadeMaxima(mente: number): Complexidade {
  if (mente >= 6) return "milagre";
  if (mente >= 5) return "complexa";
  if (mente >= 3) return "dificil";
  return "regular"; // trivial e regular sempre disponíveis
}

// Tabela A — custo fixo por nível + Rank de Totem (REQ-ETM-024/043)
const CUSTO_BASE: Record<Complexidade, number> = {
  trivial: 0,
  regular: 1,
  dificil: 2,
  complexa: 4,
  milagre: 7,
};
export function custoEstresse(c: Complexidade, rankTotem: number): number {
  // Rank só soma em magia NÃO Trivial (12b §13)
  const extraTotem = c === "trivial" ? 0 : Math.max(0, rankTotem);
  return CUSTO_BASE[c] + extraTotem;
}

// Tabela D — estado de fadiga
export function estadoFadiga(estresse: number, limite: number): EstadoFadiga {
  const d = estresse - limite;
  if (d <= 0) return "normal";
  if (d <= 5) return "cansado";
  if (d <= 8) return "exausto";
  return "esgotado";
}

// D6 — grau binário próprio + margem
export function computeDegreeOfSuccess(
  total: number,
  dc: number,
): {
  degree: "success" | "failure";
  margem: number;
} {
  const margem = total - dc;
  return { degree: margem >= 0 ? "success" : "failure", margem };
}

// Classe narrativa (rótulo/cor separado do grau — 12b §3.4)
export function classeDificuldade(
  total: number,
): "simples" | "facil" | "mediano" | "arduo" | "dificil" {
  if (total < 6) return "simples";
  if (total === 6) return "facil";
  if (total <= 10) return "mediano";
  if (total <= 14) return "arduo";
  return "dificil";
}
```

> **A Complexidade NÃO é calculada.** É escolhida pelo Narrador na arbitragem
> (spec 19 D4). O motor só (a) impede escolher acima da `complexidadeMaxima` do
> conjurador com aviso (REQ-ETM-026, override "Exceder os Limites" = +1
> Complexidade/+2 Estresse), e (b) aplica o custo da Complexidade escolhida.

### 2.5 Resolução da rolagem 2d6 no servidor

O Teste de Conjuração é `2d6 + Alma` (REQ-ETM-018). Fluxo autoritativo:

1. Cliente emite `etmos:conjuracao:rolar` (card em `arbitrada`).
2. Handler do servidor valida permissão (jogador dono do Actor ou Narrador),
   monta a `RollRequest`:
   `{ formula: "2d6 + @atributos.alma.value", rollData: <roll data do Actor>, mode, worldId, userId, actorId }`
   e chama `RollService.roll(req)` (RNG CSPRNG, audit log — já existe).
3. Com `dificuldade_alvo` presente, aplica `computeDegreeOfSuccess(total, dc)` e
   `classeDificuldade(total)`; grava `sucesso`, `margem`, `classe_dificuldade` na
   flag do card e transiciona → `rolada`.
4. **Controle de Fadiga (REQ-ETM-025):** se o conjurador está Exausto/Esgotado e a
   Complexidade ≠ trivial, o servidor rola um **segundo** `2d6` de controle e
   avalia: Exausto → `> Corpo+4` ⇒ magia falha (Estresse ainda acumula); Esgotado
   → `> Corpo+3` ⇒ personagem morre após conjurar. Resultado vai em
   `controle_fadiga` para confirmação narrativa do Narrador.
5. Na **resolução** (`etmos:conjuracao:resolver`, só Narrador), aplica o custo de
   Estresse (`custoEstresse` incl. Rank Totem) ao Actor via `doc:update`,
   recomputa Fadiga pelo DeriveStep, e transiciona → `resolvida`. **Estresse
   acumula mesmo em falha** (REQ-ETM-024).

Toda a aleatoriedade passa pelo `RollService` existente. O sistema Etmos **não**
rola nada — só fornece fórmula, roll data e as funções puras de classificação.

### 2.6 O que reusa da system-api vs. o que exige extensão

**Reusa sem mudança (API atual cobre):**

- `defineSystem` + `defineModel` (Zod dos Actors/Items) — REQ-ETM-001..003.
- `derive({...})` para limites/fadiga/complexidade máxima (DeriveSteps, phase
  `base`/`derived`, topo-sort) — REQ-ETM-007..010.
- `condition({...})` para estados como Inconsciente/Surdo/Inerte (status effects).
- `chatCard({ cardType: "etmos.conjuracao", render })` para o card do compositor —
  REQ-SYS-046. O payload é a flag `ConjuracaoCard`; o render devolve o payload e o
  componente Svelte consome (padrão idêntico ao `pf2e.check`).
- `action({...})` para "Teste de Atributo/Conjuração", "Descanso", "Novo dia
  (reset Dados de Empenho)".
- `setting({...})` para preferências (ex.: exigir Totem no Mundano como bloqueio
  rígido vs. aviso).
- `HookBus` (`turnStart` → reset Reação; `postRoll` → anotar resultado).
- `registerInitiativeFormula(combatType, fn)` para `2d6 + Corpo`.

**Exige extensão mínima da system-api (3 itens — pequenos, genéricos, úteis a
todos os sistemas). A spec 19 já os pressupõe, mas o código atual não os tem:**

| #   | Gap                                                                                                                                                                                                                                                                                                                                                                                                                       | Evidência no código atual                                                                                                                                                             | Extensão mínima proposta                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Roll data registrado.** A spec 19 (REQ-ETM-015) e a 15 falam de `registerRollData(actor → {...})`, mas `SystemRegistrar` não expõe isso hoje. PF2e resolve `@perception` porque o roll data é montado ad-hoc.                                                                                                                                                                                                           | `system-module.ts` não tem `registerRollData`; `roll-service.ts` recebe `rollData` pronto de quem chama.                                                                              | Adicionar `registrar.rollData({ documentType, subtypes, build(doc): Record<string, unknown> })`. O servidor chama `build(actor)` antes de `RollService.roll`. Para o Etmos: expõe `atributos.corpo/alma/mente.value` e bônus de Habilidade.                                                                                                     |
| E2  | **Degree-of-success registrado.** REQ-ROL-038/039 e spec 19 D6 preveem `computeDegreeOfSuccess(total, dc, context)` por sistema, mas hoje só há o `postRoll` hook e o helper de 4 graus **hardcoded na engine-2e** (exclusivo PF2e/SF2e).                                                                                                                                                                                 | `hooks.ts` tem `postRoll`; não há surface de registro de comparador de grau.                                                                                                          | Adicionar `registrar.degreeOfSuccess({ id, compute(total, dc, ctx): { degree: string; meta } })`. Etmos registra o binário próprio. Alternativa sem extensão: implementar tudo no `postRoll` do Etmos (funciona, mas deixa o grau fora do resultado canônico da rolagem). **Recomendação: extensão E2**, pois o grau é dado de primeira classe. |
| E3  | **`compare(a,b)` na initiative.** REQ-ETM-022 exige "jogadores vencem NPCs" — que é **não-monotônico** e NÃO cabe num `tiebreaker` numérico. `InitiativeFormulaResult` só tem `{ formula, tiebreaker, statistic }`; `InitiativeFormulaFn` não carrega `compare`. `sortCombatants` já **aceita** `formula.compare`, mas o registro via `registerInitiativeFormula(combatType, fn)` não deixa o sistema fornecer `compare`. | `combat.ts` `registerInitiativeFormula(combatType, InitiativeFormulaFn)`; `InitiativeFormula.compare` existe em shared e `sortCombatants` o usa, mas não há caminho para registrá-lo. | Estender a assinatura para `registerInitiativeFormula(combatType, { roll: fn, compare? })` (ou aceitar `fn` **ou** objeto, retrocompatível). Etmos fornece `compare`: (1) maior `initiative`; (2) `hasPlayerOwner` vence; (3) maior Corpo. `hasPlayerOwner` já existe em `CombatantDocument` (types.ts:105).                                    |

> Todas as três extensões são **aditivas e retrocompatíveis** (PF2e continua
> funcionando sem tocá-las). São candidatas naturais a um batch **M5-A** de
> fundação antes do compositor. Nenhuma exige dependência nova.

### 2.7 Máquina de estados do card (pura)

`conjuracao/state-machine.ts` expõe `podeTransicionar(de, para, ator)` e
`aplicar(...)`. Transições válidas (spec 19 D5):

```
proposta  ──arbitrar(GM)──►  arbitrada  ──rolar(dono|GM)──►  rolada  ──resolver(GM)──►  resolvida
   │                              │
   ├──cancelar(dono|GM)──► cancelada    └──recusar(GM)──► recusada
   └──cancelar antes de rolada──► cancelada (sem custo)
```

Guardas: só o Narrador arbitra/resolve/recusa; dono do Actor ou Narrador propõe/
rola/cancela. Cancelar só antes de `rolada`. O servidor valida a guarda com
`isRolePrivileged` (`documents/ownership.ts`) — nunca duplicar predicado de
permissão (convenção do projeto).

---

## 3. UI do compositor (cliente)

### 3.1 Encaixe no window manager e no chat existentes

- **Sheet do Orador** registra-se via `sheetRegistry.register("Actor", "orador", OradorSheet, { width: 820, height: 640 })` (padrão idêntico ao PF2e), aberta pelo `windowManager.open({ singletonKey: "sheet:Actor:<id>" })`.
- O **Compositor** é uma **janela dedicada** (`windowManager.open`, singletonKey
  `compositor:<actorId>`), aberta por um botão "Conjurar" na aba Grimório da ficha.
  Reusa `Window.svelte`/`WindowHost.svelte`.
- O **card de conjuração** renderiza no `ChatLog` via `chatCard` `etmos.conjuracao`,
  usando `ChatCard.svelte` como shell — o componente específico é
  `ConjuracaoCard.svelte`.

### 3.2 Fluxo de montagem guiada (REQ-ETM-027)

Componente raiz `Compositor.svelte` + VM `compositorVM.ts` (toda lógica na VM,
componente só renderiza — padrão `CharacterSheetVM`). Passos:

1. **Seleção da Função** (1, obrigatória): grid das Funções do Grimório do Orador
   (agrupadas por cor de categoria). Single-select.
2. **Seleção de Objeto(s)** (≥1): multi-select dos Objetos do Grimório.
3. **Características** (0+): multi-select ordenável (drag ou botões up/down — a
   ordem entra na frase).
4. **Complementos** (0+):
   - **Criadores**: ao escolher `Ada-`/`No-`/`Mut-`/`Ag`, a UI pede o **alvo**
     (qual Característica prefixar, ou qual par conectar) — dropdown restrito aos
     alvos válidos. Bloqueia níveis de Grimório insuficientes com aviso.
   - **Modificadores** (`Mor`/`Min`/`San`/`Sar`/`Sin`/`Itam`): toggles; entram ao
     final.
5. **Intenção** (texto livre, TipTap ou textarea simples): declaração obrigatória
   para o Narrador arbitrar.
6. **Preview ao vivo:** `frase_completa` renderizada com tokens coloridos por
   categoria (placeholder tipográfico, D7) + `validarFrase()` rodando na VM
   (feedback imediato de erros), + **estimativa de custo** por Complexidade
   (mostra o custo de cada nível para o Orador, marcando os acima da
   `complexidadeMaxima`). O custo final só é fixado na arbitragem.

> A validação roda **na VM do cliente para feedback**, mas é **reexecutada no
> servidor** ao propor (autoritativa). O cliente nunca decide sozinho.

### 3.3 Ações do compositor

- **"Propor ao Narrador"** → emite `etmos:conjuracao:propor` com o payload da
  frase (slots + intenção). Servidor valida, cria a ChatMessage `proposta`.
- **"Salvar como magia conhecida"** (REQ-ETM-034 [V2]) → cria Item
  `frase_magica` embedded com `favorita: true`. Reabrir o compositor a partir de
  uma magia salva pré-preenche os slots.
- **"Lançar magia conhecida"** (atalho): abre o compositor já preenchido a partir
  de um favorito e vai direto ao "Propor".

### 3.4 Componente do card (GM↔jogador)

`ConjuracaoCard.svelte` renderiza conforme o estado e o papel:

- **proposta**: mostra frase+intenção; Narrador vê botões
  **[Arbitrar]**/**[Recusar]**; dono vê **[Cancelar]**.
- **Arbitrar** abre um mini-painel (inline ou popover): seletor de Complexidade
  (1–5 como atalho de apresentação, mas persiste o enum textual — REQ-ETM-030),
  custo sugerido auto-preenchido por `custoEstresse`, campo de notas, campo de
  dificuldade-alvo opcional.
- **arbitrada**: dono/GM veem **[Rolar Conjuração]**.
- **rolada**: mostra o resultado da rolagem (via o card de rolagem vinculado),
  a classe de dificuldade colorida, sucesso/falha + margem, e o resultado do
  controle de Fadiga se houve. Narrador vê **[Resolver]** com campo de narração.
- **resolvida/recusada/cancelada**: estado final read-only com o histórico.

Reusa o dice-box 3D existente (a rolagem é uma ChatMessage de rolagem normal,
vinculada por `roll_message_id`).

### 3.5 Esboço de componentes Svelte 5

```
packages/client/src/
├── components/sheets/etmos/
│   ├── OradorSheet.svelte          # ficha do Orador (atributos/derivados/marcos/grimório)
│   ├── AntagonistaSheet.svelte     # ficha de antagonista
│   ├── Compositor.svelte           # janela do compositor (raiz)
│   ├── ParticulaGrid.svelte        # grid selecionável por categoria (reuso 1..4)
│   ├── FrasePreview.svelte         # tokens coloridos + erros + custo estimado
│   └── MarcosTrilha.svelte         # trilha 5×3 clicável
├── components/chat/etmos/
│   └── ConjuracaoCard.svelte       # card do compositor no chat
└── lib/sheets/etmos/
    ├── oradorSheetVM.ts            # VM da ficha (deriva estados, monta ops)
    ├── compositorVM.ts             # VM do compositor (slots, validação, montar frase)
    └── conjuracaoCardVM.ts         # VM do card (transições, botões por papel)
```

Padrão: componentes finos, VMs `$derived` recriadas quando `doc` muda, autosave
debounce → `sendOp` (idêntico a `CharacterSheet.svelte`). As funções puras
(`montarFrase`, `validarFrase`, `custoEstresse`) são **importadas de
`systems/etmos`** e usadas tanto no cliente (feedback) quanto no servidor
(autoritativo) — fonte única de verdade.

---

## 4. Fichas Etmos (delta vs. o padrão PF2e)

Só o necessário para o compositor rodar numa sessão. O que **reusa** do padrão
PF2e (window manager, autosave, tabs, VM, i18n) fica implícito; abaixo só o
**delta**.

### 4.1 Ficha do Orador (`type: "orador"`)

Schema `OradorSystem` conforme spec 19. Delta vs. Character PF2e:

- **Atributos = 3 trilhas de 6 caixas** (Corpo/Alma/Mente), não os 6 abilities
  d20. Componente `AtributoTrilha` (marca até `value`).
- **Derivados por DeriveStep** (não modificadores empilhados): `ferimentos.limite`
  = `limiteFerimentos(corpo)`; `estresse.limite` = `limiteEstresse(alma)`;
  `complexidade_maxima` = `complexidadeMaxima(mente)`; `fadiga.estado` =
  `estadoFadiga(estresse.atual, estresse.limite)`. Três DeriveSteps `base`, sem
  ciclo (leem atributos, escrevem derivados).
- **Trackers**: Ferimentos (+/−, aviso Inconsciente/Morte — REQ-ETM-011),
  Estresse (recomputa Fadiga — REQ-ETM-012), Dados de Empenho (contador +
  botão "novo dia").
- **Aba Grimório**: lista Partículas embedded agrupadas por categoria + botão
  **Conjurar** (abre o Compositor). É o ponto de entrada do diferencial.
- **Marcos de Crescimento**: 3 trilhas de 5 (`MarcosTrilha`), com trigger de
  subida de nível (Tabela E) — REQ-ETM-035..039. Pode ser [V2] interno se o batch
  de compositor precisar priorizar; a sessão mínima não depende dele.
- **Totem**: flags `totem.possui`/`totem.rank` (0–5) — alimentam `custoEstresse`.
- **Conceito**: campos livres (sem mecânica) — controles manuais.

### 4.2 Ficha do Antagonista (`type: "antagonista"`)

Schema `AntagonistaSystem` conforme spec 19. Delta:

- **Ficha Base** (`simples`/`intermediaria`/`avancada`) pré-preenche
  Ferimentos/Estresse/Complexidade/Movimentação/Atributos sugeridos (dados de
  `antagonistas.json`), tudo editável (REQ-ETM-049).
- **Atributos podem ser 0** (antagonistas, ao contrário de Oradores — ver
  `morto-vivo` no pack).
- **Aptidões**: lista livre `{ nome, descricao }` (algumas com `efeito_mecanico`).
- **Ataques**: lista `{ nome, ferimentos: number|null, defesa, alcance, descricao }`
  — antagonistas podem declarar **dano exato** (exceção do SRD, REQ-ETM-050),
  aplicável ao alvo via tracker de combate.
- Sem compositor (antagonistas usam Aptidões/Ataques, não montam frases no MVP).

### 4.3 O mínimo para a sessão do compositor

Para "conjurar uma magia numa sessão": Orador com atributos + Grimório + trackers
de Estresse/Ferimentos + botão Conjurar; e um Antagonista alvo com Ferimentos e um
Ataque. Marcos, Descanso e Encantamento podem ficar para batches posteriores sem
travar a demo do compositor.

---

## 5. Golden fixtures — composições verificadas contra o SRD

Estes exemplos vêm dos `exemplo_uso` canônicos de `particulas.json` e do 12b §9.
O **auditor de cada batch DEVE validar** `montarFrase`/`validarFrase`/`custoEstresse`
contra eles (conferidos à mão). Servem de fixtures de teste (REQ-ETM-NFR-001).

| #   | Slots (slugs)                                                               | Intenção                      | `frase_completa` esperada | Válida?                                       | Complexidade (arbítrio) | Custo Estresse (rank 0) |
| --- | --------------------------------------------------------------------------- | ----------------------------- | ------------------------- | --------------------------------------------- | ----------------------- | ----------------------- |
| G1  | funcao=`et`, objeto=[`imu`]                                                 | Controlar mente               | **Etimu**                 | sim (frase mínima)                            | trivial/regular         | 0 / 1                   |
| G2  | funcao=`ev`, objeto=[`eli`], caract=[`quan`]                                | Encher copo d'água            | **Eveli Quan**            | sim                                           | trivial                 | 0                       |
| G3  | funcao=`ev`, objeto=[`eli`], caract=[`quan`], criador=`ada`→quan            | Criar estacas de gelo         | **Eveli adaQuan**         | sim (Ada- exige Grimório nº3)                 | dificil                 | 2                       |
| G4  | funcao=`al`, objeto=[`ayu`], caract=[`quan`,`aer`], criador=`ag`→(quan,aer) | Dia ensolarado→nebuloso       | **Alayu QuanAgAer**       | sim (Ag exige nº2)                            | regular/dificil         | 1 / 2                   |
| G5  | funcao=`ar`, objeto=[`imu`], caract=[`tum`], criador=`no`→tum               | Impedir alguém de pensar      | **Arimu noTum**           | sim (No- exige nº3)                           | dificil/complexa        | 2 / 4                   |
| G6  | funcao=`un`, objeto=[`imu`], criador=`mut`→(objeto `exa`)                   | Controlar armadura pela mente | **Unimu Mutexa**          | sim (Mut- prefixa Objeto→Característica; nº3) | dificil                 | 2                       |
| G7  | funcao=`em`, objeto=[`ivi`], caract=[`ast`], modif=[`mor`]                  | Correr muito mais rápido      | **Emivi Ast Mor**         | sim                                           | regular                 | 1                       |
| G8  | funcao=`an`, objeto=[`ivi`], caract=[`phys`], modif=[`itam`]                | Curar ferimentos ao sofrê-los | **Anivi Phys Itam**       | sim (Itam exige Grimório nº4)                 | complexa                | 4                       |
| G9  | (inválida) funcao=[nenhuma], objeto=[`imu`]                                 | —                             | —                         | **NÃO** (`semFuncao`)                         | —                       | —                       |
| G10 | (inválida) funcao=[`et`,`ev`], objeto=[`imu`]                               | —                             | —                         | **NÃO** (`multiplasFuncoes`)                  | —                       | —                       |

Notas de verificação:

- G1 é o exemplo fundacional do SRD (`Et`+`Imu`→`Etimu`, a menor frase funcional).
- Fusão só ocorre entre Função e o **primeiro** Objeto; demais partículas são
  palavras separadas — regra derivada de todos os `exemplo_uso` (nunca fundem
  além do núcleo).
- Complexidade nas fixtures é o valor **plausível** que o Narrador arbitraria
  (para testar o custo); o motor não a calcula. O custo é testado dado o par
  (Complexidade, rank).
- Custo com Rank de Totem: G7 com rank 2 e Complexidade regular ⇒ `1 + 2 = 3`
  (fixture adicional G7b para o teste de Totem, REQ-ETM-043/CA-12).

---

## 6. Plano de batches M5 (execução multi-agente)

Modelo idêntico aos batches M3-\* (agentes paralelos + auditoria Opus por batch,
`batch-gated-development`, corte em <95%). Dependências explícitas abaixo.

### M5-A — Extensões de fundação da system-api _(sequencial, bloqueia o resto)_

- **Escopo [MVP]:** E1 roll data, E2 degree-of-success, E3 `compare` na
  initiative (§2.6). Aditivo e retrocompatível (PF2e não muda).
- **Entregáveis:** `registrar.rollData(...)`, `registrar.degreeOfSuccess(...)`,
  `registerInitiativeFormula` aceitando `{ roll, compare }`; testes de
  retrocompat PF2e verdes.
- **Dependências:** nenhuma. **Auditoria:** PF2e continua passando 100%;
  novas surfaces cobertas por teste.

### M5-B — Schemas, packs e funções puras do Etmos _(paralelizável em 2 agentes)_

- **B1 [MVP]:** schemas Zod (`orador`, `antagonista`, `particula`, `frase_magica`,
  `habilidade`, `origem`, `totem`) + `defineSystem` registrando models; build de
  packs (`particulas`/`origens`/`habilidades`/`antagonistas`) a partir dos JSONs
  de `packs-src` (script `build-packs`, sem dep nova). Excluir "Mat" do catálogo
  default (D3); marcar `verify` onde o pack marca.
- **B2 [MVP]:** funções puras do compositor — `montar-frase.ts`, `validar-frase.ts`,
  `custo.ts`, `degree.ts`, `particulas-syntax.ts`, DeriveSteps de limites/fadiga.
  **Testes = as 10 golden fixtures do §5** + Tabelas A–D.
- **Dependências:** M5-A (para registrar degree-of-success/roll data).
- **Auditoria:** todas as fixtures §5 verdes; contagem de partículas 18/19/34/10=81
  (CA-13); derivados corretos p/ atributos 1–6 (CA-1/CA-2).

### M5-C — Motor de conjuração no servidor + máquina de estados _(sequencial após B)_

- **Escopo [MVP]:** `conjuracao/state-machine.ts` (pura) + handlers de socket
  (`packages/server/src/etmos/conjuracao-handlers.ts`): propor/arbitrar/rolar/
  resolver/cancelar; integração com `RollService` (2d6+Alma), controle de Fadiga
  (REQ-ETM-025), aplicação de custo de Estresse na resolução, broadcast redigido.
- **Dependências:** M5-B (funções puras + schemas), M5-A (roll data/degree).
- **Auditoria:** fluxo `proposta→arbitrada→rolada→resolvida` aplica custo correto
  (CA-9); Exausto dispara controle 2d6 (CA-10); guardas de permissão via
  `isRolePrivileged` (nunca duplicar); teste de Totem no Mundano (CA-12).

### M5-D — Fichas + Compositor UI _(paralelizável em 2 agentes após C)_

- **D1 [MVP]:** `OradorSheet` + `AntagonistaSheet` + VMs (atributos, derivados,
  trackers, aba Grimório com botão Conjurar). Registro no `sheetRegistry`.
- **D2 [MVP]:** `Compositor.svelte` + `compositorVM` + `ConjuracaoCard.svelte` +
  `conjuracaoCardVM`; chatCard `etmos.conjuracao`; preview ao vivo com
  `validarFrase`/`montarFrase` importadas do sistema; i18n pt-BR (REQ-ETM-051).
- **Dependências:** M5-C (eventos de socket), M5-B (funções puras).
- **Auditoria:** montar `Et`+`Imu` gera "Etimu" na UI (CA-8); 0/2 Funções rejeitado
  com mensagem; fluxo end-to-end GM↔jogador numa sessão.

### M5-E — Progressão, combate e ferramentas de Narrador _(pós-compositor)_

- **[MVP interno]:** iniciativa `2d6+Corpo` com `compare` (REQ-ETM-022, CA-7);
  Reação por rodada (reset em `turnStart`); Marcos de Crescimento + Tabela E
  (REQ-ETM-035..039, CA-11); Teste Contestado (REQ-ETM-021, CA-6).
- **[V2 interno]:** Descanso (REQ-ETM-041); calculadora de Encantamento (PP,
  REQ-ETM-044/045); baralho de Grimório arrastável (REQ-ETM-048); favoritos
  `frase_magica` (REQ-ETM-034, se não coube em D2).
- **Dependências:** M5-B/C. **Auditoria:** CA-6/CA-7/CA-11.

**Ordem de dependências:** `A → B → C → D`, com `E` após `C`. B1/B2 e D1/D2 rodam
em paralelo dentro do batch. Cada batch fecha com auditoria Opus contra os CA da
spec 19 + as golden fixtures.

### Critérios de auditoria transversais (todo batch)

- Clean-room: nenhum trecho de prosa do livro; só identificadores mecânicos.
- Rolagens só no servidor; nenhum `Math.random`/RNG no cliente.
- TS strict, sem `any` não justificado; funções de regra puras e testadas.
- Sem dependência nova.
- Composições conferidas à mão contra §5 (o auditor recalcula frase/custo).

---

## 7. Riscos e decisões em aberto (com recomendação)

| ID                                                                                                                                                                      | Risco / questão                                                                                                                                                                                                                                                                                                              | Recomendação |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **R1 — Efeitos narrativos não automatizáveis.** O SRD é explícito: nenhuma frase tem efeito pré-determinado; a Complexidade depende de 9 parâmetros subjetivos.         | **Não automatizar o efeito.** O compositor produz frase+intenção+custo; o **Narrador arbitra Complexidade e narra o efeito** no card (campo de notas/narração). Isto é feature, não limitação — espelha a mesa. Já é o núcleo do design (D4/D8 da spec 19). **Aceitar.**                                                     |
| **R2 — Contagem de Funções 18 vs 17** (spec 19 Q1). A ficha lista 18 checkboxes; o SRD canônico tem 17 (excluindo "Mat").                                               | Compendium default com **18 slots** mas "Mat" marcada `verify: true` e **fora** do catálogo jogável; a 18ª "vaga" fica documentada como pendência editorial. Não bloqueia o compositor (usa slugs presentes). **Seguir; confirmar com a editora.**                                                                           |
| **R3 — Extensões da system-api (E1–E3).** Introduzir superfícies novas na API central pode atrasar/afetar PF2e.                                                         | Isolar em **M5-A**, aditivo e retrocompatível, com testes de retrocompat PF2e como gate. Se E2 (degree) mostrar-se custoso, **fallback aceitável**: implementar o grau via `postRoll` hook só no Etmos (sem tocar a API) — funciona, apenas deixa o grau fora do resultado canônico. **Preferir E2; ter o fallback pronto.** |
| **R4 — Gramática de fusão além do núcleo.** `montarFrase` assume que só Função+1º Objeto fundem; o resto são palavras separadas. Um exemplo do SRD poderia contradizer. | As 10 fixtures do §5 cobrem todos os padrões dos `exemplo_uso` dos packs e nunca fundem além do núcleo. **Aceitar; se surgir contraexemplo, é bug de fixture, corrige-se a regra.**                                                                                                                                          |
| **R5 — Complementos Criadores e alvo ambíguo na UI.** Ligar `Ag` entre duas Características ou `Ada-` a uma específica exige UI de "alvo" que pode confundir.           | UI **guiada**: ao escolher um Criador, forçar seleção do alvo via dropdown restrito aos alvos válidos; `validarFrase` rejeita alvo inválido. Preview mostra o resultado (`adaQuan`, `QuanAgAer`) imediatamente. **Aceitar.**                                                                                                 |
| **R6 — Glifos rúnicos proprietários** (spec 19 Q3).                                                                                                                     | MVP usa **placeholder tipográfico** (palavra Etmos + cor por categoria); slot `icone_runico` reservado. Nenhuma arte empacotada (CA-14). **Aceitar.**                                                                                                                                                                        |
| **R7 — Dados de Empenho sem relógio de tempo fictício** (spec 19 Q7).                                                                                                   | **Botão manual "novo dia"** na ficha reseta o contador. Sem inventar relógio. **Aceitar.**                                                                                                                                                                                                                                   |
| **R8 — Licenciamento** (spec 19 Q2). Distribuir os dados de regra exige autorização da Balde Galáctico.                                                                 | Não bloqueia desenvolvimento **local/privado** (packs já commitados, git-ignored no que é prosa). Publicação do pacote fica **pendente de autorização** — decisão de produto/legal, fora do escopo de engenharia. **Sinalizar; não bloquear M5.**                                                                            |
| **R9 — Defesa Mágica (Contestado) automatizável?** (spec 19 Q6).                                                                                                        | Manter **manual no MVP**: o Contestado é rolagem dupla; a _aplicação_ (quanto reduz) é arbitrada. Não semiautomatizar redução de Ferimentos agora. **Manual (D8).**                                                                                                                                                          |

---

## 8. Referências

- `specs/19-sistema-etmos.md` — REQ-ETM-\* e Critérios de Aceitação CA-1..14 (contrato).
- `docs/research/12b-etmos-fontes-locais.md` — §3 (resolução 2d6), §9
  (Grimório/Partículas/Complexidade), §11 (combate/iniciativa/Reação), §12
  (Estresse/Fadiga), §18 (Tabelas A–E).
- `systems/etmos/packs-src/{particulas,tabelas,antagonistas,origens,habilidades}.json`
  — dados estruturados + `exemplo_uso` (fonte das golden fixtures do §5).
- `packages/system-api/src/{system-module,derive,effects,hooks,combat,registries}.ts`
  — capacidades reais da API (e os 3 gaps E1–E3).
- `packages/server/src/chat/roll-service.ts` — RNG autoritativo (2d6+Alma passa aqui).
- `packages/shared/src/combat/{types,initiative}.ts` — `InitiativeFormula`,
  `sortCombatants` (já aceita `compare`), `hasPlayerOwner`.
- `packages/client/src/{components/sheets/pf2e/CharacterSheet.svelte, lib/sheets/sheetRegistry.ts}`
  — padrão de ficha/VM/autosave e registro de sheet a espelhar.
- `systems/pf2e/src/{index.ts,initiative.ts}` — padrão de `defineSystem` e formula.
