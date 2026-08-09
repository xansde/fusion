# Convenções das specs — o metamodelo

Este documento define **o que é uma spec do Fusion** e as regras que a fazem valer.
Ele não descreve nenhuma funcionalidade: descreve o formato das que descrevem.

Parte destas regras é verificada mecanicamente por `tools/spec-lint`, que roda em
`pnpm test`. Onde há verificação automática, a regra abaixo diz o nome da regra.

---

## 1. O que é uma spec

> Uma spec é a menor unidade de **decisões que precisam ser tomadas juntas**, porque
> se restringem mutuamente.

Não é uma feature, não é um pacote, não é uma tela. O centro de gravidade de uma spec
é a seção **Decisões**: requisito é consequência, decisão é o que custa caro mudar.

O teste de corte, ao criar uma spec nova: _decidir X me obriga a decidir Y?_

- **Sim** → mesma spec, mesmo que ela fique grande. `06-canvas-e-renderizacao.md` tem
  89 requisitos porque grid, tokens, templates e desenhos compartilham sistema de
  coordenadas, pilha de camadas e loop de render. Tamanho não é defeito.
- **Não** → spec separada, mesmo que ela fique pequena. `32-minimapa-tatico.md` tem 16
  requisitos e a `DEC-MMT-01` declara explicitamente que o minimapa **não** é um segundo
  render da cena: ele consome a spec `06`, não a restringe.

Corolário: **não nasce spec nova para uma feature que apenas combina decisões que já
existem.** Isso é requisito dentro de uma spec de área.

## 2. A spec é a definição do objetivo

Uma spec descreve o que o Fusion **deve** ser, não o que ele é hoje. Disso decorre a
única leitura válida de uma divergência entre spec e código:

> Se o comportamento não cumpre a spec, então **ou a spec está desatualizada, ou a
> funcionalidade não foi cumprida corretamente.** Não existe terceira opção, e nenhuma
> das duas se resolve ignorando a divergência.

Consequências práticas:

- Mudou a decisão? A spec muda **antes** do código, não depois.
- Descobriu na implementação que a spec está errada? Corrija a spec no mesmo PR e
  registre o porquê na seção **Decisões** — spec silenciosamente contrariada é spec morta.
- Requisito que não se pretende mais cumprir é **removido ou reclassificado**, não
  deixado para trás como enfeite.

## 3. Os três níveis de documento em `specs/`

Estão todos na mesma pasta e usam a mesma numeração, mas não são a mesma coisa:

| Nível       | Quais      | Papel                                                                                              |
| ----------- | ---------- | -------------------------------------------------------------------------------------------------- |
| **Charter** | `00`, `27` | Por quê, para quem, linhas vermelhas (`00`); fases e ordem de entrega (`27`). Não decide mecânica. |
| **Área**    | `01`–`26`  | O sistema fatiado por subsistema. É o nível default.                                               |
| **Recorte** | `29`+      | Feature que atravessa várias áreas (multiclasse, pets, minimapa, mapa de região).                  |

Uma spec de **recorte** deve declarar, na seção Dependências, quais áreas ela atravessa e
quais decisões dessas áreas ela **não pode contrariar**. Ela nunca redefine um requisito de
uma área: cita.

> A numeração reflete a ordem em que as specs nasceram, não a estrutura. `28` e `33`
> estão vagos de propósito — ver §7.

## 4. Identificadores

Todo item numerado segue `<FAMÍLIA>-<ÁREA>-<NÚMERO>`:

| Família | Item                    | Exemplo       |
| ------- | ----------------------- | ------------- |
| `REQ`   | requisito funcional     | `REQ-ROL-012` |
| `RNF`   | requisito não-funcional | `RNF-ESC-01`  |
| `DEC`   | decisão                 | `DEC-MMT-01`  |
| `CA`    | critério de aceitação   | `CA-CBT-001`  |
| `CS`    | critério de sucesso     | `CS-ESC-01`   |
| `Q`     | questão em aberto       | `Q-ESC-01`    |

Regras:

- **Cada spec é dona de exatamente uma área, e cada área tem exatamente uma spec dona.**
  O registro está em [`README.md`](README.md), no bloco `prefixos`. _(regra
  `prefixo-com-dono` + `registro-de-prefixos`)_
- **Só a spec dona define ids da sua área.** Qualquer outra spec **cita**. _(regra
  `prefixo-com-dono`)_
- **Um id nomeia um único item, para sempre.** Não reaproveitar número de requisito
  removido — isso quebra toda referência externa (código, teste, issue). _(regra `id-unico`)_
- **Requisito inserido depois entra com sufixo de letra** — `REQ-CNV-035a` fica entre
  `035` e `036` — em vez de renumerar os seguintes. Renumerar invalida citações já feitas.
- **Toda citação tem que resolver** para um id definido em alguma spec. _(regra
  `citacao-resolvivel`, com o débito congelado em `DEBITO-CITACOES.txt`)_
