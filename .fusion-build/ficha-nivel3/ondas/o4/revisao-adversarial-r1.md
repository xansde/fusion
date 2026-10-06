# Re-verificação adversarial O4 — rodada 1 (2026-09-21)

Veredito: **APROVADA**. Os 4 achados estão FECHADOS. Nenhum achado novo bloqueante ou importante. Sobrou 1 achado menor novo.

## C1 (bloqueante): FECHADO
- Leitura do código: antes do conserto, `CHOICE_SLOT_REQUIRED_CLASS.deity` valia `"deity".split("-")[0]` = `"deity"`, e `planCtx.classSlug` (`"cleric"` ou `"champion"`) sempre diferia desse valor. Por isso o slot sempre saía WrongClass. Depois do conserto, `requiredClass: ["cleric","champion"]` passa por `includes()`, e os dois testes novos (Cleric e Champion, `requirementIssue` undefined) só passam com isso.
- Os outros consumidores de `requiredClass` continuam com string única e são normalizados para array. Não há outro leitor além de `checkSlotRequirement`.
- Rodei `planVM.test.ts` + `ficha-nivel3-onda1.test.ts`: 468/468 verdes.

## C2 (importante): FECHADO, e reproduzi por conta própria
- O fixer só tinha refeito o Champion. Reproduzi Cleric e Animist com roteiros no scratch (`e2e-o4/roteiros/rev-{Cleric,Animist}.spec.ts`), contra o build do wt-c, num ator novo, aplicando só a classe:
  - Cleric: em ~3,2 s aparecem `Cleric Spellcasting` e `First Doctrine`.
  - Animist: em ~2,1 s aparece `Animist & Apparition Spellcasting`.
  - As features que faltam (Deity, Doctrine, Divine Font, Apparition Attunement, Animistic Practice) são eixos de escolha. É o esperado.
- O Champion do fixer (Deific Weapon + Champion's Aura em ~4,5 s) é coerente com isso. A causa do achado original era build ou tempo, e não um defeito de código.

## C3 (importante): FECHADO
- A nova `checkDivineFontDeityMatch` cruza o item `type:"deity"` com o slot divineFont e marca quando a divindade concede um único font. Os 5 testes novos cobrem harm×Healing (marca), o par que confere, os dois fonts, sem divindade e font vazio.
- Dado real: as 473 deidades têm `type:"deity"` e `font` ∈ {["harm"] 158, ["heal"] 174, ["harm","heal"] 141}. O filtro do picker compara pelo `e.name` do índice, que é EN ("Healing Font"/"Harmful Font"). O pt-BR é um overlay separado e não altera `name`, então o filtro não esvazia a lista.

## C4 (importante): FECHADO
- Issues #114 (Lore dinâmica) e #115 (16 magias da apparition) estão abertas.
- A nota #18 foi corrigida e a numeração bate com `plano.md` (5 = repertório espontâneo, 6 = lista preparada, 8 = pool de foco).
- A troca do critério do gate ficou registrada na nota de rodapé de `execucao.md:119` e na nota da T4.2 em `tasks.md`.
- Nuance que não é achado: o Animist também é conjurador preparado, então o buraco 6 o afeta. Só não tem relação com Lore, que é o que a nota corrigida diz.

## Novo — N1 (menor)
- `planVM.ts:2544`: o comentário ainda diz "No `requiredClass`" logo acima de uma entrada que agora declara `requiredClass: ["cleric","champion"]`. O comentário contradiz o código. Conserto: reescrever a frase.

## Não foi verificado
- Não rodei a suíte inteira, conforme a instrução.
- O picker filtrado do C3 não foi exercitado ao vivo na UI. A conferência foi por leitura do código e dos dados do índice.
