# Revisão adversarial — o6b (T6.5, gatilho de UI para criar personagem)

Juiz, 2026-09-21. Worktree `scratchpad/wt-d` @ d848ce08. Sem edição de código.

## Veredito: APROVADA COM CONSERTOS

A decisão da T6.5 está certa pela spec: REQ-USR-025 (spec 05, emenda 2026-08-16) é "o único
endereço da criação de personagem", e REQ-CFG-051a / DEC-NPC-02 / REQ-NPC-055a proíbem um botão
novo. A evidência viva rodou por inteiro (servidor real, Playwright, 14 prints, world.db conferido,
9/9 checks ok). Nenhum bloqueante. Quatro achados confirmados, todos com conserto de texto ou issue.

## Confirmados

### C1 (importante): visibilidade do personagem alheio diverge entre os caminhos de saída, e a T6.5 trava um lado
Junta A1 (testes-contratos) e I2 (regra-pf2e).
- Verificado: `redaction.ts` `actorEscapingKnowledgeIsVisible` devolve `true` para qualquer
  `type: "character"` antes de olhar ownership. Chamei `redactActorDocsForViewer` do dist com
  ator `{ownership:{default:0,userA:3}}` e viewer `userB`: devolve o documento, sem hp e **com
  `system.derived`**. O snapshot (`sync-handlers.ts` ~l.405) corta abaixo de LIMITED antes. Resultado:
  broadcast, replay e eco entregam o que o snapshot esconde. Card aparece após um `doc:update` e some
  no reload. Isso fere REQ-NET-096 ("por nenhum dos quatro caminhos", "predicado único").
- Conflito de spec por trás: 39 (REQ-CTT-014/020, Q-CTT-03 "Na mesa mostra todos a todos") contra
  05 REQ-USR-025a (`default = none`) + 04 REQ-NET-024/096.
- A T6.5 não criou o defeito, mas o teste do outsider (`player-character-create.test.ts:704`) e o
  `tasks.md` vendem o snapshot como prova "da fronteira". Além disso, o próprio `tasks.md` da T6.5 diz
  que "TODO personagem de jogador aparece em Na mesa", e o teste do servidor prova o oposto.
- Dono: `xansde/fusion`, `packages/server/src/net/redaction.ts` + `sync-handlers.ts`. Também
  `docs/design/ficha-nivel3/tasks.md` (T6.5).
- Conserto: abrir uma issue para o conflito 05×39 e para a divergência entre os 4 caminhos (decidir
  um lado e alinhar o predicado). Na T6.5, anotar o teste do outsider com o número da issue e
  reescrever a frase do tasks.md para "o snapshot não entrega; os demais caminhos, ver issue".

### C2 (importante): `fusion user add` cria PLAYER sem personagem, contornando a invariante da REQ-USR-025
I1 (regra-pf2e).
- Verificado: `packages/server/src/cli/commands/users.ts:115` chama `userStore.create` direto. Sem
  `AuthService.createUser` não nasce Actor. O README (l.64) documenta o comando. O jogador criado
  assim cai em "Você ainda não tem personagem" e não tem saída no produto (REQ-CFG-051a,
  DEC-NPC-02, `doc:create` removido no C5/C6).
- O defeito já existia antes da o6b. Mas a conclusão da T6.5 ("REQ-USR-025 é o único endereço, a
  cadeia fecha") só vale se o outro caminho de criação de usuário respeitar a invariante.
- Dono: `xansde/fusion`, `packages/server/src/cli/commands/users.ts`.
- Conserto: `runUserAdd` delega a `AuthService.createUser` (mesma transação). Se ficar fora da onda,
  abrir uma issue antes da O7.

### C3 (importante): talento de classe com várias classes nos traits mostra aviso falso de "classe errada"
Defeito achado pela evidência viva, ainda sem issue aberta (só o texto está pronto no relatório).
- Verificado: o print `09-nivel3-aba-magias-mago.png` mostra "Familiar" em vermelho, com "É talento
  de classe Magus e você não tem níveis de Magus", num Mago. Causa em
  `external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/planVM.ts:2604`:
  `traits.find(tr => KNOWN_CLASS_TRAITS.has(tr))` pega a **primeira** classe dos traits e compara com
  `classSlug`. No PF2e, um talento com várias classes serve a qualquer uma delas.
- Impacto: o Mago nível 3 legal, o alvo da ficha-nivel3, fica com aviso vermelho permanente.
- Dono: `xansde/fusion-systems-2e`, `sheets/pf2e/.../planVM.ts` (`checkSlotRequirement`).
- Conserto: marcar erro só se houver trait de classe e nenhum deles for `classSlug`
  (`!traits.includes(classSlug)`), com teste dos dados reais do pack (Familiar, Cantrip Expansion).
  Abrir a issue no satélite.

### C4 (menor): a "prova automatizada da cadeia" para no botão
Junta M1 (regra-pf2e) e A3 (testes-contratos).
- Verificado: os testes da T6.5 em `ContactsPanel.test.ts` (l.362-401) só conferem que o
  `aria-label` existe. Nenhum teste clica, abre a `CharacterSheet` com ator sem `system`, ou
  referencia `planVisible` ou `NeedsClassHint` (grep sem ocorrência em `*.test.ts`). O Gate do
  `tasks.md` diz "prova automatizada da mesma cadeia".
- Mitigação: a evidência viva abriu a ficha em branco e a própria ficha do jogador (prints 04 e 12).
  O produto funciona hoje; o que falta é a trava contra regressão.
- Dono: `xansde/fusion`, `docs/design/ficha-nivel3/tasks.md` (T6.5/Gate).
- Conserto: reescrever o Gate para "até o botão de abrir a ficha; ficha/Plano provados ao vivo".
  Opcional: abrir uma issue para um teste da ficha com ator sem `system`.

## Refutados

- **A2** (asserção negativa do outsider passa no vazio): o teste irmão do dono usa o mesmo
  `actorDocsIn`, a mesma rota de snapshot e o mesmo papel (PLAYER). Mudar o caminho do payload ou o
  `catch` que zera a tabela também derruba o teste do dono. Nenhum cenário demonstrado deixa só o
  outsider vazio.
- **costura-seguranca M1** (rebaixado de GM ou personagem excluído fica sem saída): é uma decisão
  registrada. A REQ-USR-025d diz de propósito que troca de papel não cria personagem, e a Q7 da
  spec 05 já liga o caso à REQ-NPC-055a [V2]. A lacuna já está escrita na spec e não corta escopo
  da T6.5. O caso real sem saída é o do CLI (C2).

## Evidência viva
Rodou por inteiro: servidor real na porta 33020, data-dir fora da worktree, 2 sessões Playwright,
dois personagens nível 3 (Mago e Guerreiro) conferidos no world.db, jogador vendo e abrindo só o
próprio personagem, porta liberada. Nenhum check falhou. O único defeito levantado virou o C3.
