# Onda 4 — evidência viva (níveis "vivo" e "olhado", execucao.md §3)

Worktree `wt-c`, branch `ficha3/o4` (core em `09ffb8a9`/`3b8ceb6f`, satélite em `ficha3/o4`),
já com T4.1 (divindades) e T4.2 (rules do Animist) mergeados nela. Servidor real, mundo real
(cópia isolada de `teste_xande`), browser real via `playwright-cli`. Nenhum código de produção
foi alterado nesta lane — só dado de ator no `world.db` de teste (fora do `~/.fusion` real) e o
runbook (correção abaixo).

## Setup

- Data-dir: `<scratch>/data-o4` (cópia de `~/.fusion/worlds/teste_xande`, nunca o original).
- Porta: `33040` (livre, confirmado por `netstat` antes de subir).
- Servidor: `node packages/server/dist/cli/index.js serve --port 33040 --data-dir <data-o4>
  --world teste_xande --no-open --log-level info`, `CI=1`. Log em `server-o4.log`: boot
  saudável, `pf2e.deities-core` registrado com **473 documentos**.
- Setup wizard completado (data-dir novo): diretório/porta padrão, Admin Key, "Concluir
  configuração".
- Usuário GM criado via CLI (`user add ... --role GAMEMASTER`), login feito pelo browser.
- **Não existe fluxo de "criar personagem novo"** (lacuna de produto já registrada no
  runbook/memória do projeto). Reaproveitei os atores `character` já existentes no mundo
  copiado — `Tobias`, `Novo Ator` — e cloniei mais dois via escrita direta no `world.db`
  (`O4 Animist Test`, `O4 Necromancer Test`), depois **resetei os 4** (script ad-hoc, não
  commitado) removendo todo item `type` ∉ {ancestry, heritage, background} — os 4 atores do
  mundo original já vinham com classes de sessões de teste anteriores (Bardo, Bárbaro, até um
  Clérigo simultâneo no mesmo Tobias) — e ajustei `system.level.value` para 1 (Cleric, Champion,
  Necromancer) ou 3 (Animist). Servidor reiniciado depois do reset para recarregar do disco
  (o processo não relê o SQLite sozinho após escrita externa).

## Prova por personagem

### Cleric nv1 — Tobias — divindade Sarenrae

1. `Classe —` → dialog "Classe do nível 1" → busca não precisou, "Clérigo Cleric" já visível na
   lista das 29 → clique → preview (descrição real, clean-room) → Confirmar.
2. Grant automático: `Clérigo 1` (Nível de classe) ✓, e um novo slot **"Divindade"** aparece
   junto de Doutrina/divineFont/Talento de Ancestralidade/etc.
