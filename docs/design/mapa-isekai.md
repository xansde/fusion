# Mapa do isekai no Fusion (design)

- **Status:** design v1 (pré-implementação)
- **Data:** 2026-08-07
- **Autor:** conversas de autoria de campanha (externas ao repo)
- **Escopo:** como a camada de MAPA de uma campanha isekai se apoia nos documentos do Fusion — `Scene`, `Note`, `ownership`, `flags` — quais escalas existem, e as regras de render que a spec 32 (minimapa) deve herdar.
- **Fontes normativas:** `specs/02-modelo-de-dados.md`, `specs/05-usuarios-e-permissoes.md`, `specs/06-canvas-e-renderizacao.md`, `specs/31-base-canonica-de-conteudo.md` (precedente Wayfinder).
- **Regra:** este documento **desenha**; não implementa. Onde diverge do estado real do código, a divergência é explícita e verificada — ver §3.3.1 e §14.

> **Princípio-guia.** O motor de campanha **não mora no Fusion**. A fronteira entre os dois é um
> **arquivo de dados**, exatamente como a `specs/31` já decidiu para o projeto Wayfinder. O Fusion
> importa; não hospeda o gerador.

> **Por que este documento está aqui.** Ele nasceu fora do repo, num projeto de autoria de conteúdo
> (a "Forja"). Está sendo trazido porque três partes dele são do motor, não da campanha, e existe
> risco real de alguém especificar em cima de premissa errada:
>
> 1. **§3.3.1** — `Note` aparece em planos como pronto desde o M1. Não está. Isso bloqueia
>    visibilidade de pin por jogador e, por consequência, a spec 32. Registrado na issue #78.
> 2. **§5** — regras de render de minimapa e três armadilhas de SVG já pagas por um protótipo
>    funcional, para a spec 32 não pagar de novo.
> 3. **§4** — o modelo de escalas de mapa (Mundo → Continente → Região → Local) ligadas por
>    _soft reference_, que é uma decisão de `Scene`, não de conteúdo.
>
> O resto (Yennericka, Shoneymouth, POIs, relógios de facção) é **contexto de campanha**, mantido
> porque dá concretude aos números — mas é externo ao motor e não vira requisito do Fusion.

---

## 1. Contexto em cinco linhas

O modelo de criar a campanha do isekai está sendo refeito. Sai "escrever aventura linear cena a
cena", entra **sandbox com pressão** (relógios de facção) rodando sobre os dados que já existem.
O que é sagrado: **a premissa isekai** (patrono + Rei Demônio) e **o mundo Yennericka com
Shoneymouth como base**. O resto do canon está na mesa.

A plataforma-alvo passou a ser o **Fusion VTT** (`github.com/xansde/fusion`), não mais o
Isekai-Companion como app de mesa.

---

## 2. Decisão de arquitetura — Forja e Mesa

Duas metades, com uma fronteira explícita entre elas.

|            | **Forja** — `Isekai-Companion`                                          | **Mesa** — `xansde/fusion`                                        |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Faz        | Gera o mundo, roda o motor entre sessões, gira relógios, emite conteúdo | Roda a sessão: canvas, tokens, combate, fichas, Hub dos jogadores |
| Ferramenta | Python + React, sem PR pra ninguém                                      | Svelte 5 + servidor autoritativo                                  |
| Fronteira  | Emite **arquivo de dados**                                              | Importa via `tools/importer-isekai`                               |

**Por que assim.** O Fusion não carrega módulos de terceiros em runtime (é [V2] global). Um motor
de campanha morando lá dentro viraria PR no repo do Xande a cada iteração.

**O precedente é do próprio repo.** A `specs/31-base-canonica-de-conteudo.md` já resolveu esse
mesmo problema com o projeto Wayfinder e escreveu a regra:

> _"a fronteira com o projeto Wayfinder é um **arquivo de dados**, não uma biblioteca."_

Seguimos o mesmo padrão. O Isekai-Companion é o Wayfinder do conteúdo de campanha.

---

## 3. O modelo de mapa no Fusion

### 3.1 Correspondência peça a peça

