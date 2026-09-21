# Revisão adversarial o1 — rodada 4

Veredito: APROVADA

## N3 — FECHADO
- Satélite c7bb7cc: `COMMON_LANGUAGE_FALLBACK` virou `COMMON_LANGUAGES` = draconic, dwarven, elven, fey, gnomish, goblin, halfling, jotun, orcish, sakvroth. É a lista de idiomas comuns do Player Core remaster (Common/Taldane já vem fixo). Nela não entra ysoki.
- `languageOptions` (character.ts:341) e `languagePickerOptions` (planVM.ts:2202) calculam as opções do mesmo jeito: `[...COMMON_LANGUAGES, ...additionalValue]`, sem duplicatas, menos os idiomas conhecidos. Os dois lados batem.
- Testes: derivations "Languages" 12/12 e planVM "languagePickerOptions" 3/3 passaram, rodados por mim. Lendo o código antigo, o teste novo falharia sem o conserto: ele devolvia só `additionalValue` para o Anão (sem elven) e o fallback antigo (com ysoki e sem draconic/jotun/sakvroth) para o Humano.
- Os dados reais de `ancestries-core/documents.json` estão coerentes: o Humano tem `value: []` e `count: 1`, e a união fica certa para as 10 ancestralidades. Os idiomas incomuns de cada ancestralidade (petran, aklo, kholo, empyrean) continuam entrando pela lista dela.

## Ataque ao diff
- O rótulo no LanguageDialog é o slug com a primeira letra maiúscula, igual para todos os idiomas. Os slugs novos não pedem chave de i18n.
- Divergência que já existia antes deste conserto: no servidor, `languageOptions` também exclui a escolha do próprio slot, e o planVM a mantém. O N3 não criou nem piorou isso, e as opções exibidas vêm do planVM. Não é achado.
- Nenhuma regressão encontrada.
