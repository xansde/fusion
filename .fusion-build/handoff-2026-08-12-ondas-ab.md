# Handoff — ondas A e B entregues, ajustes do teste ao vivo, e o caminho para C e D (2026-08-12, noite)

> Continuação direta de `handoff-2026-08-12.md` (a triagem). Base: `build/app` @ `aff170a`.
> Leia isto antes de escolher o que fazer — **metade dos ajustes pendentes veio de teste
> ao vivo, não de leitura de código**, e três "defeitos" reportados eram erro do roteiro.

---

## 1. Estado ao fim desta sessão

| Item | Estado |
|---|---|
| PRs `#111` `#112` `#113` | **MERGEADOS** (instrução literal do Alexandre) |
| Issues abertas | **64 → 47** (17 fechadas com medição anexada) |
| PR **#114** — Onda A (conjuração) | aberto, CI verde, **aguarda merge humano** |
| PR **#115** — Onda B (classe/ficha) | aberto, **empilhado sobre o #114**, aguarda merge |
| Ondas C e D | **não começaram** |
| Servidor de demo | porta 33002, data-dir isolado (ver §6) |

**Merge é decisão humana.** O `#115` tem base `feat/onda-a-conjuracao`; ao mergear o
`#114`, o GitHub retarget o `#115` para `build/app` sozinho.

---

## 2. O que entrou nas duas ondas

### PR #114 — Onda A (conjuração)

`Closes #6 #7 #8 #36 #37 #50` + `#13` · `Refs #5 #34` (parciais de propósito)

O número que resume: dos 458 focus spells dos packs, **214 (47%) não tinham destino
possível**. `hasFocusFeature` era heurística de NOME — só reconhecia feature de nível 1
terminada em `" Spells"`, o que cobre 4 das 12 classes. Monge e Patrulheiro não ganhavam
nem entrada de conjuração.

Três decisões que o próximo precisa conhecer:

1. **`#13` foi resolvido tirando código.** O mecanismo de progressão já existia e já servia
   armas, saves, percepção e CD de classe (`effectiveRank`, `build.ts`). O defeito era
   `stepCharSpellcasting` **ler** o `proficiency.value` congelado no item. Agora deriva. O
   `value: 1` da criação continua certo.
2. **Buraco de pack exposto, não mascarado:** o Cleric não tem nenhuma entrada
   `stat: "spellcasting"` em `proficiencyUpgrades`, então fica congelado em treinado mesmo
   com o código certo. Nenhum fallback foi posto — fingir progressão esconderia a falta do
   dado. **Vale issue própria.**
3. **O mapa de foco é curado por necessidade.** Nenhuma das 4 classes destravadas tem sinal
   estruturado no pack (ChoiceSet não convertido, `system.rules` vazio, GrantItem com uuid
   template). Cada entrada carrega o texto RAW do talento ao lado — é de lá que o teste tira
   a asserção, nunca do pack.

### PR #115 — Onda B (classe e ficha)

`Closes #11 #12 #38 #39 #49`

- **`#39` não era erro de fórmula.** `stepCharBuildHp` exigia, além do item de classe, item
  de ancestralidade **ou** bloco `system.build`. Logo após o picker de classe não existe
  nenhum dos dois, então abortava antes de calcular. Os valores que o gate protegia já
  degradavam com `?? 0` — ele não protegia nada.
- **O título da `#11` apontava para o lugar errado.** O markup existe e sempre existiu;
  personagem de builder nunca tem `system.abilities` persistido (só `derived.abilityScores`),
  e o guard zerava o bloco.
- **`#38` é a `#63` uma camada acima** — rótulo lendo o cru, total lendo o derivado.
- **`#49` foi barrado nos DOIS lados.** O agente entregou só o gate da UI; um gate só de UI
  não é gate, porque `doc:update` com `rank` explícito nunca passa pelo diálogo.

**A melhor validação da rodada veio de fora:** o teste de paridade contra os pregens
publicados exige que a baseline de divergências só encolha, e **as 15 classes saíram dela de
uma vez** quando o teto do `#49` entrou. É o argumento da `#48` em ação — a varredura interna
compara a derivação contra a tabela do próprio pack, então uma regra **ausente dos dois
lados** não tem com o que discordar e nunca poderia falhar lá.

---

## 3. AJUSTES PENDENTES — vieram do teste ao vivo (começar por aqui)

O Alexandre rodou o roteiro no servidor. Achou **2 defeitos reais + 1 bônus**, e pegou
**3 erros meus de roteiro**. Nada disto está corrigido.

### 3.1 `#34` não marca o pré-requisito negativo — o ganho é INVISÍVEL hoje

**Sintoma medido:** com `Harmful Font` escolhida, `Mãos Curativas` (que exige `healing font`)
aparece **sem marca nenhuma**, exatamente como antes da correção.