| Conceito             | Documento Fusion                 | Status no repo                                                        |
| -------------------- | -------------------------------- | --------------------------------------------------------------------- |
| O mapa de uma região | `Scene` + imagem de terreno      | **pronto** (M1)                                                       |
| Cada lugar           | `Note` embedded na Scene         | ⛔ **NÃO construído** — ver §3.3.1                                    |
| Estado do lugar      | `flags.isekai.*` na Scene        | **pronto** — `FlagsSchema` aceita `flags.<ns>.<key>`                  |
| Quem vê o quê        | `ownership` por Note             | ⛔ **não existe** — ownership é por _Document_, e Note não é Document |
| Escala em km         | `flags.isekai.kmPorPx` na Scene  | **pronto**                                                            |
| Ficha do lugar       | `JournalEntry` + `@UUID` do Note | **M4** — não construído                                               |

### 3.2 A regra que sustenta tudo

**Todo documento nasce oculto.** O `defaultOwnership()` do Fusion já é "só o GM vê". Você não
esconde as coisas — você **revela**. Consequência prática: dá pra despejar os 80 pins no mundo
hoje sem vazar nada.

### 3.3 Os três estados de visibilidade

Usamos os níveis nativos do Fusion, sem inventar sistema paralelo:

| Estado    | Nível Fusion | O que o jogador vê                                             |
| --------- | ------------ | -------------------------------------------------------------- |
| Oculto    | `NONE`       | Nada. O pin não é renderizado.                                 |
| Rumor     | `LIMITED`    | Um marcador com "?". Sabe que existe algo ali, não sabe o quê. |
| Conhecido | `OBSERVER`   | Ícone, nome, categoria, ficha.                                 |

O `LIMITED` existe exatamente pra isso e estava sobrando. Com ele, **um rumor ouvido numa taberna
vira um pin nascendo no mapa daquele jogador** — exploração deixa de ser narração e vira estado
do mundo, assimétrico entre os PCs.

> ⚠️ **A ideia continua certa, mas hoje não tem onde morar.** `ownership` é resolvido por
> _Document_, e `Note` não é Document — ver §3.3.1. Decidir isso é pré-requisito do C1/C3.

### 3.3.1 ⛔ Correção — `Note` não está construído

A tabela §3.1 dizia "pronto (M1)". **Está errado.** Verificado no repo em 2026-08-07:

```
grep -rn "NoteSchema|NoteDocument|NoteData" packages/ systems/   → nenhum resultado
packages/shared/src/scene.ts:471       notes: z.array(z.unknown())
   // comentário no próprio arquivo: "Full NoteData schema is defined in spec 06 (M2);
   //                                  placeholder here."
packages/server/src/documents/types.ts:142
   notes: z.array(z.record(z.string(), z.unknown()))
```

Não existe `NoteDocument`. É um array sem tipo dentro da `Scene`.

**Por que isso derruba o §3.3:** `resolveOwnership()` opera sobre Documents. Uma entrada em
`scene.notes` não tem `_id`, não tem `ownership`, não passa por checagem de permissão no servidor
e não tem CRUD. Repare que **token embedded esconde com um booleano `hidden`, não com ownership** —
justamente porque elemento embedded não carrega ownership no Fusion.

**As duas saídas, e o custo de cada uma:**

| Saída                                                                | O que exige                                                                               | Custo                                                                                                                                                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — `Note` vira Document de primeira classe**                      | schema em `shared`, CRUD no servidor, camada de render no canvas, entrada na spec 06 e 02 | alto, mas é o modelo certo e mantém `ownership` como fonte única                                                                                                                                          |
| **B — visibilidade por flag** (`flags.isekai.visivelPara: userId[]`) | só a flag e o filtro no cliente                                                           | baixo, **mas cria um sistema paralelo de visibilidade** — o que o `REQ-HUB-011` proíbe, porque dois modelos divergem em silêncio e a tela passa a mostrar o que o servidor diz que o jogador não pode ver |

**Recomendação: A**, e é conversa com o Xande antes do C1 — mexe em spec dele. Enquanto não
resolver, o C3 está bloqueado.

Registrado como issue no repo do Fusion (ver §14).

### 3.4 Sem fog — decisão travada

`tokenVision` e `fogEnabled` ficam `false` (já é o default por cena). O `ownership` passa a ser a
visibilidade efetiva. Já registrado em `docs/08-HUB-JOGADOR.md`.

Terreno aparece inteiro pra todo mundo, sempre — quem viaja vê o litoral e os rios, isso não é
segredo. O segredo é **o que tem naqueles lugares**.

