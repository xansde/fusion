# Spec 45 (Atores) — avaliação crítica e mapa de impacto

> **Documento histórico: avalia a v0.1 da spec.** A v0.2 substituiu natureza única por
> **facetas** (conjunto, com aquisição em jogo) e fechou nove das dez falhas — F1 dissolvida,
> F2/F5/F6/F7/F9/F10 viraram requisito ou decisão, F4 corrigida, F8 delimitada; só a F3 (o
> `systems/stub`) ficou como tarefa de implementação. O retrato atual está em
> [`guia.html`](guia.html) e na própria `specs/45-atores.md`. Este arquivo fica como registro
> de por que a v0.1 não servia.

- **Data:** 2026-08-16
- **Spec:** `specs/45-atores.md` (PR #159 contra `alfa/app`)
- **Para que serve este documento:** dar ao Alexandre o material para **acusar falhas** na
  spec antes do merge, e dizer **onde ela bate de fato** — arquivo por arquivo.
- **Método:** releitura da spec com o código na mão (branch `alfa/app`, 2026-08-16). Tudo o
  que está abaixo foi conferido contra o repositório, não inferido.

---

## 1. Falhas que eu acuso na própria spec

Ordenadas por severidade. As três primeiras são as que eu não mergearia sem resolver.

### F1 — "Não-jogável derivado" mudou o sentido do termo, e pode contrariar a 42 — [CRÍTICA]

**O que a spec diz:** DEC-ATR-05 torna "não-jogável" um termo **derivado**:
`natureOf(actor) !== "player"`. A tabela de emendas (§12) classifica o efeito sobre a `42`
como "o termo passa a ser derivado" e sobre a `39` como "nada muda de comportamento".

**O problema:** a `42` §3 define não-jogável como "`npc` **ou** `hazard` — é o que esta aba
lista". A derivação da `45` é mais larga: inclui **familiar** (`creature`) e **baú**
(`container`). Depois da emenda, a frase da `42` passa a descrever um conjunto que a aba
**não lista** — e a spec 42 usa esse termo em requisito normativo, não só em prosa.

**Por que é grave:** eu declarei a emenda como "nada muda", e ela muda. É exatamente o tipo
de contradição silenciosa que o `CONVENCOES.md` §2 proíbe, cometido pela spec que veio
consertar contradições.

**Conserto sugerido:** separar dois termos em vez de um. `não-jogável` = o que a aba NPCs
**cria e lista** (`creature` + `hazard`, excluindo sub-personagem e recipiente); e a
derivação larga, se for necessária em algum lugar, ganha outro nome ou nenhum. Alternativa:
manter a derivação e emendar a `42` de verdade, ajustando o texto dos requisitos dela.

### F2 — Não existe canal para o mapa de naturezas chegar ao cliente — [CRÍTICA]

**O que a spec diz:** REQ-ATR-004 exige `natureOf(actor)` como única rota; RNF-ATR-01 exige
que ela seja **pura e síncrona**; RNF-ATR-03 proíbe que ela dependa do pacote do sistema
estar carregado no cliente; REQ-ATR-014 exige que a engine exponha os subtypes agrupados por
natureza.

**O problema:** as quatro coisas juntas só fecham se o mapa `subtype → nature` **viajar** do
servidor para o cliente — e **nenhum requisito diz por onde**. Hoje não há canal: o
`system:whoami` devolve apenas o usuário (`packages/server/src/net/handlers/system.ts:43`),
e o cliente conhece o `systemId` do mundo por REST (`packages/client/src/lib/api.ts:34`), sem
nada sobre subtypes. Sem esse requisito, a implementação só tem duas saídas — tornar
`natureOf` assíncrona (contraria RNF-ATR-01) ou persistir a natureza no ator (contraria
REQ-ATR-003).

**Conserto sugerido:** um requisito de transporte. O candidato natural é o payload REST de
informação do mundo, que já carrega `systemId` — acrescentar o mapa ali e exigir que o
cliente o receba antes de montar qualquer lista.

### F3 — O `systems/stub` não foi considerado e quebra o contract test — [CRÍTICA]

**O que a spec diz:** REQ-ATR-011 — o contract test **DEVE falhar** quando um sistema
registrar um model de `Actor` sem `nature`.

**O problema:** `systems/stub/src/index.ts` declara `Actor` / subtype `dummy`. Ele não é um
sistema de jogo, é o duplo de teste da system API — e não tem natureza plausível. Como
escrito, o requisito quebra o stub, ou obriga a atribuir a ele uma natureza arbitrária que
não significa nada.

**Conserto sugerido:** ou o stub declara `creature` com um comentário dizendo que é
arbitrário, ou REQ-ATR-011 ganha a exceção explícita para sistemas de teste. Prefiro a
primeira: exceção em requisito é porta que fica aberta.

### F4 — A tabela de mapeamento da DEC-ATR-03 está incompleta — [ALTA]

**O erro:** a tabela lista o SF2e com dois subtypes (`character`, `npc`). O sistema declara
**quatro**: `character`, `npc`, `hazard`, `loot` (`systems/sf2e/src/index.ts`). Erro factual
numa tabela que a spec apresenta como retrato do que existe hoje.

**Conserto:** duas linhas. Confirmado o total real: pf2e **5**, sf2e **4**, etmos **2**
(`orador`, `antagonista`), stub **1**.

### F5 — REQ-ATR-024 quebra o caminho de criação que existe hoje — [ALTA]

**O que a spec diz:** o servidor DEVE recusar a criação de um ator de natureza `player` que
não venha acompanhada do usuário a quem ele pertence.

**O problema:** hoje o cliente cria ator pelo `doc:create` genérico com
`{name, type: "character"}` — o caminho está documentado no próprio servidor
(`doc-handlers.ts:655`, `sync-handlers.ts:405`) e é o que o `ActorDirectory` legado usa. A
regra da spec **invalida esse caminho** sem que nenhum requisito diga o que acontece com ele.

**Conserto sugerido:** um requisito de transição — ou o caminho genérico passa a recusar
`player` e a criação migra para a rota de usuário, ou a recusa é [V2] até a `37` entregar a
tela. Do jeito que está, o primeiro implementador quebra a criação de personagem e descobre
tarde.

### F6 — Nenhuma palavra sobre os mundos que já existem — [ALTA]

**O problema:** REQ-ATR-040 exige `flags.fusion.sourceId` em **todo** ator, e DEC-ATR-10 fixa
o ownership de nascimento. O mundo `teste_xande` tem atores criados antes das duas regras:
os criados do zero não têm `sourceId` (hoje ele só chega pela importação de pack —
`compendium/service.ts`), e o ownership deles não seguiu regra nenhuma. A spec não tem
requisito de migração nem declara que a regra vale só para atores novos.

**Conserto sugerido:** ou um requisito de migração (a `03` já tem a máquina de migrations),
ou uma frase dizendo que `sourceId` ausente é legado tolerado — e então REQ-ATR-041 precisa
dizer o que fazer quando ele falta.

### F7 — REQ-ATR-005 é proibição sem verificador — [MÉDIA]

**O problema:** "nenhum código DEVE comparar subtype contra literal de sistema" é a regra
mais valiosa da spec e a única sem forma de cobrança. CA-ATR-012 propõe "uma busca por
`character` não encontra nenhuma comparação" — isso é um grep, não um teste: quebra com
qualquer variação de escrita e não distingue comparação de comentário.

**Conserto sugerido:** virar regra do `tools/boundary-test`, que já existe e já reprova
fronteira de import no CI. Aí a proibição passa a ser cobrável de verdade.

### F8 — A spec criou o vocabulário para fechar o vazamento de vida e não o fechou — [MÉDIA]

**O problema:** a `40` registra em DEC-CBA-11 / Q-CBA-02 que a vida de criatura **já chega ao
cliente** por outro caminho (barras de recurso do token, REQ-CNV-090), e que fechar isso é
"decisão da área dona". A `45` é a área dona do conceito de criatura e passou ao lado: ela
diz o que não exibir (REQ-ATR-062), não o que não enviar.

**Conserto sugerido:** um requisito de redação por natureza — o servidor não envia vida de
`creature` a quem não é papel privilegiado — ou uma frase explícita dizendo que a redação
continua sendo da `21` e por quê.

### F9 — A fronteira "regra de mesa × regra de jogo" é fina demais para não ser testada — [MÉDIA]

**O problema:** DEC-ATR-04 proíbe a natureza de decidir mecânica, mas DEC-CBA-03 (jogador
nunca vê vida de criatura) **é** decidida por natureza. Chamei a primeira de regra de jogo e
a segunda de regra de mesa. A distinção é defensável e não está operacionalizada — não há
critério que diga, diante de um caso novo, de que lado ele cai.

**Conserto sugerido:** um critério de aceitação com um caso de cada lado, ou aceitar que
DEC-ATR-04 é princípio e não requisito, e rebaixá-la no texto.

### F10 — O baú nasce invisível, e isso briga com o motivo de ele existir — [BAIXA]

**O problema:** DEC-ATR-10 dá ao recipiente `ownership.default: none`. A DEC-NPC-08 criou o
baú como "ferramenta para ajudar na agilidade do GM narrar". Se cada baú posto na cena exige
um segundo gesto de concessão para o jogador poder abrir, a agilidade evaporou.

**Conserto sugerido:** decidir se abrir um baú é ownership ou é gesto de cena (o Mestre
"abre" para a mesa no momento da narração). A segunda leitura é mais fiel à DEC-NPC-08 e
provavelmente pertence à `41`.

---

## 2. O que verifiquei e está sólido

Para ser justo com o resto do documento:

- **O diagnóstico central se confirma no código.** Os três lugares onde a pergunta é
  respondida por string literal existem e estão citados com arquivo: `spellCastCardVM.ts:88`,
  `compendiumBrowser.ts:518`, `ActorDirectory.svelte:39–53`. O Etmos realmente não é atendido
  por nenhum dos três.
- **As 74 citações de id resolvem.** Conferidas uma a uma antes da escrita, e depois pelo
  `spec-lint` (regra `citacao-resolvivel`).
- **O gate mecânico passa:** `pnpm --filter @fusion/spec-lint test` → 29/29;
  `pnpm spec:report` regenerado; `prettier --check specs/` limpo.
- **As emendas foram aplicadas, não só registradas** — que é onde a spec 42 tinha deixado
  dívida.

---

## 3. Mapa de impacto — onde a spec bate de fato

### 3.1 Código

Nada foi implementado no PR #159. Isto é o que a spec **passa a cobrar**.

| Onde                                                                     | O que muda                                                        | Porte |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----- |
| `packages/system-api/src/system-module.ts` (52–63, 113, 341)             | `SystemDataModelSpec.nature` + validação no registrar             | P     |
| `systems/pf2e/src/index.ts`                                              | 5 models de `Actor` ganham `nature`                               | P     |
| `systems/sf2e/src/index.ts`                                              | 4 models                                                          | P     |
| `systems/etmos/src/index.ts`                                             | 2 models (`orador`, `antagonista`)                                | P     |
| `systems/stub/src/index.ts`                                              | 1 model — **natureza indefinida, ver F3**                         | ?     |
| contract test da system API                                              | novo caso: model de `Actor` sem `nature` reprova                  | P     |
| **novo:** `natureOf` / `actorSubtypesByNature`                           | não existe; **e falta decidir onde mora, ver F2**                 | M     |
| **novo:** transporte do mapa até o cliente                               | não existe canal hoje — **ver F2**                                | M     |
| `packages/client/src/lib/sheets/pf2e/spellCastCardVM.ts:88`              | `t === "character" \|\| t === "npc"` → `natureOf`                 | P     |
| `packages/client/src/lib/compendium/compendiumBrowser.ts:518`            | `subtype === "npc" \|\| "hazard"` → `natureOf`                    | P     |
| `packages/client/src/components/actors/ActorDirectory.svelte`            | tabela `DEFAULT_ACTOR_SUBTYPE` → `actorSubtypesByNature`          | P     |
| `packages/server/src/auth/service.ts` (`createUser`) + `routes.ts:365`   | criar o personagem junto, com ownership do usuário                | M     |
| `packages/server/src/net/handlers/doc-handlers.ts` (`doc:delete`, ~1112) | aviso do que cai junto + recusa com combate ativo                 | M     |
| `doc-handlers.ts` (`doc:create`)                                         | recusar `player` sem usuário — **quebra o caminho atual, ver F5** | P     |
| criação do zero                                                          | passar a gravar `sourceId` (hoje só a importação grava)           | P     |
| validação de `masterActorId`                                             | alvo tem que ser `player`                                         | P     |
| migração de mundos existentes                                            | **não especificado, ver F6**                                      | ?     |

Leitura: a maior parte é pequena e mecânica. O trabalho real está em **três** lugares — o
transporte do mapa (F2), a criação de personagem colada ao usuário, e a exclusão com aviso.

### 3.2 Specs

Aplicadas no PR #159: `CONVENCOES.md` §3, `15` (REQ-SYS-010 + interface), `17` (tabela de
actor types com natureza, `familiar` para MVP, sem `party`/`vehicle`), `27` (M6), `40`
(glossário), `42` (Q-NPC-04 e Q-NPC-05 fechadas), `README` (índice, prefixos, nota do `41`).

