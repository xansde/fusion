# Evidência viva — Onda 5 (Arquétipos padrão, variante Arquétipo Livre)

Lane: `evidencia-viva` | Worktree: `wt-c` | Branch core: `ficha3/o5` | Branch satélite: `ficha3/o5`
(nenhum commit novo nesta lane — só verificação ao vivo; código já estava mergeado pelo gate)

## Setup

- Data-dir: `<scratchpad>/data-o5` (cópia de `~/.fusion/worlds/teste_xande`, original intocado).
- Servidor: `node packages/server/dist/cli/index.js serve --port 33057 --data-dir <data-o5> --world teste_xande --no-open` (PID 16420, encerrado ao final via `taskkill`; `netstat` confirmou porta livre depois).
- Setup wizard (data-dir novo) completado via Playwright: diretório → porta → Admin Key → concluir.
- Login como `GM_o5` (Mestre).
- `feats-core` registrado no boot com **2922 documentos** (baseline pré-onda era 2759; delta +163 confirma a importação das 167 dedicações da T5.1, ver nota de overlap no relatório da lane).
- Configurações → Mundo → **Arquétipo livre** ligado (checkbox marcado). **Multiclasse por nível** já estava ligado por padrão do mundo copiado — não desliguei, e isso expôs o Achado 1 abaixo.

## Ator de teste

Reaproveitei **"Novo Ator"** (já existente no mundo `teste_xande`, listado em "Na mesa"): Elfo/Elfo Ancestral, Antecedente Advogado, **Classe Bárbaro**, já em **nível 3** com o slot "Talento de Arquétipo" do nível 2 vazio. Não criei personagem novo — confirma de novo a lacuna de produto já registrada no runbook (`gate-runbook.md` §5, "criar personagem" não existe na UI).

## O QUE FOI PROVADO

### 1. Slot de arquétipo nível 2 lista dedicações padrão (nível "olhado")

Abri o picker do slot "Talento de Arquétipo" (nível 2). Lista inicial mostra dedicações como
"Acrobat Dedication", "Aldori Duelist Dedication", "Alkenstar Agent Dedication" etc., cada uma
com as tags `arquétipo` + `dedicação` — **sem** a tag `multiclasse`.
Print: `prints/02-picker-slot-arquetipo-nivel2-lista-inicial.png`.

### 2. Dedicação escolhida grava no ator — nível "vivo", verificado no DADO, não só na UI

Selecionei "Acrobat Dedication" no picker e confirmei. A UI passou a mostrar
"✓ Acrobat Dedication" no bloco Nível 2 (print `06-dedicacao-gravada-no-slot-nivel2.png`).

Consultei o `world.db` diretamente (better-sqlite3, fora da UI/socket) e o item embutido no
documento do ator (`actors.data` → `items[]`) confirma:

```json
{
  "name": "Acrobat Dedication",
  "type": "feat",
  "flags": { "fusion": { "sourceId": "aFygWxgSv82WyCsl", "build": { "level": 2, "slot": "archetypeFeat-2" } } },
  "traits": ["archetype", "dedication"]
}
```

`flags.fusion.build.slot === "archetypeFeat-2"` — a dedicação está gravada no slot correto,
no banco do servidor, não só como estado de UI. **Isso prova a parte "vivo" e "olhado" do que
esta lane deveria provar.**

## Achados — DEFEITOS (não consertados, registrados aqui)

A instrução original ("ZERO de multiclasse" no slot) não se confirmou. Dois defeitos concretos
encontrados por leitura de código + dado real, ambos em
`external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts`, função `isFeatEligible`,
branch `case "archetypeFeat"` (linhas ~2347-2364):

```ts
case "archetypeFeat":
  if (category !== "class" || !traits.includes("archetype")) return false;
  ...
  return true;
```

### Achado 1 — o slot de arquétipo padrão (nível 2) ACEITA dedicações de multiclasse

**Cenário concreto:** com Arquétipo Livre ligado e Multiclasse por nível também ligado (estado
default do mundo `teste_xande`), abri o picker do slot Talento de Arquétipo (nível 2) do "Novo
Ator" (Bárbaro nível 3) e cliquei no filtro "multiclasse". A lista, que deveria ficar vazia (o
recorte do plano.md diz "FORA: arquétipos de multiclasse" para esta fatia), mostrou:

- "Dedicação a Alquimista / Alchemist Dedication" — tags: arquétipo, dedicação, **multiclasse**
- "Dedicação de Ladino / Rogue Dedication" — tags: arquétipo, dedicação, **multiclasse**

Print: `prints/03-DEFEITO-slot-arquetipo-mostra-multiclasse.png`.

**Causa:** `isFeatEligible` para `archetypeFeat` só checa `category === "class"` e
`traits.includes("archetype")`. Como dedicações de multiclasse (Alchemist/Rogue Dedication,
importadas numa onda anterior para a fundação de multiclasse) também carregam a trait
`archetype`, elas passam no filtro — o branch nunca exclui `traits.includes("multiclass")`.
Confirmado por dado: `feats-core/documents.json` tem exatamente 2 documentos com
`traits ⊇ [dedication, multiclass]` e `level === 2` (Alchemist Dedication, Rogue Dedication) —
bate exatamente com o que apareceu no picker.

