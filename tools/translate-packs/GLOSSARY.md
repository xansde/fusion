# Glossário pt-BR — política clean-room

## Por que este arquivo existe

`tools/translate-packs/` gera uma camada de tradução pt-BR (`i18n.pt-BR.json`)
para o conteúdo dos packs de compêndio do sistema PF2e do Fusion. O
texto-fonte em inglês vem do pack `foundryvtt/pf2e` (Apache-2.0), que por sua
vez reproduz regras mecânicas do SRD PF2e sob **ORC**/**OGL** — texto de
regras é livre para reuso, incluindo tradução.

**O que este glossário NÃO é**: a tradução oficial brasileira de nenhuma
editora (não copiamos glossários, termos ou frases de produtos comerciais
localizados). Todo termo abaixo é uma escolha de tradução **nossa**,
independente, para conceitos mecânicos genéricos de RPG de mesa estilo d20 —
os mesmos conceitos existem em dezenas de sistemas e não são propriedade de
ninguém.

## Regras de uso

1. **Termos genéricos, não frases proprietárias.** O glossário mapeia
   palavras/expressões mecânicas isoladas ("feat" → "talento", "trait" →
   "traço") — nunca frases inteiras de flavor text ou nomes de talentos
   específicos "traduzidos oficialmente".
2. **Nomes próprios de talentos/magias/itens são traduzidos caso a caso** pelo
   pipeline de tradução (`i18n-overlay.mjs`), não pelo glossário. O glossário
   só garante consistência terminológica nos termos mecânicos que aparecem
   dentro da prosa.
3. **Aplicação determinística.** `src/glossary.js` faz substituição textual
   simples e auditável — não há "estilo" de tradução aprendido de fonte
   protegida por direito autoral.
4. **Atribuição obrigatória.** Todo `i18n.pt-BR.json` gerado carrega o campo
   `attribution` apontando para o texto-fonte ORC/OGL em inglês
   (`foundryvtt/pf2e`) e deixando explícito que a tradução é derivação
   própria (fan-content), não a localização oficial.
5. **EN é sempre fallback.** Nenhuma entrada do overlay substitui o texto
   original; o servidor sempre pode servir o inglês caso a tradução esteja
   ausente ou `stale` (ver `sourceHash` em `hash.mjs`).

## Como estender

Adicione o par termo→tradução em `glossary.pt-BR.json` (`terms`), em ordem
alfabética por chave em inglês quando possível, e prefira o singular como
chave canônica (variações de plural podem ter entrada própria quando a
tradução não é regular, ex.: "feat"/"feats").

## Estrutura

`glossary.pt-BR.json` tem duas camadas complementares:

- **`terms`** — mapa flat `Record<string,string>` de termos mecânicos como
  aparecem **na prosa** (ex.: `"saving throw" → "teste de resistência"`). É a
  camada consumida pelo pipeline determinístico: `src/glossary.mjs`
  (`loadGlossary` exige este campo) faz substituição textual por limite de
  palavra, com as chaves ordenadas por comprimento decrescente para que
  expressões multi-palavra ("free action") sejam substituídas antes de suas
  substrings ("action"). Só entram aqui termos que ocorrem em texto corrido —
  nada com hífen/token estruturado.
- **`categories`** — vocabulário **estruturado** para os campos indexados/labels
  de UI, agrupado por tipo: `attributes`, `attributeAbbreviations`, `skills`,
  `saves`, `proficiencyRanks`, `actionCosts`, `rarities`, `traditions`,
  `damageTypes`, `conditions`, `traits`, `basicActions`. As chaves de `traits` e
  `conditions` são a forma EXATA como aparecem nos packs
  (`system.traits.value` / `doc.name` do pack `conditions`), então o pipeline e
  a UI podem traduzir esses campos por lookup direto sem passar pela
  substituição de prosa. **Cobertura garantida por teste vivo** (ver abaixo).

Campos de documentação (ignorados pelo loader, presentes para auditoria
clean-room): `attribution`, `note`, `keepEnglish` (termos que NÃO se traduzem —
nomes próprios de ancestralidade/classe cunhados) e `styleDecisions` (decisões
de estilo carregadas: DC→CD, off-guard→desprevenido, holy/unholy vs good/evil,
etc.).

### Teste vivo de cobertura

`src/__tests__/glossary.test.mjs` (roda com `pnpm test` → `node --test`) valida
contra os **packs reais** (`systems/pf2e/packs/*/documents.json`):

1. JSON válido e shape esperado; `terms` compatível com o loader de A.
2. Sem duplicatas conflitantes (case-insensitive) em `terms`.
3. Precedência multi-palavra sã (frase mais longa que suas substrings-chave).
4. **Cobertura ≥ 100% dos traits reais** dos packs (217 no snapshot atual) e das
   43 condições do pack `conditions`. Uma regeneração de packs que introduza um
   trait/condição novo **falha o teste** até o glossário cobri-lo.
5. Conjuntos canônicos fixos (6 atributos, 16 perícias + Percepção, 3 saves),
   tipos de dano, raridades e tradições.

`src/glossary.mjs` — loader (`loadGlossary`) + `sortedTermEntries` +
`findGlossaryTermsInText`, usados por `src/i18n-overlay.mjs` na tradução de
prosa (implementador A).
