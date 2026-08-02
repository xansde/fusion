# r22 — Varredura de jogabilidade das 12 classes

> Levantamento pedido pelo dono em 2026-08-02: **"dá pra jogar?"**, não "importou?".
> Doze agentes varreram pré-requisitos, grants, tradução na ficha, números
> derivados, mecânica não convertida, integridade dos packs, progressão de nível
> e o app real. **Nada aqui foi corrigido** — tudo vira issue no GitHub.
>
> Estado do código auditado: branch `build/app`, HEAD `dcb02b3`, 12 classes,
> 3.787 documentos, pt-BR 100%, 2.124 testes do client verdes.

---

## A crítica que vale mais que qualquer achado isolado

### V-01 — A varredura das 12 classes é CIRCULAR e não prova correção

**Gravidade: alta. Afeta a confiança em todo o resto.**

`packages/client/src/lib/sheets/pf2e/__tests__/varredura-classes.test.ts` passa
80/80 para as 12 classes. Mas ele verifica as proficiências derivadas **contra a
tabela declarada no próprio pack** (`classSystem.proficiencyUpgrades`). Se a
tabela está incompleta, o teste passa mesmo assim — ele valida **consistência
interna**, nunca **correção**.

Prova concreta: o Cleric não tem NENHUMA linha de proficiência de doutrina
(§P-02). A varredura não acusa, porque deriva o esperado da mesma tabela vazia.
O mesmo vale para qualquer regra que simplesmente não exista no código — como o
teto de perícia (§P-01): não há o que comparar, então nada falha.

**Por que isso importa:** os 80 testes verdes foram usados (por mim inclusive)
como prova de que "as 12 classes estão jogáveis". Não eram. Eram prova de que o
pipeline é coerente consigo mesmo.

**Direção de conserto:** testes com **fonte externa** de verdade. As fichas
pregen oficiais da Paizo estão vendorizadas em
`tools/importer-pf2e/vendor/pf2e/packs/pf2e/iconics/` (Ezren=wizard,
Seoni=sorcerer, Lem=bard, Kyra=cleric, Sajan=monk, Seelah=champion,
Amiri=barbarian, Valeros=fighter, Merisiel=rogue, Harsk=ranger). Comparar a
nossa ficha derivada contra a pregen no mesmo nível é evidência irrefutável, e
não circular. Somar a isso invariantes de REGRA (tetos, calendários) que não
dependem do dado do pack.

---

## Progressão e regras do sistema

### P-01 — Aumento de perícia sem teto de nível (Mestre 7 / Lendário 15)

**Gravidade: alta. Afeta 12/12 classes.** Verificado por leitura direta do
código pelo orquestrador, não só pelo agente.

`packages/client/src/lib/sheets/pf2e/planVM.ts:3554` —

```ts
const eligible =
  kind === "skillTraining" ? currentRank === 0 : currentRank >= 1 && currentRank < 4;
```

Não há nenhuma referência a `charLevel`. O único teto em todo o código é
`rank <= 4`. Pelas regras do PF2e, Mestre exige nível 7 e Lendário exige 15.

**Reprodução:** Ladino (`skillIncreaseLevels [2..20]`) chega a **Lendário no
nível 8** — sete níveis antes do permitido. Qualquer classe com aumento no nível
5 chega a Mestre dois níveis cedo.

### P-02 — Cleric: doutrina não gera nenhuma proficiência

**Gravidade: alta. 1/12 classes, mas é o eixo central da identidade da classe.**

12 linhas de progressão (fortitude, conjuração, armas simples/marciais/desarmado,
armadura leve/média, nos níveis 1/3/7/11/15/19) não existem na tabela derivada,
para nenhuma das duas doutrinas. O `items{}` só expõe invólucros vazios; a
mecânica real vive em 12 documentos alcançáveis por flag de ator
(`flags.system.cleric.<nível>Doctrine`), e `deriveProficiencyUpgrades()` não
segue essa indireção.

Hoje o Cleric tem 4 linhas, todas incondicionais. Um Warpriest não recebe as
proficiências de arma marcial e armadura média que definem o arquétipo.

**Nota:** isto era conhecido como "baseline + pendência declarada" — a novidade
medida aqui é o **tamanho** do buraco (12 linhas) e a confirmação de que a
varredura não o acusa.

**O impacto real é pior do que "faltam proficiências" sugere** (medido por uma
segunda frente, independente): o Cleric tem hoje 4 linhas de progressão, e entre
as que faltam estão duas que doem toda sessão —

- **Fortitude trava em Treinado do nível 1 ao 20.** Deveria ser perito no 3
  (Cloistered) ou já no 1 (Warpriest).
