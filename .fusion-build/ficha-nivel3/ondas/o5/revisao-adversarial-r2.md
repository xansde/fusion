# Revisão adversarial O5, rodada 2: re-verificação dos consertos C-2 e C-6

Veredito: **APROVADA**. Os dois achados estão FECHADOS e não apareceu nenhum achado novo bloqueante ou importante.

Satélite `ficha3/o5` em `d88c5ff`; core `c8bebc02` pina `d88c5ff`.

## C-2: FECHADO
- Comparei as 2759 entradas pré-existentes do `feats-core/index.json` no estado anterior à onda (`0275b1c~1`) com as mesmas entradas em `d88c5ff`. Olhei nome e os 6 `indexFields`: **0 divergências**. O índice das entradas antigas voltou a ser exatamente o de antes da onda.
- As 4 spellshape com `necromancer` (Quickened Casting, Conceal Spell e outras), o `aura` de Resounding Cascade, o nome "Conjurer's Countermeasure" e o `maxTakable: null` de Secret Speech saíram. As 5 spellshape que já tinham `necromancer` antes da onda (Reach of the Dead e as demais, vindas da dc6fd92) continuam com o trait, como devem.
- Contagens batem: índice 2922 = documentos 2922. Nenhum id sobra de um lado só.
- Teste novo `pack-index-consistency.test.mjs`: 42/42 verde no estado atual. Para provar que ele pega o defeito, rodei o mesmo teste numa cópia no scratchpad com o `index.json` de `c9e3372`, o estado anterior ao conserto. Resultado: 1 falha, "Sanguimancer Dedication (h1Zd9luvXtpuGwxH) field system.traits.value drifted".

## C-6: FECHADO
- A entrada `h1Zd9luvXtpuGwxH` no índice agora traz `category: class`, `level: 2` e `traits: [archetype, dedication]`. Com isso, `featDocFromIndex` monta a entrada e `isFeatEligible("archetypeFeat")` a aceita: passa em `category=class` com trait `archetype`, não tem `multiclass`, e o gate de dedicação incompleta não dispara no primeiro slot.
- Varri o índice atrás de entradas com `dedication` sem `archetype`: **0**.
- Não existe um teste literal que rode `isFeatEligible` sobre a entrada do índice. Mesmo assim, o teste de consistência garante que índice e documento carregam os mesmos traits, e o predicado já está coberto sobre o documento. Por isso não conto como achado.

## Ataque ao diff do conserto
- `regenerate-pack-index.mjs` gera o mesmo formato do `buildIndex` da pipeline: mesmo uuid, mesmos campos e sem newline no final. O diff produzido tem 12 linhas, só as divergências esperadas.
- A pipeline completa (`build-mvp-subset.mjs`) gera o índice a partir dos mesmos docs que grava. Rodar a pipeline de novo não recria a divergência entre índice e documentos. A duplicação do `buildIndex` no script novo é menor: está justificada pelo efeito colateral do `import`.
- `maxTakable`: a chave some quando o doc não tem o campo, igual ao estado anterior à onda. `repeatCapDocFromIndex` continua recebendo `undefined` para esses talentos, como antes.

Não rodei a suíte inteira, só o teste novo nos dois estados, verde e vermelho.