- **Id de área não registrada é referência externa** (pesquisa em `docs/research/`, outro
  projeto) e não é resolvido — ex.: `Q-WF-05`. A contrapartida é que uma área errada passa
  despercebida na citação; só a definição é barrada.
- **Decisão se escreve `DEC-<ÁREA>-NN`**, sempre — nunca `D4`, `D-ARQ-01` ou
  `DECISÃO-ARQ-01`. Decisão citada de outra spec por número solto não identifica nada.
  _(regra `decisao-canonica`)_
- **Todo `REQ` carrega `[MVP]` ou `[V2]`.** Requisito sem tag não entra em nenhum marco do
  roadmap e portanto nunca é cobrado. Tags de recorte (`[MC]`, `[BC]`) são adicionais, não
  substituem. _(regra `req-com-tag`, com o débito congelado em `DEBITO-TAGS.txt`)_

### Como o verificador distingue definição de citação

Um id está **definido** quando abre o próprio bloco — termo em negrito no início de um
item de lista, título de seção, ou primeira célula de linha de tabela:

```markdown
- **REQ-ROL-012** [MVP] O servidor DEVE ...

### DEC-MMT-01 — Desenho leve próprio, não um segundo render da cena

| CA-CBT-001 | GM cria encontro na cena ativa ... |
```

Em qualquer outra posição é **citação**. Isso importa: o markdown quebra linha no meio do
parágrafo, então uma citação pode cair no começo de uma linha sem ser definição — é o
negrito/título/célula que separa os dois casos.

## 5. Anatomia de uma spec

Ordem canônica das seções (a de `08-motor-de-rolagens.md` é a referência):

1. **Objetivo** — uma frase sobre o que esta spec resolve.
2. **Escopo** — `O que inclui` e, obrigatoriamente, `O que NÃO inclui`.
3. **Conceitos e terminologia**.
4. **Decisões** — `DEC-<ÁREA>-NN`, cada uma com racional. É o núcleo do documento.
5. **Requisitos funcionais** — `REQ-`, agrupados por tema, cada um com `[MVP]`/`[V2]`.
6. **Requisitos não-funcionais** — `RNF-`.
7. **Modelo de dados** / **API e eventos**, quando houver.
8. **Dependências** — outras specs, e o que desta spec depende delas.
9. **Critérios de aceitação** — `CA-`, verificáveis.
10. **Questões em aberto** — `Q-`.
11. **Referências**.

Uma decisão que muda vira **nova decisão** com nota do que ela substitui; a antiga não é
apagada sem rastro.

## 6. Linguagem

- Specs em **pt-BR**; identificadores, nomes de campo e trechos de código em inglês.
- Força normativa explícita: **DEVE** / **NÃO DEVE** / **PODE**. Evitar "deveria",
  "idealmente", "seria bom" — não são verificáveis.
- Requisito é uma afirmação testável sobre comportamento observável. Se não dá para
  escrever o teste que o refuta, ele ainda é uma decisão, não um requisito.

## 7. Lacunas conhecidas

- **`28` — Hub do jogador**: reservada e ainda não escrita. É citada por
  `docs/design/handoff-system-window-client.md` como bloqueio dos painéis de Missões e
  Comitiva do System Window.
- **`33` — API de Módulos/Mods**: número reservado para o contrato de extensão de
  terceiros (ciclo de vida, pontos de extensão, sandbox e permissões). Hoje `00`
  (`REQ-ESC-012`) fixa sistemas como pacotes compilados e trata plugin dinâmico como [V2].
- ~~`DEC-` vs `D-`~~ — resolvido. As quatro grafias que conviviam (`D1`, `D-ARQ-01`,
  `DECISÃO-A11-01`, `DEC-MMT-01`) viraram `DEC-<ÁREA>-NN`: 115 títulos e 88 citações
  migrados, e a regra `decisao-canonica` barra a volta das formas antigas. Um `D4` citado
  de outra spec não nomeava nada — agora nomeia.
- **`DEBITO-TAGS.txt`**: 89 requisitos das specs `30` e `31` nasceram só com tag de recorte
  (`[MC]`, `[BC]`) e ainda precisam de `[MVP]`/`[V2]`.
- **`DEBITO-CITACOES.txt`**: `REQ-SYS-030`, `031` e `032` são citados 6× pela spec `15`
  (contract test da API de sistemas) e nunca foram escritos. Escrevê-los é decisão de
  autoria da spec 15.

Os dois arquivos de débito são catracas: o verificador aceita exatamente os ids listados
neles e nada mais, então a lista só encolhe. Item novo com o mesmo defeito falha o teste.

## 8. O que ainda não é verificado

O `spec-lint` garante a **integridade do namespace** — que os ids existem, são únicos, têm
dono e resolvem. Ele não garante o item mais importante do §2: que o código cumpre o que a
spec diz. Isso exige um laço de conformidade entre requisito e teste, que ainda não existe.
Enquanto ele não existir, a leitura honesta é que as specs descrevem a **intenção**
verificada por revisão humana, não o estado verificado do sistema.