**Causa:** `AXIS_SUFFIX_TO_SLOT_TYPE` (`planVM.ts` ~2389) nunca ganhou a entrada `font`. Sem
ela, `matchAxisSuffix("healing font")` falha e `evaluatePrerequisiteCandidate` devolve
`unresolved` — que por DEC-BC-05 não marca nada. Ou seja: com ou sem Fonte Divina, a tela é
idêntica. **O `#34` entregou algo que não dá para ver.**

**Correção:** adicionar `{ phrase: "font", slotType: "divineFont" }`, mesmo padrão do `#19`.
É seguro no ponto que derrubou `gate` e `bloodline`: o item guarda o pick no PRÓPRIO nome
(`"Healing Font"` / `"Harmful Font"` → core `healing` / `harmful`).

**A armadilha — não faça ingenuamente.** Estes prerequisites contêm "font" e precisam de
tratamento antes:

| Texto no pack | Talento | O que acontece se só adicionar `font` |
|---|---|---|
| `divine font` | Martyr (8) | strip → `""` → requisito genérico → **met com qualquer fonte. Correto.** |
| `harmful font or healing font` | Fast Channel, Versatile Font, Sacred Ground, Cast Down | OR resolve pelo lado certo. **Correto.** |
| `deity who grants heal divine font` | Bless Tonic (7) | strip → `"deity who grants heal divine"` ≠ `healing` → **MARCA FALSA** |
| `deity who grants harm divine font` | Bless Toxin (7) | idem → **MARCA FALSA** |

As duas últimas são prosa do vendor e já são parentes da `#46`. Trate-as (lista de frases
não modeladas, como `UNMODELED_AXIS_PHRASES`, ou casamento mais estrito) **antes** de ligar
o eixo. Teste não-circular: montar Clérigo com cada fonte e afirmar met/unmet nos docs reais
de `Healing Hands` / `Harming Hands`, com a asserção vindo da regra, não do pack.

### 3.2 `#7` está incompleto — 85 magias furam o filtro por classe

**Sintoma:** o Monge consegue escolher magias que não são dele.

**Medido:** das 458 magias de foco, **85 não têm trait de classe nenhum**, e
`matchesClassTrait` trata "sem trait de classe" como "compartilhada, sempre elegível". Um
**Monge nível 1 vê 25 magias** — `Crown of Prophets`, `Crushing Ground`, `Garden of Healing`
e afins, quase nenhuma dele.

**O conserto óbvio não serve:** exigir trait de classe quebraria o Clérigo, porque as magias
de domínio dele estão justamente entre as 85 sem trait.

**A fonte de verdade certa é qual FEATURE concedeu o pool de foco**, não o trait da magia — e
esse dado é o mesmo ChoiceSet não convertido que já bloqueia a escolha automática do domínio
(`choiceSetInventory.ts`, `domainInitiate` ainda `pendente`). **Não cabe em remendo: abra
issue.** O paliativo sugerido pelo Alexandre (chips multi-seleção no picker, ex. `Foco` +
`Monge`) é razoável como UX enquanto isso, mas o alvo é não precisar filtrar à mão.

### 3.3 Bônus — os dois pseudo-docs da Fonte Divina nasceram só em inglês

A ficha mostra **"Harmful Font"** enquanto o diálogo oferece "Fonte de Dano". `DIVINE_FONT_OPTIONS`
(`planVM.ts` ~4260) sintetiza os nomes em inglês e nenhum pack os traduz. Correção pequena,
mas é o único item do plano em inglês na tela.

### 3.4 Três correções no ROTEIRO (não no código)

O roteiro está publicado como artifact e tem três afirmações erradas:

1. **"Talento de Classe nível 1 do Clérigo"** — não existe, e está certo assim:
   `Cleric.classFeatLevels.class = [2,4,6,…]`. Quem tem no nível 1 é Guerreiro, Monge e
   Bárbaro. `Iniciado de Domínio` se escolhe no nível 2.
2. **"Não existe aba de Magias no Monge"** — a lista de abas é **estática** no
   `CharacterSheet.svelte`; a aba Magias nunca some. O observável do `#5` é o **pool 1/1 e a
   entrada de conjuração**, não a aba surgir.
3. **`Fatal Aria` → `Aria Letal`** (já corrigido na última versão do roteiro).

---

## 4. O que JÁ PASSOU no teste ao vivo (não re-testar)

