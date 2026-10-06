# Revisão adversarial da o1 — rodada 3

Alvo: satélite `8431c59` (ficha3/o1), core `5f2f09a1` (i18n + pin em 8431c59).

## C4 — picker de idiomas bônus (#102): FECHADO (mecanismo)

Lido e testado:
- `stepCharLanguages` (systems/pf2e/src/derivations/character.ts): vagas = max(0, mod Int) + `additionalLanguages.count`; cada choice `type:"language"` entra em `languages` e sai de `languagesPendingCount` (clamp 0); `languageOptions` derivado.
- `planVM.ts`: slot `language-1-<N>` por vaga, recomputado a cada `derivePlan` a partir de `abilities`; `chooseLanguage` grava em `system.build.choices`; `languagePickerOptions` exclui fixos e escolhas de outros slots.
- Gatilho real: `PlanColumn.svelte` abre `LanguageDialog.svelte` ao clicar no slot; a ficha (`CharacterSheet.svelte:983`) mostra idiomas + pendência.
- `npx vitest run -t anguage`: systems/pf2e 11/11, sheets/pf2e planVM 10/10 verdes.

## Novo achado — N3 (importante): o conjunto de opções não segue a regra do PF2e

A decisão do orquestrador pede "HUMANO oferece os idiomas comuns pela regra do Player Core". O que foi implementado:

1. **Humano**: `COMMON_LANGUAGE_FALLBACK` = união dos idiomas fixos das outras ancestralidades curadas
   (dwarven, elven, fey, gnomish, goblin, halfling, orcish, ysoki). Essa não é a lista de idiomas comuns do Player Core:
   - **faltam** Draconic, Jotun e Sakvroth, que são idiomas comuns;
   - **sobra** Ysoki, que não é idioma comum (é o idioma da ancestralidade Ratfolk).
   Cenário: um mago humano com Int +4 quer Dracônico, uma das escolhas mais típicas. O picker não oferece a opção, e o Humano fica sem ela.
2. **Outras ancestralidades**: o conjunto se limita a `additionalLanguages.value`. Pelas regras (Player Core), a lista da ancestralidade vale *além de* "qualquer outro idioma a que você tenha acesso", e os idiomas comuns estão disponíveis para qualquer personagem.
   Cenário: um anão com Int +1 não consegue escolher Élfico nem Halfling (os dois são comuns). Pela regra, a escolha é legal.
3. O teste "não-circular" do Humano só confere que dwarven/elven aparecem e que common não aparece. Ele não pega a falta de draconic/jotun/sakvroth nem a sobra de ysoki. A verificação fica fraca e passa com a lista errada.
4. O commit fecha a #102 como resolvida, mas a regra continua divergente.

Conserto: definir uma constante `COMMON_LANGUAGES` com a lista de idiomas comuns do Player Core, só com slugs (draconic, dwarven, elven, fey, gnomish, goblin, halfling, jotun, orcish, sakvroth). O conjunto de opções passa a ser a união dessa lista com `additionalLanguages.value`, tirando os idiomas já conhecidos. A mudança entra em `character.ts` e também no espelho do `planVM.ts`. O teste deve afirmar pela regra do livro que draconic/jotun/sakvroth aparecem para o Humano, que ysoki não aparece, e que elven aparece para o anão.

## Menores (não bloqueiam, registrar)
- `LanguageDialog` mostra o slug em inglês com a inicial maiúscula ("Dwarven") numa interface pt-BR: falta i18n dos nomes de idioma.
- Escolha órfã: se o Int baixar ou a ancestralidade mudar depois da escolha, `languages` continua somando todas as escolhas, e o slot correspondente some do Plano, sem forma de remover. O padrão é o mesmo do `skillTraining` (build.ts:532 também não limita), por isso não é regressão.

## Veredito
REPROVADA. N3 é importante e está aberto. O restante do diff não traz regressão: o commit do core só mexe em 2 chaves de i18n e no pin.