Ganho colateral: a prévia de perspectiva ("ver como o Testador") é **exata**, não aproximada.

---

## 4. Escalas de mapa — e por que começar no meio

Quatro escalas, cada uma uma `Scene` separada. A ligação entre elas é um `Note` que aponta pro
UUID de outra Scene.

```
[4] Mundo          — talvez nunca
        ^ portal
[3] Continente     — depois, quando a mesa passar do nível ~8
        ^ portal
[2] Região         — COMEÇA AQUI. O Ermo de Shoneymouth, 80 POIs já existem
        ^ portal
[1] Local          — dungeon, vila, interior. Grid tático.
```

**Por que começar na escala 2 funciona:** a ligação é _soft reference_, não containment. Não é
"o continente contém a região"; é "este pin aponta pra aquela cena". Criar o Continente daqui a
seis meses é criar uma Scene nova e apontar um pin dela pra Região existente. **Nada do que foi
construído quebra.** O mapa cresce pra fora, não de cima pra baixo.

### O mapa atual do Azgaar

**Aposentar como mapa de mesa.** O `public/yennericka-map.svg` tem 4,7 MB de vetor gerado, milhares
de polígonos, e trava o pan. Não vai virar `Scene`.

**Manter como fonte de cânone.** Nomes, 276 reinos, religiões, culturas, províncias e o
`distanceScale`. Continua alimentando a Forja — só não é o que aparece na tela. O mapa de jogo é
uma **imagem de verdade por região**.

---

## 5. Regras de render do minimapa

Estas regras saíram de um protótipo funcional (ver §7) e devem valer também no minimapa do Fusion
(spec 32, território do Xande).

> ⚠️ **Existem DOIS minimapas, e "spec 32" hoje é ambíguo.** Contagem de termos no
> `prototipo-minimapa-regiao.html`: 60 × "poi", 32 × "km", 1 × "token". É mapa de **escala Região**
> (viagem, exploração). Em paralelo existe um minimapa de **escala Local** em construção na branch
> `feat/minimap` do Fusion — tokens dos jogadores, HP, inimigos, régua em quadrados, clique pra
> centralizar a câmera num jogador.
>
> Pelas próprias escalas do §4, um é **[2] Região** e o outro é **[1] Local**. Não é trabalho
> duplicado; é nome colidindo. Nomes propostos:
>
> - **Mapa de Região** — exploração, POIs, dias de viagem _(esta conversa)_
> - **Minimapa Tático** — cena de batalha, tokens, régua _(conversa do Hub)_
>
> A spec 32 escolhe um dos dois, ou vira duas specs.

### 5.1 A regra central

**O mundo escala, a interface não.**

| Elemento                        | No zoom          | Como                                                                       |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| Terreno (costa, rios, estradas) | escala           | camada com `transform`, traços com `vector-effect: non-scaling-stroke`     |
| **Ícones dos pinos**            | **tamanho fixo** | camada **sem transform**; posição recalculada por quadro, escala constante |
| Rótulos                         | LOD por zoom     | cidades sempre · todos ≥1,3× · categoria e nível ≥2,2×                     |
| Barra de escala                 | recalcula km     | degrau redondo (5/10/25/50/100) que caiba na largura                       |
| Pan                             | trava nas bordas | o recorte é a fronteira do que existe                                      |

Se o ícone crescer junto com o zoom, aproximar vira sopa de manchas coloridas. **Posição é do
mundo; tamanho de ícone é da tela.** No Fusion o pin é um `Note` sobre canvas PIXI com câmera
própria — o mesmo princípio precisa valer lá.

### 5.2 Três armadilhas técnicas que custaram tempo — não repetir

**a) `<use>` sem `width`/`height` renderiza o símbolo no tamanho do viewport.**
Quando um `<use>` aponta pra um `<symbol>` e você não dá dimensão, o default é `100%`, que resolve
pro **viewport inteiro** — não pro `viewBox` do símbolo. Ícones de 24×24 saíram desenhados a
1024×688.

```html
<!-- errado -->
<g transform="translate(-7.5,-7.5) scale(.625)" stroke="COR"><use href="#ic-camp" /></g>
<!-- certo -->
<use href="#ic-camp" x="-7.5" y="-7.5" width="15" height="15" color="COR" stroke-width="2.6" />
```

