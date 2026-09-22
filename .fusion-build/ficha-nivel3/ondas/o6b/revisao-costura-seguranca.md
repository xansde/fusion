# Revisão adversarial — Onda 6b (costura + CI + segurança + UI)

Diffs: core `origin/alfa/app...ficha3/o6b` (d848ce08, 3 arquivos: `tasks.md`, `ContactsPanel.test.ts`,
`player-character-create.test.ts`); satélite `origin/main...ficha3/o6b` = vazio (branch = `main` 5a93903).

## Veredito: PODE MERGEAR. Nenhum bloqueante nem importante. 1 menor.

## A decisão da lane (não construir botão novo) está certa?

Sim. Conferi nas specs e no código:
- `auth/service.ts:303-331`: criar usuário PLAYER/TRUSTED cria na mesma transação um Actor `character`
  em branco com o usuário como OWNER e `default: NONE` (REQ-USR-025/025a/025c).
- `specs/37-configuracoes.md:341` (REQ-CFG-051a) proíbe a seção Usuários de oferecer criar personagem
  como ação própria; `specs/42` REQ-NPC-055a deixa o segundo personagem em [V2].
- A decisão 2 do plano ("quem cria — o jogador; o Mestre pode se quiser") fica atendida: o documento
  nasce vazio e quem monta a ficha é o jogador, pelo builder (coluna Plano). O smoke C7 do fixer r1 da O6
  provou a cadeia ao vivo com dois papéis (`ficha3-reports/o6/prints-fix-r1/03..29`: criar usuário pela
  UI → login do jogador → Contatos → ficha → escolher classe → dádivas → nível 2).
- O mundo real `~/.fusion/worlds/teste_xande` (leitura só) tem 1 PLAYER com 1 character de sua posse:
  nenhum usuário legado está sem personagem hoje.

## Costura / CI / higiene
- Merge com o `origin/alfa/app` atual (c9be8544, PR #235 da o4): `git merge-tree` limpo, sem conflito.
- Pin: o6b não mexe no ponteiro (base 2386ef57 e o6b = 5a93903). No merge vale o 80740cc de alfa, e o
  5a93903 é ancestral dele. Sem regressão de pin.
- Lockfile, spec:report e format: nada muda (gate.md: 710/710, format:check exit 0).
- Higiene: só 3 arquivos de texto. Nada de data-dir, auth_secret, .env, node_modules, vendor, out/ ou
  binário. `tools/importer-pf2e/` segue untracked e fora do diff.
- Testes novos rodados isolados no HEAD d848ce08: server `player-character-create.test.ts` 17/17 e
  client `ContactsPanel.test.ts` 21/21. Os dois estão dentro das suítes que o CI já roda.
- Segurança: nenhuma linha de produto mudou. Nenhum predicado de redação novo: o teste passa pelo funil
  `net/redaction.ts` via socket real, e a asserção do outsider (sem acesso) prova o corte `default: NONE`.
  Os positivos (owner e GM) usam o mesmo extrator, então o negativo não é vácuo.
- UI: nenhuma tela nova, então a lente protótipo/PROCESSO-UI não se aplica. O gatilho existente (card
  "Na mesa" → abrir ficha) já tem prints ao vivo da O6.

## M1 — MENOR: jogador sem personagem não tem caminho nenhum para ganhar um
- Arquivos: `packages/server/src/auth/service.ts:305-331` (o personagem nasce só no createUser) e
  `specs/05-usuarios-e-permissoes.md:355-358` (REQ-USR-025d: mudar de papel não cria personagem).
  A pergunta aberta 7 (`:806-810`) reconhece a lacuna.
- Cenário: o GM cria um usuário como GAMEMASTER (co-mestre) e depois o rebaixa para PLAYER, ou o
  personagem do jogador é excluído. O jogador entra, a aba Contatos mostra "Você ainda não tem
  personagem nesta mesa", e não há gesto nenhum para sair disso:
  - a seção Usuários é proibida pela REQ-CFG-051a;
  - `createNpc` oferece só npc/hazard;
  - a exceção de `doc:create` do jogador foi removida na O6.
  A T6.5 registra "Pendências: nenhuma" e dá o gatilho como fechado.
- Não bloqueia: o spec põe isso em [V2]/Q7 e o mundo real não tem esse caso hoje. Mas pela regra
  "falha vira issue", falta uma issue que ligue a Q7 da spec 05 à REQ-NPC-055a, para não depender da
  memória de quem leu a spec.