| Passo | Issue | Resultado |
|---|---|---|
| 2, 3, 4, 6 | `#39` `#11` `#38` | PV 26/26, faixa de atributos preenchida, Fort **T** · Ref **T** · Von **E** no Clérigo |
| 5 | `#12` | Bárbaro oferece só Força (Monge oferece Des+For — contraprova pendente) |
| 11 | `#5` | Pool 1/1 abre com `Iniciado de Domínio`. Escolher a magia à mão é a limitação já documentada |
| 14 | `#37` | Bardo: `REPERTÓRIO` + `2/2 espaços`. Clérigo: `GRIMÓRIO` + `Preparar do grimório…`. Contraste perfeito |
| 17 | `#36` | Truque não gasta ponto **e** a magia de foco de verdade do Clérigo gasta — a contraprova que o roteiro não pedia |

---

## 5. Ondas C e D — o worklist medido

**`.fusion-build/medicao-issues-2026-08-12.md`** (commitado ao lado deste arquivo) traz, para
cada uma das **37 issues vivas**, a medição concreta contra o código, os arquivos com linha e
um esboço de correção. **Os números de linha são de ANTES das ondas A e B** — confira
`arquivo:linha` no código atual antes de editar.

### Onda D — a mesa (recomendação de rumo, mantida)

`#83` é o ponto de entrada: `TokenAddDialog.svelte` e `WallsLayer.ts` **não são referenciados
em lugar nenhum**, e o `$push` que os dois mandam **não existe no servidor**. Trabalho dos
dois lados: operador de coleção no protocolo + montar os dois gestos no cliente. Cubra a
redação de visibilidade (`packages/server/src/net/redaction.ts`, **quatro** caminhos: snapshot,
broadcast, replay de delta e o eco do ack) e lembre que os schemas do servidor usam
`.extend()` sem `.passthrough()` — campo não declarado é apagado em silêncio.

Depois: `#81` `#84` `#62`–`#65` `#72` `#80`.

### Onda C — packs / importer

`#3` (254 regras GrantItem, 0 apontando para magias) · `#51` (1.259 regras inertes em 723
docs) · `#52` `#53` `#54` `#55` `#56` `#59` `#32` `#33` `#9` `#42` `#43` `#26` `#28` `#30` `#46`.

### Duas issues mantidas ABERTAS de propósito — precisam de prova jogada

- **`#72` (Descansar não recupera PV)** — o `restHpRecovery()` existe desde `9835d13`
  (**2026-07-06**) e a issue foi aberta em **2026-08-02**. Quem reportou viu o defeito **com
  esse código presente**. "Existe código e tem teste" não é evidência aqui. Três hipóteses no
  comentário da issue; um clique em Descansar separa as três.
- **`#80` (tela preta)** — o commit `5173ccc` cita `(#80)` mas nunca declarou fechar, e a
  triagem cinco dias depois ainda a listava pendente.

---

## 6. Servidor de demo — como levantar de novo

```bash
pnpm build   # obrigatório: o serve roda do dist
```

```powershell
# Destacado da sessão — em background comum ele morre junto com o turno
Start-Process node -ArgumentList @("packages/server/dist/cli/index.js","serve",
  "--world","teste_xande","--port","33002","--data-dir","<scratchpad>\fusion-demo") `
  -WorkingDirectory "C:\Users\xansd\pessoal\fusion" -WindowStyle Hidden
```

O data-dir é uma **cópia** de `~/.fusion/worlds/teste_xande` no scratchpad — mexer nele não
toca o mundo real. Havia um `fusion serve --port 33001` do Alexandre rodando desde 08:45;
**nunca subir na 33000/33001**. Gamemaster e Tobias entram sem senha.

---

## 7. Gotchas desta sessão (economizam tempo na próxima)

### 7.1 "Já feito" de varredura mente — cheque a data da issue contra a do commit

A varredura classificou 19 issues como resolvidas. **Recusei duas.** O teste que as derrubou:
se o commit que "corrige" é **anterior** à abertura da issue, quem reportou viu o defeito com
aquele código presente — logo o código não é evidência de nada. Foi o caso da `#72` (fix de
julho, issue de agosto). Aplique sempre antes de fechar em lote.

### 7.2 Trilhas de workflow precisam ser disjuntas POR ARQUIVO, não por assunto

Na Onda A dividi por assunto e `characterSheetVM.ts` caiu em duas trilhas. O agente da trilha
1 rodou o teste enquanto o agente da trilha 3 editava o mesmo arquivo, viu 2 falhas e as
reportou como **"pré-existentes"**. Não eram: isoladas, 233/233 passam. Na Onda B declarei
exclusividade explícita ("você é o ÚNICO agente autorizado a editar X") e o problema sumiu.

### 7.3 Verifique o resultado você mesmo — sempre

Nenhum agente mentiu, mas: um marcou `Closes #34` para trabalho parcial (corrigi a mensagem
antes do push), dois deixaram metade da correção fora do escopo e nomearam isso no relatório
(fechei as duas pontas eu mesmo — o `#38` do lado do client e o `#49` do lado do servidor).
**Ler o caveat do relatório é onde estava o trabalho que faltava.**

### 7.4 Todo slot novo precisa de caso no harness da varredura