**b) `stroke="currentColor"` no `<symbol>` sobrescreve o `stroke` do pai.**
Passar `stroke=` no grupo não adianta — o símbolo redeclara. Passe **`color=`** no ponto de uso,
pra que o `currentColor` resolva certo. Senão a cor cai no valor herdado do `body`.

**c) Parser de path SVG precisa cobrir `Q`, não só `M/L/C`.**
O path da massa continental do Azgaar mistura `C` e `Q` (quadrática). Um tokenizer que só entende
`M/L/C` desalinha o pareamento x,y do primeiro `Q` em diante e produz geometria embaralhada.
Cobrir o conjunto completo: `M L H V C S Q T A Z`, absoluto e relativo.

---

## 6. De onde vêm os dados

### 6.1 Arquivos-fonte

| Dado              | Arquivo                                   | Números reais                                                                         |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Mundo             | `Vault-Isekai/_Sistema/Yennericka.map`    | Azgaar FMG v1.126.1                                                                   |
| Cidades + lookups | `Isekai-Companion/public/yennericka.json` | 739 burgs · 12 reinos · 15 religiões · 10 culturas · 266 províncias · mundo 2287×1080 |
| Escala            | mesmo arquivo, `kmPerPx`                  | **4,0 km por pixel**                                                                  |
| POIs              | `Isekai-Companion/public/pois.json`       | 80 POIs · assentamento 15, marco 13, batalha 14, enigma 10, masmorra 18, contrato 10  |
| Terreno vetorial  | `public/yennericka-map.svg`               | camadas `featurePaths`, `rivers`, `roads`, `trails`, `lakes`                          |
| Conteúdo PF2e     | `public/data/pf2e/`                       | 2598 criaturas · 3042 itens · 2058 magias                                             |

Marcha de viagem usada: **a pé 30 · carroça 40 · cavalo 55 km/dia**.

### 6.2 O recorte da região piloto

Caixa em unidades do `.map`: **X 234–362, Y 476–562** → 128 × 86 unidades = **512 × 344 km**.

Geografia extraída e enxugada para ~15 KB: polígono de terra com **112 pontos** (Sutherland-Hodgman
sobre a polilinha de 17.042 pontos do landmass), **3 trechos de costa**, 3 rios, 2 estradas,
9 trilhas, 2 lagos.

### 6.3 A base e as três vizinhas

| Cidade                 | Coord         | Distância | A pé  | Perfil                                               |
| ---------------------- | ------------- | --------- | ----- | ---------------------------------------------------- |
| **Shoneymouth** (base) | 292,4 / 513   | —         | —     | vilarejo pesqueiro, 1.380 hab, porto, **Hateshamia** |
| Godford                | 257,5 / 543,4 | 185 km    | 6,2 d | vilarejo de lago, 979 hab, **Apleringia**            |
| Birton                 | 258,1 / 549,7 | 201 km    | 6,7 d | vila grande, 3.761 hab, **Apleringia**               |
| Flokleigh              | 344,1 / 514,9 | 207 km    | 6,9 d | vilarejo, porto, **Hateshamia**                      |

Cultura comum às quatro: **Thorndon**. Religião predominante: _Cult of the Calm Buffalo of Pain_.

Os 13 POIs mais próximos vão de 58 km (Vaza-Maré, 1,9 d) a 188 km (Cemitério de Barcaças, 6,3 d).

---

## 7. Artefatos produzidos (já no disco)

Dois HTML locais, autocontidos, sem CDN, ícones em SVG desenhado à mão (sem emoji):