- **A conjuração divina trava em Treinado do 1 ao 20.** Deveria chegar a perito
  no 7, mestre no 15 e lendário no 19 (Cloistered).

Consequência na mesa: **a CD de magia do clérigo fica sistematicamente baixa
demais a vida inteira**, e ele rola Fortitude com metade do bônus esperado. Não é
lacuna cosmética — é a classe jogando errado em todas as sessões.

Os números das duas doutrinas **já estão medidos** no bloco `notes` de
`tools/importer-pf2e/src/curation/classes/cleric.json`, sob um parágrafo
intitulado "O QUE A DERIVACAO ATUAL NAO CONSEGUE". Nunca foram aplicados na
integração. Quem for corrigir não precisa remedir nada.

**Achado menor, mesma classe:** `attacks.other` do vendor (a arma favorita da
divindade) não é modelada em lugar nenhum. Hoje é inofensivo (rank 1, igual a
simples), mas vira relevante quando existir pack de divindades e a arma favorita
for marcial ou avançada.

### P-03 — Cineticista trava no elemento do nível 1

**Gravidade: alta. 1/12 classes, em 4 dos 5 eixos de decisão pós-nível-1.**

`Gate's Threshold` (5), `Second` (9), `Third` (13), `Fourth` (17) não estão em
`CLASS_CHOICE_SLOTS` (`planVM.ts:544-556`) — só `Kinetic Gate` do nível 1 está, e
o slot é cravado como `kineticGate-1` (`planVM.ts:3270`). As features viram chip
estático: o invariante do teste passa, e a escolha nunca é oferecida. O
personagem chega ao nível 20 preso ao elemento único escolhido no início.

### P-04 — Sub-escolha dentro do eixo perdida em pelo menos 7 classes

**Gravidade: média-alta.**

O eixo funciona, a escolha DENTRO dele não é oferecida: qual energia o Instinto
Gigante usa, qual perícia o Guerreiro treina no nível 1, o grupo de arma do
Fighter Weapon Mastery, o ramo da School of Rooted Wisdom, o Eldritch Trickster
e o Mastermind do Ladino, o tamanho do Fleshwarp.

Inventário completo já existe em `.fusion-build/r21/escolhas-pendentes.md`: **58
escolhas pendentes de 76 mapeadas, em 57 documentos**. O teste de inventário
(`choice-sets.test.ts`) **não reprova** por elas — só por escolha nova não
classificada. Ou seja: 58 pendências reais e nenhum CI vermelho.

### P-05 — Refazer escolha de eixo: cobertura não verificada

**Gravidade: a confirmar.** O commit `de04721` cobriu troca de classe, talento
repetido e ancestralidade adotada. Não foi encontrado caminho de código nem teste
para reselecionar Instinto/Doutrina/Musa/Causa **depois** de níveis altos já
preenchidos. O agente não conseguiu confirmar nem descartar se deixa lixo órfão.
Registrado como lacuna de cobertura, não como defeito provado.

---

## Mecânica declarada que não faz nada

### M-01 — 971 regras não convertidas, e nenhum consumidor

**Gravidade: alta.**

413 documentos (de 3.559) carregam `flags.fusion.unconvertedRules`, somando 971
regras. Grep em `packages/server/src` e `packages/client/src`: **nenhum código de
runtime lê esse campo para aplicar efeito**. O único uso é no cálculo de hash que
decide regenerar overlay. É dado morto — e o jogador vê o talento na ficha
supondo que funciona.

**De 660 regras classificáveis, exatamente 1 é cosmética** (`TokenLight`). O
resto é mecânica real. Frequência: `ItemAlteration` 288, `ChoiceSet` 99,
`AdjustModifier` 80, `AdjustDegreeOfSuccess` 67, `Strike` 61, `DamageAlteration`
28, `CriticalSpecialization` 16, `AdjustStrike` 16.

### M-02 — Bárbaro: os 7 instintos, inertes

**Gravidade: alta.** `Animal Instinct` (`oqbnOYq8BmDDXWid`) tem **36 regras não
convertidas, 33 delas `Strike`** — as garras, mordidas e chifres de cada forma
animal. Sem overlay em `mechanics.json`. Efeito real na ficha: **nada**; o
personagem fica só com os ataques desarmados genéricos.

Todos os 7 instintos têm o mesmo padrão (`AdjustModifier` + `ChoiceSet`
quebrados). É a escolha obrigatória de nível 1 que define a subclasse inteira.
**Maior densidade de mecânica quebrada por documento do jogo (0,83 regras/doc).**
A classe que "parece pronta e não está".

### M-03 — Sorcerer: as 19 linhagens não propagam dano nem tradição