O `divineFont` caiu no `default` de `classBuildHarness.ts` e reprovou o Cleric na varredura
das classes com `unrecognized slot type`. Slot cujas opções não vêm de docs tagueados precisa
de `case` próprio, ao lado do `kineticGate`.

### 7.5 Infra

- **`vitest.config.ts` do client: `testTimeout` 15s → 30s.** As suítes que fazem
  `await import(...)` de dentro do primeiro `it(...)` fazem esse teste pagar a compilação do
  grafo inteiro dentro do próprio timeout. Medido: transform de 15,6s contra teto de 15s — o
  primeiro teste falhava e os outros 11 passavam; 12/12 verde com 60s.
- **`git show <rev>:<path>` no Git Bash do Windows** precisa de `MSYS_NO_PATHCONV=1`, senão o
  MSYS converte o path e dá "ambiguous argument".
- **`gh` alterna de conta sozinho** no meio de um loop: o `gh issue close` falhou em 3 de 17
  issues com "xansde-seazone does not have permission". Refaça `gh auth switch --user xansde`
  e confira, e cuidado com retry cego — eu postei comentário duplicado em 3 issues e tive que
  apagar via API.
- **`prettier --check` do repo NÃO cobre `.svelte`** (`"**/*.{ts,tsx,json,md}"`). Rodar
  prettier em `.svelte` dá "No parser could be inferred" — é esperado, não é defeito.

---

## 8. Como retomar

```bash
cd ~/pessoal/fusion
git checkout build/app && git pull
gh pr view 114 && gh pr view 115      # decidir merge (humano)
```

Ordem sugerida: mergear `#114` e `#115` → aplicar os ajustes da §3 (que tocam `planVM.ts`,
já mexido pelas duas ondas) → escolher entre Onda D (destrava a mesa) e Onda C (packs).

O rumo recomendado continua sendo **D**: temos 492 monstros e nenhum gesto na interface põe
um deles no mapa.

---

## 9. ADENDO — o handoff foi executado (2026-08-12, madrugada)

A sessão seguinte rodou este handoff em ultracode. Estado ao fechar:

| Entrega | Onde |
|---|---|
| §3.1 + §3.3 (eixo `font` do #34 + Fonte Divina em pt-BR) | **PR #119**, empilhado sobre o #115 |
| §3.2 → issue do filtro de foco (85 magias sem trait) | **#117** |
| Issue do pack do Cleric sem progressão de conjuração (§2, "vale issue própria") | **#118** |
| §3.4 → roteiro (artifact) corrigido | passos 10/12 (talento é nível 2) e 19/20 (aba Magias é fixa) |
| **Onda D** (#83 #81 #84 #62) | **PR #121** contra `build/app`, 12 commits |
| Powerful Fist não faz nada (motor ItemAlteration inexistente + itemId placeholder) | **#120**, descoberto pela trilha do #62 |

**Validação ao vivo (GM, mesma noite):** e2e completo no build do #119 — tudo bateu,
inclusive a inversão da marcação com a troca de fonte (o ganho do #34 ficou visível) e o
pt-BR na ficha. Mártir não é testável ao vivo em personagem nível 1–2 (talento de nível 8;
coberto por teste unitário do caso multiclasse). **#34 segue aberta de propósito**: falta a
metade mecânica — os espaços de Curar/Dano por dia — reconfirmada pelo GM no teste.
**#72 e #80 continuam sem prova jogada.**

**Verificação da Onda D:** cinco trilhas disjuntas POR ARQUIVO (client serializado — a
lição da §7.2 aplicada e funcionando), duas rodadas de revisão adversarial que acharam e
mataram 9 problemas reais (porta que não abria pelo mesmo defeito de shape do `$push`,
interação PIXI morta por `eventMode`, o fix do #81 desfazendo o estado compartilhado,
jogador vendo a geometria das paredes por cima do fog, etc.). Suítes completas: server
1136 ✓ · client 3272 ✓ · pf2e 1133 ✓ · shared 906 ✓ (única falha: `pregen-parity`,
ambiental — vendor `iconics` ausente na worktree).

**Merge (humano, ordem sugerida):** `#114` → `#115` → `#119` (pilha; o GitHub retarget
sozinho a cada merge) · `#116` (este handoff) e `#121` (Onda D) são independentes e
podem entrar a qualquer momento.

**Gotcha novo para a próxima sessão:** o `gh` trocou de conta sozinho DUAS vezes no meio
do trabalho (§7.5 continua valendo — confira `gh auth status` antes de todo push). E o
data-dir de demo copiado de um mundo VIVO carrega o `world.lock` junto — apague o lock
DA CÓPIA antes do serve, e marque `setupCompleted: true` no `Config/fusion.json` da cópia
para o `/` não redirecionar ao `/setup`.