| Arquivo                                      | O que é                                                                                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/fluxo-autoria-campanha.html`    | Diagrama do pipeline de autoria: `/mapa`, `/inimigo`, `/missao`, `/sessao`, com setas ligando Forja → pack → mundo Fusion → mesa. Inclui tabela de status real do repo.                               |
| `docs/design/prototipo-minimapa-regiao.html` | Protótipo funcional do minimapa da região: geografia real, 17 pinos, zoom até 12× com ícone de tamanho fixo, troca de perspectiva (Mestre/Testador/Comedor/Grupo), Console de Revelação em miniatura. |

O segundo é **a referência de implementação** do minimapa de região. Vale abrir antes de escrever a
spec 32 — as regras do §5 saíram dele.

---

## 8. O que vai pro git

> ⚠️ **Seção reescrita.** A lista original supunha que o projeto de autoria (`Isekai-Companion`)
> fosse um repositório git — não é (sem `.git`). O que era versionável **do lado do motor** foi
> trazido para cá:
>
> | Arquivo                         | Onde ficou                                   |
> | ------------------------------- | -------------------------------------------- |
> | este documento                  | `docs/design/mapa-isekai.md`                 |
> | protótipo do minimapa de região | `docs/design/prototipo-minimapa-regiao.html` |
> | diagrama do pipeline de autoria | `docs/design/fluxo-autoria-campanha.html`    |
>
> Os dados de campanha (`pois.json`, `yennericka.json`, o `.map` do Azgaar, o SVG de 4,7 MB)
> **não** vêm — são conteúdo externo, e entram no Fusion como pack via importador (§2).

**Ficou de fora, no projeto de autoria:**

- `docs/design/mapa-isekai.md` (este arquivo)
- `docs/design/fluxo-autoria-campanha.html`
- `docs/design/prototipo-minimapa-regiao.html`
- **Não vai (gerado ou pesado):**
- `public/yennericka-map.svg` (4,7 MB, gerado por script)
- Qualquer `*-tmp.json` de trabalho

---

## 9. Sequência proposta

| Etapa  | O quê                                                                                                       | Depende de   |
| ------ | ----------------------------------------------------------------------------------------------------------- | ------------ |
| **C0** | Spec **33 — Motor de Campanha** (28 é o Hub, 32 é o minimapa). Define `flags.isekai.*` e o contrato do pack | —            |
| **C1** | `tools/importer-isekai` → pack `isekai.yennericka`: Scene + Notes + cidades                                 | C0           |
| **C2** | Motor na Forja: estado + frentes + relógios amarrados em dias de viagem                                     | C1           |
| **C3** | Quest/POI como `Note` com ownership; publicar = subir ownership                                             | **H0** + C2  |
| **C4** | Board no Hub + notificação diegética                                                                        | **H2, H3.5** |

O **H0** (resolvedor de visibilidade, ~1 noite) continua sendo a primeira coisa — e agora com mais
razão: vira o terceiro consumidor da mesma função (Hub, minimapa, board de quests).

---

## 10. Em aberto — precisa de resposta antes de avançar

1. **`world.time` está implementado ou é só spec?** É a spec 14, marcada M4; busca no código não
   retornou implementação. Decide se os relógios de facção amarram em tempo de jogo desde já ou
   ficam na Forja até o M4. **Pergunta pro Xande.**
2. **H4.0 — onde mora o isekai:** homebrew dentro de `systems/pf2e` ou `systems/isekai` próprio?
   Recomendação: **`pf2e`** — o motor vive em `flags` e em packs, e flags não pedem sistema próprio.
3. **Contrato de saída da skill:** a skill emite JSON intermediário (`isekai-mapa-<regiao>.json`,
   schema documentado) e o `importer-isekai` converte pra pack? Ou a skill já cospe `pack.db`?
   Recomendação: **JSON intermediário** — desacopla a Forja da toolchain do Fusion e deixa o
   resultado editável antes de publicar.
4. **A escala do mundo.** A 4 km/px a vizinha mais próxima fica a uma semana de caminhada. Ótimo
   pra fazer viagem custar (o motor de relógios adora), ruim se a mesa precisa ir e voltar de
   Shoneymouth nos primeiros níveis. Dá pra ajustar o `distanceScale` no `.map` e regerar — mas
   **é decisão a tomar antes de publicar os 80 pins**, não depois.

---

## 11. Bloqueios conhecidos, e as rotas em volta

| Bloqueio                                                                                      | Rota                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JournalEntry` e `RollTable` são **M4** (tabelas existem no banco, subsistema não construído) | Ficha do lugar vive **dentro do próprio `Note`** por enquanto. Quando o M4 chegar, a versão em página de journal entra por cima — o `ownership` não muda. |
| Sem módulos em runtime                                                                        | Motor mora na Forja; fronteira é arquivo de dados (§2).                                                                                                   |
| Gerador não tem onde rodar dentro do Fusion                                                   | Roda na Forja, em Python. Melhor mesmo depois do M4 — geração entre sessões não precisa ser tempo real, e dá pra editar antes de publicar.                |

---

## 12. Dois achados que valem carregar