**Por que é bug e não escopo do usuário:** o plano da Onda 5 (`plano.md` linha 136-137) diz
que o slot `archetypeFeat` "só é gerado quando a variante Arquétipo Livre está ligada" e a
seção "DENTRO/FORA" (linha 19-20) exclui explicitamente arquétipos de multiclasse desta fatia.
O slot deveria filtrar por não-multiclasse, e não filtra.

### Achado 2 — Sanguimancer Dedication (1 das 167 "padrão") é invisível no picker

**Cenário concreto:** busquei "Sanguimancer" no mesmo picker (slot Talento de Arquétipo, nível
2) — resultado: "Nenhum resultado encontrado com esses filtros." Print:
`prints/04-DEFEITO-sanguimancer-nao-aparece.png`.

**Causa:** confirmada no relatório da lane T5.0-T5.1 como quirk conhecido do vendor —
"Sanguimancer Dedication" não carrega a trait `archetype` no pack (`traits.value = ["dedication"]`
apenas), então o importador (`isStandardArchetypeDedication`) deliberadamente NÃO exige a trait
`archetype` para incluí-la nas 167. Mas `isFeatEligible`/`archetypeFeat` no client EXIGE
`traits.includes("archetype")` — as duas checagens divergem, e o resultado é que 1 das 167
dedicações padrão importadas nunca aparece no slot que deveria oferecê-la.

Confirmado por dado: `feats-core/documents.json` → documento "Sanguimancer Dedication" tem
`system.traits.value = ["dedication"]`, `system.level = 2`, `system.category = "class"` — passa
no filtro do importador, falha no filtro do picker.

## Números — a linha certa da tabela

Comparação com `plano.md`/`tasks.md` (usando **167**, não o 129 antigo):

| O que | Esperado (plano) | Observado nesta lane |
|---|---|---|
| Dedicações padrão importadas em `feats-core` | 167 | confirmado (delta +163 no boot; 166 batem no filtro do picker sem trait-archetype-bug + 1 invisível = 167) |
| Dedicações de multiclasse visíveis no slot padrão | 0 | **2** (Achado 1) |
| Dedicações padrão visíveis no slot (das 167) | 167 | **166** (Achado 2 — Sanguimancer some) |

## Pendências para issue

1. **xansde/fusion-systems-2e** — `isFeatEligible`/`archetypeFeat` (planVM.ts:2347-2364) não
   exclui `traits.includes("multiclass")`, então dedicações de multiclasse (Alchemist Dedication,
   Rogue Dedication, e qualquer outra que exista no pack) aparecem no slot de arquétipo PADRÃO
   da variante Arquétipo Livre, contrariando o recorte "FORA: multiclasse" do plano.md da Onda 5.
   Título sugerido: "Slot archetypeFeat (Arquétipo Livre) aceita dedicações de multiclasse —
   isFeatEligible não filtra trait multiclass". Corpo: cenário reproduzido (mundo teste_xande,
   ator Bárbaro nível 3, filtro "multiclasse" no picker do slot nível 2 mostra Alchemist/Rogue
   Dedication), trecho de código apontado, e o fix sugerido (`&& !traits.includes("multiclass")`
   no branch `archetypeFeat`, com um teste que cubra o caso).
2. **xansde/fusion-systems-2e** — Sanguimancer Dedication (uma das 167 dedicações padrão
   importadas na T5.1) é invisível no picker do slot `archetypeFeat` porque não carrega a trait
   `archetype` no vendor, e `isFeatEligible` exige essa trait. Título sugerido: "Sanguimancer
   Dedication invisível no slot de arquétipo — isFeatEligible exige trait archetype que o vendor
   não dá a ela". Corpo: já documentado como quirk conhecido no relatório T5.0-T5.1 (o importador
   contorna via `isStandardArchetypeDedication` sem exigir a trait), mas o client não contorna;
   ou ajustar `isFeatEligible` para aceitar `category === "class" && traits.includes("dedication")`
   nessa branch (dedicação sempre é candidata a arquétipo, com ou sem a trait `archetype`), ou
   corrigir a trait do documento no pack na importação.

Nenhuma issue aberta nesta lane (sem acesso de escrita ao GitHub verificado dentro do escopo —
registro fica só neste relatório e nos títulos/corpos prontos acima, para abertura posterior).

## Não verificado

- Não testei o comportamento com "Multiclasse por nível" DESLIGADO — não sei se o Achado 1
  desaparece nesse caso (hipótese: sim, porque aí as dedicações de multiclasse não seriam
  "legais" em lugar nenhum) ou se o filtro do picker as mostraria de qualquer forma (mais
  provável, já que o código do filtro não olha para o setting do mundo, só para as traits do
  documento) — não teve tempo de reconfirmar com o outro toggle.
- Não testei os outros 165 nomes das 167 dedicações padrão individualmente — a amostragem foi
  Acrobat Dedication (grava certo) e Sanguimancer Dedication (não aparece); não há garantia de
  que não haja um terceiro caso de trait divergente no meio das 167.
- Servidor encerrado (PID 16420) via `taskkill`; `netstat` pós-kill não mostrou mais a porta
  33057 em LISTENING.