Pendentes e conscientes: `39` e `02` receberam apenas registro ("nada muda"), e a `39` é
justamente onde a F1 pode obrigar mudança de texto.

### 3.3 Telas

Nenhuma tela muda de aparência por causa da spec. O que muda é **de onde elas tiram a
resposta**: Contatos (`39`) monta "na mesa" por natureza; NPCs (`42`) lista por natureza;
Combate (`40`) esconde vida por natureza; Compêndio (`43`) escolhe ícone por natureza. Hoje
as quatro decidem por string de PF2e.

### 3.4 Dados existentes

`teste_xande` é o único mundo em `worlds/`. Atores criados do zero não têm `sourceId`; o
ownership não seguiu a regra de nascimento. Ver F6.

---

## 4. O que só o Alexandre decide

1. **F1** — "não-jogável" volta a ser o conjunto estreito da `42`, ou fica derivado e a `42`
   é reescrita?
2. **F5** — recusar `player` sem usuário é [MVP] (e a criação genérica quebra agora) ou [V2]
   (e a regra fica escrita sem morder)?
3. **F6** — migrar os atores do `teste_xande`, ou declarar legado tolerado?
4. **F10** — abrir baú é ownership ou gesto de cena?
5. **Q-ATR-01** (da própria spec) — familiar aparece na aba NPCs ou só encapsulado no dono?

---

## 5. Referências

- `specs/45-atores.md` — a spec avaliada.
- `specs/42-aba-npcs.md` §3, DEC-NPC-05/08, Q-NPC-04/05/06.
- `specs/40-aba-combate.md` DEC-CBA-03, DEC-CBA-06, DEC-CBA-11, Q-CBA-02.
- `specs/39-contatos.md` §3, DEC-CTT-01/02/03/06.
- `specs/15-api-de-sistemas.md` REQ-SYS-010..015.
- Código: `packages/system-api/src/system-module.ts`,
  `packages/server/src/net/handlers/{system,doc-handlers,sync-handlers}.ts`,
  `packages/server/src/auth/{service,routes}.ts`,
  `packages/client/src/lib/sheets/pf2e/spellCastCardVM.ts`,
  `packages/client/src/lib/compendium/compendiumBrowser.ts`,
  `packages/client/src/components/actors/ActorDirectory.svelte`,
  `systems/{pf2e,sf2e,etmos,stub}/src/index.ts`.