**Fronteira política de graça.** Shoneymouth é de **Hateshamia**, mas as duas vizinhas mais
próximas (Godford e Birton) são de **Apleringia**. A única do mesmo reino, Flokleigh, é a mais
distante das três. A vila natal tem os vizinhos mais próximos do outro lado de uma fronteira.
Ninguém desenhou isso — é o Azgaar — mas é tensão pronta pra usar.

**Os 16 rumores parados.** O `pois.json` foi gerado com 9 ameaças recorrentes, 10 fios de quest e
16 rumores que nunca foram usados. Com `Note` + `ownership`, cada rumor vira um pin nascendo no
mapa de um jogador específico. É o motor de curiosidade da campanha, já escrito, só esperando o
encanamento.

---

## 13. Sobre rodar o conselho (skill `council-review`)

Perguntado se valia rodar o conselho antes de começar. **Não agora**, por dois motivos:

1. O epílogo do `08-HUB-JOGADOR.md` registra que o último conselho gastou 12 chamadas de agente e
   duas reescritas do plano debatendo a gravidade de um risco cuja **precondição era falsa** (o fog
   nem estava ligado). A lição anotada foi: checar precondição antes de convocar debate. Os itens
   1 e 2 do §10 são exatamente isso — perguntas factuais de trinta segundos.
2. As decisões imediatas são de **contrato** (schema, nome de campo, formato de saída), não de
   julgamento com espaço de solução largo. Conselho é caro pra isso.

**Guardar o conselho para:** a decisão de **escala do mundo** (§10.4, irreversível depois de
publicar) e a **reformulação do Grande Segredo** (fora do escopo deste doc, mas é o outro fork real
da campanha).

---

## 14. Verificação contra o código, e itens abertos

Este documento nasceu fora do repo. Antes de entrar, cada afirmação sobre o estado do Fusion foi
conferida contra o `build/app`. O que não bateu está corrigido abaixo, com a evidência.

### Correções aplicadas

| §                     | O que mudou                                                                                                                              | Evidência                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 · 3.3 · **3.3.1** | `Note` deixou de constar como "pronto (M1)". Não existe `NoteDocument`, e `ownership` é resolvido por _Document_ — `Note` não é Document | `packages/shared/src/scene.ts:471` · `packages/server/src/documents/types.ts:142` · grep por `NoteSchema\|NoteDocument\|NoteData` sem resultado |
| 3.2 · 4 · 10.4        | "85 pins/POIs" → **80**                                                                                                                  | contagem real do `pois.json` de origem                                                                                                          |
| 5                     | Registrado que "minimapa" nomeia **dois** produtos de escalas diferentes, e que a spec 32 precisa escolher                               | contagem de termos no protótipo: 60 × "poi", 32 × "km", 1 × "token"                                                                             |
| 8                     | Lista de "o que vai pro git" reescrita — o projeto de autoria não é repositório versionado                                               | ausência de `.git` na árvore de origem                                                                                                          |

### Rastreamento no repo

| Item                                                                       | Onde                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Note` não construído · ambiguidade da spec 32 · armadilhas de SVG do §5.2 | [#78](https://github.com/xansde/fusion/issues/78)                                                   |
| Layer do Hub + escala de z-index unificada (REQ-UIF-008)                   | [#76](https://github.com/xansde/fusion/issues/76) · [#77](https://github.com/xansde/fusion/pull/77) |

### Decisões que este documento NÃO pode tomar sozinho

1. **`Note` como Document (§3.3.1).** Mexe nas specs 02 e 06. Bloqueia visibilidade de pin por
   jogador e a spec 32. É a decisão mais urgente daqui.
2. **Escala do mundo (§10.4).** A 4 km/px a vizinha mais próxima fica a uma semana de caminhada.
   Ajustável no `.map` de origem — mas **irreversível depois de publicar os pins**.
3. **`world.time` (§10.1).** Spec 14, marcada M4; busca no código não retornou implementação.
   Decide se os relógios de facção amarram em tempo de jogo ou ficam fora do motor por enquanto.

### Fronteira de responsabilidade

| Frente                                                                   | Onde vive                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Geração de mundo, dados de região, mapa de exploração, skills de autoria | **fora** do Fusion (a Forja)                                                                         |
| Canvas, `Note`, `ownership`, minimapa tático, Hub do jogador             | **no** Fusion                                                                                        |
| Resolvedor de visibilidade efetiva em `packages/shared`                  | **no** Fusion — três consumidores previstos (Hub, minimapa, board de quests). Implementar uma vez só |