3. Clique em "Divindade" → dialog "Escolher Divindade" → busca "Sarenrae" → 1 resultado →
   preview com edicts/anathema/title/areas of concern reais (bate com o remaster: "The
   Dawnflower", "healing, honest redemption, the sun") → Confirmar.
4. Slot "Sarenrae — DivindadeDeity" aparece ✓ no Nível 1, com a nota "É talento de classe Deity
   e você não tem níveis de Deity" (mensagem de aviso do motor de nível, não um erro).
5. **Verificado no dado do ator (`world.db`, não só na UI)**: `actors` → Tobias →
   `items: [..., {name:"Cleric", type:"class"}, {name:"divine Spells",
   type:"spellcastingEntry"}, {name:"Sarenrae", type:"deity"}]`, `system.level.value: 1`.
   O item `deity` persistiu de verdade no documento do ator, não só em memória de UI.
6. A ficha já deriva `CD de Magia · Clérigo: 13` a partir da classe (a divindade em si não altera
   a CD — isso bate com T4.1: favored-weapon/sanctification ainda não materializam, só o item
   `deity` está embutido).

Prints: `01-cleric-deity-picker-search.png` (busca "Sarenrae", 1 resultado, confirma que o
picker filtra por nome pt/en), `02-cleric-deity-sarenrae-preview.png` (preview antes de
confirmar — prova que o dado da divindade real, não um placeholder, chega até a UI),
`03-cleric-deity-embedded-plan.png` (Sarenrae ✓ no Nível 1 da coluna Plano, ficha já com CD de
Magia derivada).

### Champion nv1 — Novo Ator — divindade Iomedae

1. Mesmo fluxo: `Classe —` → "Campeão Champion" → Confirmar → slot "Divindade" aparece (eixo
   igual ao Cleric, fonte compartilhada `deities-core`).
2. Busca "Iomedae" → 1 resultado → preview → Confirmar → "Iomedae — DivindadeDeity" ✓ no Nível 1.
3. **Verificado no `world.db`**: Novo Ator → `items` inclui `{name:"Champion", type:"class"}` e
   `{name:"Iomedae", type:"deity"}`, `system.level.value: 1`.
4. **Achado ao vivo, não previsto pelo relatório de T4.1**: T4.1 declarou que
   `Deific Weapon` e `Champion's Aura` passaram a materializar de verdade para todo Champion
   (via `CHOICE_WRAPPERS_WITH_FIXED_GRANTS`), com prova num teste ad-hoc descartado (não
   commitado). ~~**Não reproduzi isso no fluxo real**: nem no `world.db` do ator (só~~
   ~~`Elf/Ancient Elf/Barrister/Group Impression/Champion/Iomedae`, sem `Deific Weapon` nem~~
   ~~`Champion's Aura`), nem na UI (abas Principal/Ações/Inventário não mostram os dois grants,~~
   ~~nem como chip bloqueado). Ver seção "Defeito encontrado" abaixo — não consertei.~~
   **CORREÇÃO (fixer O4, rodada 1, 2026-09-21) — duas afirmações erradas nesta seção:**
   1. O teste NÃO é ad-hoc nem descartado: `grantMaterializer-realPacks.test.ts` está
      commitado em `07d396c` (satélite) e roda 11/11 verde nesta mesma worktree, inclusive o
      teste "Champion level 1: Deific Weapon and Champion's Aura materialize from the Deity
      (Champion) wrapper's fixed GrantItem rules (ficha-nivel3 O4 T4.1)".
   2. O defeito NÃO reproduz num build fresco: reproduzido ao vivo de novo (script Playwright
      ad-hoc, `champion-timing.spec.ts`, contra o MESMO commit desta worktree após
      `pnpm build`) — aplicando só a classe Champion (sem nenhuma outra ação), `Deific Weapon`
      e `Champion's Aura` aparecem no `world.db` em ~4.5s (`materializeClassGrants` é
      fire-and-forget, round-trip via socket para `class-features-core`). Amostragem 1/1/1/1s:
      t=1263ms 0 itens → t=2334ms 2 itens → t=3420ms 3 itens → **t=4479ms 5 itens, ambos
      presentes**. A causa mais provável do "não aparece" original é `packages/client/dist`
      não ter sido reconstruído (`pnpm build`) IMEDIATAMENTE antes desta lane, mesmo com
      T4.1/T4.2 já mergeados no branch — o bundle do client é um artefato separado do checkout
      git. Ver seção "Defeito encontrado" abaixo, também corrigida.

Prints: `04-champion-deity-picker-search.png`, `05-champion-deity-iomedae-preview.png`,
`06-champion-deity-embedded-plan.png` (mostra o Plano do Champion nv1 com Iomedae ✓ — dá para
conferir visualmente que não há chip "Deific Weapon"/"Champion's Aura" na lista de Nível 1,
nem bloqueado nem concedido).

### Animist nv3 — O4 Animist Test — 2 sintonias de aparição + progressão de classe

1. `Classe —` → "Animist" → Confirmar. Nível 1 abre **dois** slots "Sintonia de Aparição"
   (eixo `animist-apparition`).
2. Primeiro picker: 14 opções listadas (confirma ao vivo o achado de T4.2 — 14 apparitions no
   pack, não as 13 do `optionCount` da curadoria, incluindo a `uncommon` "Lamentation of
   Sinister Deals"). Escolhido "Custodian of Groves and Gardens" → Confirmar.
3. Segundo picker: escolhido "Crafter in the Vault" → Confirmar. Ambos aparecem ✓ no Nível 1.
4. Como o ator já nasceu no nível 3 (reset direto no banco, não há fluxo de "subir de nível"
   repetido 3x pela UI), os blocos Nível 2 e Nível 3 apareceram como slots pendentes — cliquei
   em "Nível de classe" de cada um: abre de novo o dialog "Classe do nível N" (mesmo picker de
   29 classes, não um atalho de "confirmar próximo nível" — comportamento de UI a registrar,
   não necessariamente errado, mas não documentado no runbook), selecionei "Animist" de novo em
   cada e confirmei. "Animist 2" e "Animist 3" ficaram ✓.
5. Nível 3 já mostrava, bloqueado, "Especialização em Fortitude" (Fortitude Expertise) — feature
   real de nível 3 do Animist, chegando via `proficiencyUpgrades` (não como item, consistente
   com o que T4.2 documentou: a proficiência real não lê `rules` do item de classe).
6. **Verificado no `world.db`**: `system.level.value: 3`; `items` inclui `Animist` (class),
   `divine Spells` (spellcastingEntry), `Custodian of Groves and Gardens` (classFeature),
   `Crafter in the Vault` (classFeature) — as duas apparitions persistidas como documentos
   próprios do ator, com `type: "classFeature"`.
7. Ficha deriva `CD de Magia · Animist: 15` e `Perc. +5`/saves subindo corretamente com o nível.

Prints: `07-animist-apparition1-preview.png` (preview de "Custodian of Groves and Gardens" —
prova que o pack de 473+ class-features do Animist tem descrição real, não placeholder vazio),
`08-animist-nv3-plan-granted.png` (rolagem da coluna Plano mostrando Nível 2 "Animist 2" ✓ e
Nível 3 "Animist 3" ✓ + "Talento Geral"/"Aumento de Perícias" pendentes — as duas classes-nível
concedidas de verdade, não só listadas).

### Necromancer nv1 — O4 Necromancer Test — Fatal Method

1. `Classe —` → "Necromancer" → Confirmar. Nível 1 abre o slot "Método Fatal" (Fatal Method) e
   "Fascínio Sinistro" (Grim Fascination, 2º eixo, já cabeado desde a Onda 1 por T1.6).
2. Clique em "Método Fatal" → dialog com **2 opções**: "Puppeteer" e "Reaper" — confirma ao vivo
   o que T4.3 verificou só por grep/leitura de código (não tinha print nenhum, T4.3 foi
   verificação pura). Selecionado "Reaper" → preview → Confirmar.
3. "Reaper — Método FatalFatal Method" ✓ aparece no Nível 1.
4. **Verificado no `world.db`**: `items` inclui `Necromancer` (class), `occult Spells`
   (spellcastingEntry), `Reaper` (classFeature). `system.level.value: 1`.
5. Ficha deriva `CD de Magia · Necromancer: 14`.

Prints: `09-necromancer-fatal-method-options.png` (os 2 documentos-opção reais, Puppeteer e
Reaper, num dialog de escolha — não uma lista vazia), `10-necromancer-fatal-method-embedded-plan.png`
(Reaper ✓ no Nível 1 do Necromancer, ficha com CD de Magia derivada).

## Defeito encontrado — CORRIGIDO (fixer O4, rodada 1): não é defeito, é timing + build velho

**Título original**: Champion nv1 pela UI real não recebe `Deific Weapon`/`Champion's Aura`,
apesar de T4.1 (Onda 4) ter reportado o fix como concluído e coberto por teste.

**Reprodução do fixer (2026-09-21)**: mesma worktree, mesmos commits (`09ffb8a9`/`3b8ceb6f` +
o fix do C1 desta rodada), `pnpm build` rodado imediatamente antes. Dois roteiros Playwright
ad-hoc (fora do repo, `<scratch>/e2e-o4/roteiros/`, reusando `lib/captura.ts` da skill
`tutorial-e2e` via `FUSION_E2E_REPO_ROOT`):

1. `champion-deity.spec.ts` — mesmo fluxo desta seção (classe → divindade) até o fim: o
   `world.db` do "Novo Ator" acabou com `Champion, Focus Spells, Deity (Champion), Deific
   Weapon, Champion's Aura, Devotion Spells, Shield Block (x2), Iomedae` — os dois grants
   ESTÃO lá.
2. `champion-timing.spec.ts` — isola a hipótese de timing: aplica SÓ a classe (nenhuma outra
   ação) e lê o `world.db` a cada 1s. `materializeClassGrants` é fire-and-forget
   (`void materializeClassGrants(doc2)` em `PlanColumn.svelte:847`) — o round-trip por socket
   até `class-features-core` (`resolvePackIndex`/`resolveGrantDoc`) leva tempo real:
   t=1263ms (0 itens) → t=2334ms (2) → t=3420ms (3) → **t=4479ms (5, Deific Weapon E
   Champion's Aura já presentes)**.

**Conclusão**: o código está correto — o mesmo caminho de produção (`materializeClassGrants` →
`runClassGrantRefs` → `resolveGranterByName` → `materializeGrants`) que o teste committed
(`grantMaterializer-realPacks.test.ts`) exercita via disco, o fluxo real de UI também exercita
via socket, e os dois convergem para o mesmo resultado. A explicação mais provável do "não
aparece" original é `packages/client/dist` estar desatualizado nesta lane (T4.1/T4.2 mergeados
no branch git não implica bundle do client reconstruído) — a seção "Setup" acima não lista
`pnpm build` entre os passos. **Sem issue de código a abrir** — a pendência real é de processo
(ver "Pendências para issue" abaixo, revisado).

## Achado colateral confirmado ao vivo (já registrado por T4.2, agora visto na UI real)

O picker de Sintonia de Aparição do Animist lista **14** opções (não 13), confirmando ao vivo o
achado já reportado por T4.2 (`curation/classes/animist.json`, `optionCount: 13` desatualizado).
Nenhuma ação nova — a pendência já foi registrada como corpo de issue pronto no relatório de
T4.2.

## Correção ao runbook

Nenhuma correção necessária — o runbook (`docs/design/ficha-nivel3/gate-runbook.md`) descreveu
corretamente o boot, o setup wizard, o login e o encerramento. Um ponto que vale registrar aqui
(não uma correção do arquivo, é operacional desta lane): depois de escrever direto no `world.db`
enquanto o servidor está de pé, é preciso **reiniciar o processo** — ele não relê o SQLite
sozinho após uma escrita externa, e sem restart o browser continua mostrando o estado antigo em
memória.

## Encerramento

Servidor (PID 2572, porta 33040) encerrado via `taskkill //PID 2572 //F`; `netstat` confirmou
só `TIME_WAIT` residual, sem `LISTENING`. Nenhum arquivo de produção alterado; nenhum commit
feito nesta lane (só leitura + dado de teste isolado em `<scratch>/data-o4`, fora do
`~/.fusion` real e fora da worktree). Prints em
`<scratch>/ficha3-reports/o4/prints/01..10*.png`, todos olhados (Read) e descritos acima.

## Pendências para issue

~~1. `xansde/fusion`/`xansde/fusion-systems-2e` — "Champion nv1 pela UI real não recebe Deific~~
~~   Weapon/Champion's Aura"~~ — **RETIRADA (fixer O4, rodada 1)**: não reproduz num build
fresco (ver seção "Defeito encontrado" acima, corrigida). Nenhuma issue de código a abrir.

Lição de processo (não é issue de código — para o runbook/vault do projeto): uma lane de
evidência viva que reaproveita uma worktree já mergeada precisa incluir `pnpm build` explícito
no setup, mesmo quando "já com T4.1/T4.2 mergeados nela" — o bundle do client
(`packages/client/dist`) não se reconstrói sozinho a partir de um merge no git.

Nenhuma outra pendência nova — o achado do `optionCount` 13×14 do Animist já tem corpo de issue
pronto no relatório de T4.2 (`ficha3-reports/o4/T4.2-animist.md`), só confirmado de novo aqui ao
vivo.

## Resumo (contrato de retorno)

Status original: **PARCIAL** (mecânico + vivo + olhado das 4 classes provados; 1 "defeito"
registrado, não corrigido). **CORRIGIDO pelo fixer O4/rodada 1 (2026-09-21): o "defeito" não
reproduz num build fresco** — era timing (`materializeClassGrants` fire-and-forget, converge em
~4.5s) combinado com um `packages/client/dist` provavelmente desatualizado nesta lane; ver
"Defeito encontrado" e "Pendências para issue" acima, ambas corrigidas, e o teste chamado de
"ad-hoc descartado" era na verdade commitado e verde (11/11). Cleric/Champion nv1 com divindade
escolhida (Sarenrae/Iomedae) confirmados no `world.db`, não só na UI; Animist nv3 com as 2
apparitions + progressão de classe (nv1/2/3) concedidas de verdade; Necromancer nv1 com Fatal
Method (Reaper) concedido. 10 prints em `ficha3-reports/o4/prints/`, todos olhados. Nenhum
código de produção tocado nesta lane original; servidor encerrado (PID 2572 confirmado morto via
`netstat`).
