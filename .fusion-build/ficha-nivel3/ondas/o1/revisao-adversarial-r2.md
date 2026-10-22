# Revisão adversarial o1 — rodada 2

Alvo: core `ficha3/o1` @ ecb0b9ac (gitlink -> 80fb68b), satélite `ficha3/o1` @ 80fb68b.

## N1 — FECHADO
- Diff 80fb68b: `languagesPendingCount = max(0, mod(Int)) + ancestryAdditionalLanguagesCount(doc)`; helper clampa a número finito > 0.
- Teste novo "adds the ancestry item's additionalLanguages.count ... (Human, Int 10 -> 1)": rodado aqui, 6/6 verdes no filtro "Languages" (72 no arquivo). Sem o conserto a fórmula antiga dá max(0, mod(10)) = 0 != 1 -> falharia.
- Dado real conferido em ancestries-core/documents.json: Human {count:1, value:[]}; as outras 9 com count:0 -> nenhuma outra ancestralidade muda de contagem (sem regressão).
- Consumidores: só characterSheetVM (getter passthrough) e CharacterSheet.svelte (exibe "N idiomas a escolher"). Nada subtrai/valida contra a contagem.

## C4 — parte técnica FECHADA; decisão segue com o Alexandre
- Comentário de stepCharLanguages reescrito: não afirma mais que additionalLanguages.value falta no pack e marca a decisão de corte como "pending re-confirmation by Alexandre" (corte deixou de ser silencioso/assumido pelo fixer).
- Issue xansde/fusion-systems-2e#102 conferida: já descrevia o dado corretamente ("dado já existe e está completo"). Nada a corrigir.
- O que resta é decisão humana (aceitar o corte ou implementar o picker), não defeito de código. Mantido como pendência de decisão.

## C3 — ABERTO (ato humano de merge)
- `git branch -r --contains 80fb68b` -> só origin/ficha3/o1. Gitlink do core = 80fb68b.
- Fixer não mergeou (correto: merge é humano) e abriu #105 com a ordem: merge commit sem squash no satélite -> re-pin do core -> merge do core.
- Continua sendo precondição de merge: mergear o core antes do satélite (ou com squash no satélite) deixa o core apontando para SHA fora de main.

## Ataque ao diff do conserto
- Sem regressão encontrada. findAncestryItem mantém a mesma semântica de busca (primeiro item type:"ancestry").
- Novo menor (N2): Human tem additionalLanguages.value = [] (RAW: escolhe entre idiomas comuns). A #102 diz que as opções do picker vêm de additionalLanguages.value — para Human o picker ficaria sem opções. Registrar na #102 antes de implementar o diálogo. Não afeta esta onda.

## Veredito
APROVADA COM CONSERTOS — nenhum defeito de código importante aberto; restam C3 (merge ordenado, #105) e a decisão de C4, ambos atos do Alexandre.