**Gravidade: alta.** O `ChoiceSet` da linhagem (ex.: qual dragão) e os
`ItemAlteration` que deveriam propagar tipo de dano e tradição para as magias de
sangue não são aplicados. Todas as 19 têm o mesmo buraco; atinge 100% dos
feiticeiros, na escolha obrigatória de nível 1.

### M-04 — Champion: deidade e causa sem mecânica

**Gravidade: alta.** `ChoiceSet` + `ActorTraits` + `AdjustStrike` não convertidos
na escolha de deidade; `ChoiceSet` não convertido na Causa, que determina a
reação de classe. Nível 1 obrigatório.

### M-05 — Concessão de magia só por texto: 78 documentos

**Gravidade: média.** Não é falha do importador — **o vendor não automatiza**:
`system.rules` é `[]` e a concessão existe só na prosa ("You gain [magia]").
Distribuição: **Bard 23**, Monk 13, Ranger 10, Magus 8, Champion 7.

Consequência: a espinha dorsal de composições do Bardo — a identidade da classe —
provavelmente não concede as magias correspondentes. Exige decisão de produto
(escrever à mão, como já se fez em outros casos), não conserto de pipeline.

### M-06 — `AdjustDegreeOfSuccess` adiado para V2 custa 60 documentos

**Gravidade: média.** 67 instâncias em 60 documentos dependem dele — Evasion,
Juggernaut, Vontade Indomável, talentos icônicos de defesa em quase todas as
classes. A decisão de adiar (REQ-PF2-043 [V2], `specs/17-sistema-pf2e.md`) está
registrada; o que faltava era o **tamanho** dela. Vale reavaliar a prioridade com
o número na mão.

---

## Tradução

### T-01 — Descrições em inglês na ficha (reportado pelo dono)

**Gravidade: alta.** `packages/server/src/compendium/service.ts:374-381`: ao
importar um documento do compêndio para o mundo, o servidor faz
`delete worldDoc["i18n"]`, com comentário explícito de que o documento do mundo
deve ficar "EN-pure". O overlay pt-BR é anexado por `getDocument()` **apenas**
para o navegador de compêndio.

Resultado: o compêndio mostra português, a **ficha** mostra inglês — são dois
caminhos diferentes lendo o mesmo dado. Não é tradução faltando: a tradução
existe e está completa (3.787/3.787).

**Direção de conserto:** a ficha resolver o overlay em tempo de leitura, pelo
`flags.fusion.sourceId` + pack de origem, mantendo o item do mundo EN-puro (que é
decisão deliberada do projeto e não deve ser revertida em silêncio).

---

## Integridade dos packs

### D-01 — Índice de `feats-core` não publica `maxTakable`: talento esgotado só é recusado no clique

**Gravidade: média. Sistêmico — atinge os 1.459 talentos.**

`systems/pf2e/packs/feats-core/pack.json` declara
`indexFields: ["name","system.level","system.category","system.traits.value"]`.
O seletor lista o **índice**, e o filtro de elegibilidade só enxerga campos
publicados nele; o gate de repetição (`isFeatAtRepeatCap`, `planVM.ts:2966-3009`)
só roda **depois** da seleção. Resultado: talento não-repetível já escolhido
continua aparecendo na lista até o jogador clicar e levar um toque de recusa.

1.433 talentos têm limite implícito de 1; 4 têm limite explícito maior
(Multifarious Muse, Mercy, Armor Proficiency, Consult the Spirits).

**Conserto:** acrescentar `system.maxTakable` a `indexFields` e republicar o
índice. Baixo risco.

### D-02 — Nível estático de class-feature compartilhada diverge do nível real

**Gravidade: média (cosmético — NÃO afeta a construção).**

35 divergências em 11 das 12 classes: 17 documentos compartilhados carregam um
`system.level` genérico diferente do nível em que cada classe realmente os
concede. Ex.: o Bárbaro concede "Reflex Expertise" no 9, o documento diz 3; o
Mago concede "Juggernaut" no 15, o documento diz 7.

**Verificado que a progressão está correta:** o builder usa
`featuresByLevel[].level`, nunca `doc.system.level`. O único ponto afetado é o
painel de detalhes do compêndio (`documentDetails.ts:1233-1249`), que mostra o
número cru — quem abrir o detalhe vê o nível errado.

### D-03 — 4.563 `@UUID` apontam para fora dos nossos packs (dívida, não bug ativo)

**Gravidade: baixa — o agente REBAIXOU a gravidade que eu havia presumido.**

