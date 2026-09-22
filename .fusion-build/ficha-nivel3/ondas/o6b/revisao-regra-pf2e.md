# Revisão adversarial — O6b (T6.5, gatilho de UI para criar personagem)

Lente: regra PF2e + caminho de produção (pack → mundo → ator → UI).
Escopo examinado: core `git diff origin/alfa/app...ficha3/o6b` (commit `d848ce08`: 2 arquivos de
teste + `tasks.md`); satélite `ficha3/o6b` = `main` (`5a93903`), diff vazio.
Somente leitura. Os dois arquivos de teste tocados, rodados isolados na wt-d: server 17/17, client 21/21.

## Veredito

A decisão central da lane está **certa pela spec**: não construir botão "Criar personagem"
(REQ-CFG-051a, REQ-NPC-055a, DEC-NPC-02). O caminho de produção pela UI (GM cria usuário PLAYER em
Configurações → Usuários → REQ-USR-025 cria o ator em branco → Contatos → ficha → Plano) existe e
foi provado ao vivo no C7 do fixer r1 da O6. Nada de regra PF2e muda nesta onda: não há código de
produto. **Mas a afirmação "não existe lacuna" é falsa para dois caminhos de produção**, e um dos
testes novos trava um comportamento que contradiz a spec 39.

Não há bloqueante. Há 2 importantes e 1 menor.

## Achados

### I1 — importante — `fusion user add` (CLI documentada) cria PLAYER sem personagem, e não há saída na UI

- Arquivo: `packages/server/src/cli/commands/users.ts:115` (`userStore.create(...)` direto, sem
  passar por `AuthService.createUser`/REQ-USR-025); documentado em `README.md:63`.
- Cenário: o GM segue o README → `fusion user add teste_xande Ana --role PLAYER` → Ana loga →
  Contatos mostra "Na mesa 0 — Você ainda não tem personagem" (reproduzido ao vivo na O6:
  `ficha3-reports/o6/evidencia-viva.md:84`, JogadorO6B criado via CLI). Nenhum gesto no produto
  resolve: REQ-CFG-051a proíbe a seção Usuários de criar personagem ("nem para quem já tem um"),
  a aba NPCs não cria `character` (DEC-NPC-02), o `doc:create` do jogador foi removido no C5/C6,
  e não existe editor de ownership para dar a Ana um ator `character` já existente (ex.: o "Novo
  Ator" sem dono do `teste_xande`). Resultado: Ana nunca chega ao builder — o objetivo da fatia
  ("o jogador monta o personagem antes da sessão", `plano.md:9`) falha para ela.
- Agravante de processo: o fixer r1 da O6 viu isso (`fix-r1.md:82`) e optou por não abrir issue;
  esta lane herdou o mesmo ponto cego e concluiu "Pendências para issue: nenhuma". Pela regra
  "falha vira issue registrada", no mínimo tem que virar issue agora.
- Conserto sugerido (menor corte): `runUserAdd` delegar a `AuthService.createUser` (mesma transação
  do REQ-USR-025c) — uma chamada, sem UI nova, sem contrariar spec. Se não entrar nesta onda: issue.
- Variante do mesmo buraco (sem ação agora, só constar): usuário criado antes da Fase 9 da gaveta
  (sem REQ-USR-025) e usuário promovido de GAMEMASTER→PLAYER (REQ-USR-025d / pergunta aberta 7 da
  spec 05) ficam no mesmo beco. No `teste_xande` atual o Tobias tem ator — não afeta hoje.

### I2 — importante — o teste novo do servidor trava "jogador não vê o personagem dos outros", o oposto da spec 39

- Arquivo: `packages/server/src/__tests__/player-character-create.test.ts` (teste "an outsider's
  own join snapshot does NOT carry someone else's character"; `outsider` é `Role.PLAYER`,
  linha ~112) e o comentário de cabeçalho do bloco T6.5, que chama isso de "the redaction boundary
  that makes 'na mesa' safe".
- Spec: `specs/39-contatos.md:56` — **Na mesa** = "personagens dos jogadores — os seus primeiro, os
  demais em seguida"; REQ-CTT-014 (ordem "próprio primeiro" só faz sentido com os dos outros
  presentes); Q-CTT-03 registra o estado pretendido: "Hoje a seção Na mesa mostra todos a todos".
  A REQ-USR-025a (`ownership.default = none`) colide com isso — conflito entre specs 05 e 39 que
  existia antes, mas que agora **vira asserção de teste**, então qualquer conserto futuro para
  cumprir a 39 vai quebrar este teste como se fosse regressão.
- Cenário de produção: mesa com Ana e Bruno, ambos criados pela UI. Ana abre Contatos → "Na mesa"
  mostra só a própria ficha; Bruno não aparece (o servidor nem entrega o ator). Na O6 isso já foi
  fotografado (`evidencia-viva.md:84`, "Na mesa 0" para o segundo jogador).
- Incoerência interna da própria entrega: o teste de client novo (`ContactsPanel.test.ts`, bloco
  T6.5) monta o snapshot do jogador com `TOBIAS_PC` (personagem de OUTRO jogador) presente — ou seja,
  o teste de client assume que o jogador recebe os personagens alheios, e o de servidor afirma que
  nunca recebe. Os dois não descrevem o mesmo produto.
- Conserto sugerido: retirar (ou inverter para `it.todo` com referência à issue) a asserção do
  "outsider" e abrir issue do conflito 05×39 (decisão de produto: party visível a todos, com a
  redação cortando só o que a spec 39 manda — ex. PV, REQ-CTT-021). Não é decisão para a lane fixar
  por teste.

### M1 — menor — a "prova automatizada da mesma cadeia" para no botão; a perna que cria a ficha não tem teste

- Arquivo: `docs/design/ficha-nivel3/tasks.md` (linha T6.5 e o Gate: "T6.5 acrescenta a prova
  automatizada da mesma cadeia"); testes novos param em `aria-label="Abrir a ficha de ..."`.
- Cenário: uma regressão que faça `CharacterSheet`/`PlanColumn` quebrar com ator sem `system`
  (exatamente a forma do REQ-USR-025b — ex.: um VM que leia `actor.system.details.level.value` sem
  guarda) deixa os 6 testes novos verdes e o jogador novo abre uma ficha quebrada em vez do
  "Escolha uma classe" (`FUSION.Sheet.Plan.NeedsClassHint`). Nenhum teste no core nem no satélite
  referencia `NeedsClassHint` nem monta a ficha de um ator sem `system`. A única prova dessa perna
  é o smoke manual C7.
- Conserto: issue (ou um teste de componente da ficha PF2e no satélite com o ator
  `{name, type:"character", ownership, flags}` e asserção do hint + picker de classe).

## O que NÃO é achado (verificado)

- Não construir botão/gatilho novo: correto por REQ-CFG-051a, REQ-NPC-055a, DEC-NPC-02.
- Pin do satélite = `main` do satélite (`5a93903`), sem diff — esperado.
- `flags.fusion.playerId` não é lido por ninguém no client/servidor, então ator legado sem essa flag
  (Tobias no `teste_xande`) aparece e é marcado "você" pelo ownership — sem problema de migração.
- Regra PF2e nos níveis 1-3: a onda não toca código de regra nem pack; nada a julgar aqui além do que
  a O6 já cobriu.