Eu tinha instruído a procurar "links quebrados". A medição mostrou que hoje
**nada quebra na tela**: o renderizador de descrição (`documentDetails.ts:404-411`)
nunca resolve o UUID contra dado real — ele extrai o último segmento do caminho
como texto puro ("Frightened", "Seek"). O único lugar que materializa link
clicável é o editor de notas do GM, que não toca descrição de compêndio.

Fica registrado como dívida: limita uma futura funcionalidade de link clicável na
descrição.

### D-04 a D-08 — Dimensões auditadas e CONFIRMADAS LIMPAS

Registrado porque saber o que está certo vale tanto quanto saber o que falha:

- **Arte da Paizo: zero vazamentos.** Grep bruto nos 14 packs (documentos,
  overlays e índices). O `deepSanitizeImg` cobre `img` em qualquer profundidade e
  qualquer string `^systems/(pf2e|sf2e)/`, inclusive dentro de `rules[]` e itens
  embutidos. Confirmado com dado, não só leitura de código.
- **Duplicatas: nenhuma.** Três estratégias (fuzzy na descrição, mesmo nome com
  sourceId diferente, mesmo conteúdo sob nomes diferentes). Os 3 grupos
  suspeitos foram verificados à mão e são legítimos — "Ricochet Stance (Fighter)"
  vs "(Rogue)", variantes de doutrina, e "Share Senses"/"Shadow Step" que existem
  para eidolon e familiar com mecânicas distintas.
- **Categoria/trait: nenhum problema.** Os 6 talentos `category: class` sem trait
  de classe são dedicações de arquétipo — e `category: class` **é o dado real do
  Foundry**, porque dedicação consome slot de talento de classe por regra.
  Alarme falso descartado contra o vendor.
- **Campos obrigatórios: 1 caso**, "Rations", com descrição vazia já no vendor.
- **Overlay pt-BR: 100% íntegro.** Os 3.787 `sourceHash` recalculados batem —
  zero órfãos, zero defasados, zero faltando.

> **Armadilha de investigação registrada** (custou tempo e pode custar de novo): o
> separador do hash é um ` ` literal dentro de `hash.mjs`. Ferramentas de
> leitura de texto o exibem como espaço, e copiá-lo visualmente produz **100% de
> falsos "defasados"**. Use `String.fromCharCode(0)`. O agente só percebeu porque
> uma taxa de 100% defasado num pack de 2 documentos era implausível demais para
> ser real.

---

## Números derivados: o que foi CONFIRMADO CERTO

Contra fonte externa, não contra nós mesmos — é o antídoto do V-01.

- **HP bate com as fichas pregen oficiais da Paizo em 11 das 12 classes**, nos
  níveis 1, 3 e 5: Amiri, Lem, Seelah (incluindo o talento Toughness pego no
  nível 3), Kyra, Valeros, Yoon, Harsk, Merisiel, Seoni, Sajan e Ezren. O Magus
  não tem pregen oficial no pack — é lacuna de cobertura de dado, não defeito.
- **Proficiências das 12 classes** conferidas contra o texto RAW de cada
  class-feature do vendor. Todo "diff" inicial do parser era falso positivo dele
  próprio (variação de fraseado, nome de exibição divergindo do slug real) e foi
  lido à mão até confirmar. O Fighter fechou com zero divergência de primeira.
- **CA**, **bônus de proficiência** (`rank*2 + nível`), **atributo-chave** (1:1
  com o vendor nas 12, inclusive nas que oferecem escolha) e **perícias treinadas
  iniciais** (`base + Int` mais as fixas): corretos.
- **Kineticist**: a proficiência "impulse" separada, que espelha o CD de classe,
  **não é bug** — é intencional e citada no código com a fonte
  (Rage of Elements p.14).
- Nenhuma outra curadoria tem nota de lacuna estrutural equivalente à do Cleric.
  O problema de proficiência é **isolado a uma classe**, não sistêmico.

---

## Ordem sugerida de ataque

O que dá mais jogabilidade por esforço, na ordem:

1. **T-01** — descrições em inglês. Atinge toda ficha, de toda classe, o tempo
   todo. É o que o dono viu primeiro.
2. **P-01** — teto de perícia. Regra do sistema violada em 12/12 classes, e o
   conserto é pequeno e localizado.
3. **`ItemAlteration`** (288 instâncias, o tipo mais frequente) — destrava de uma
   vez boa parte de M-02, M-03 e M-04.
4. **M-02** — os ~9 documentos de instinto do Bárbaro. Poucos arquivos, subclasse
   inteira de volta.
5. **V-01** — teste contra as pregens oficiais. Não conserta bug nenhum, mas é o
   que impede a próxima leva de passar despercebida.
6. **P-03 / P-04** — o mecanismo genérico de sub-escolha, que resolve 58
   pendências de uma vez em vez de uma a uma.
