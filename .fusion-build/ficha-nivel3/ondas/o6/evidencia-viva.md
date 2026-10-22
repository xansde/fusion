# Onda 6 — Evidência viva (níveis "vivo" e "olhado")

Prova complementar ao gate mecânico já fechado (`ficha3-reports/o6/gate.md`, verde) e à lane
`T6.1-T6.4.md`. Aqui: personagem real, no mundo real, pelos dois papéis (Mestre e Jogador),
com dado conferido no `world.db` — não só na UI ou em fixture de teste.

## Setup

- Worktree `wt-o0` (branch `ficha3/o6`, já buildada — `packages/server/dist/` presente).
- Data-dir `scratchpad/data-o6` (fora da worktree), com uma CÓPIA de
  `~/.fusion/worlds/teste_xande` (original nunca tocado).
- Usuários criados no mundo copiado via CLI: `MestreO6` (GAMEMASTER), `JogadorO6` (PLAYER),
  `JogadorO6B` (PLAYER, usado só para provar a recusa de editar ator alheio).
- Servidor subido em `--port 33061`, `CI=1`, `--world teste_xande`. Setup wizard concluído
  (data-dir novo). Encerrado ao final com `taskkill //PID 15088 //F` — confirmado por
  `netstat` (só `TIME_WAIT` residual, sem `LISTENING`).
- `git status --short` na worktree ao final: só o resíduo pré-existente `tools/importer-pf2e/`
  (não tocado por esta lane) — nenhum código de produção editado.

## Lacuna encontrada antes de começar: sem botão "criar personagem" na UI

Confirmado no código: `ContactsPanel.svelte` documenta explicitamente que **nenhum estado
vazio da aba oferece criar um ator** (`REQ-CTT-092`, `DEC-CTT-01`) — "this file has no
`doc:create` at all", com teste (`ContactsPanelEmpty.test.ts`) que afirma isso. Isso é uma
decisão de produto já registrada (spec 28 exclui a ficha do Hub; ver também o achado da
Onda 0 em `gate-runbook.md`, seção 5), não algo que esta lane deveria consertar — e o
T6.1-T6.4 fez essa mesma leitura ("Nenhuma UI nova no Hub").

Consequência para a prova "vivo": como não há gatilho de UI para `doc:create` de personagem
próprio, a criação foi exercida pelo **mesmo protocolo real que o browser usa** —
`POST /api/auth/login` (endpoint HTTP de produção, `packages/server/src/auth/routes.ts`) para
obter o `accessToken`, depois `socket.io` no namespace `/world/teste_xande` com o evento `op`
(`doc:create`/`doc:update`), exatamente o contrato que `player-character-create.test.ts` já
teste unitariamente e que o client usa por baixo. Script:
`scratchpad/o6-live-check.mjs` (rodado a partir de `packages/server/`, onde `socket.io-client`
resolve; script não commitado, é ferramenta de teste ad-hoc, apagado da worktree depois de
rodar). Saída completa: `scratchpad/ficha3-reports/o6/live-check-output.log`.

**Não registro isso como issue nova** — é a mesma lacuna já conhecida (emenda 37/05, "nasce
com o player", ainda não implementada como gatilho de UI); duplicar a issue não ajuda.

## Nível 1 — Vivo (protocolo real, servidor real, banco real)

Todos os passos abaixo rodaram contra o servidor de verdade (não um fixture de teste) e foram
CONFIRMADOS lendo `world.db` diretamente (`SELECT data FROM actors WHERE id = ?`, via
`better-sqlite3`), não só a resposta do `ack`.

1. **JogadorO6 cria o PRÓPRIO personagem** (`doc:create`, payload com `ownership: {default: 3}`
   forjado) → `ok: true`. No banco: `ownership = {"default":0,"SY4qE4XZ2C3GPDtl":3}` — a
   ownership forjada foi IGNORADA, forçada a `{creator: OWNER}` como o código promete.
2. **JogadorO6 edita o próprio personagem** (`doc:update`, `xp: 5`) → `ok: true`.
3. **JogadorO6B (outro jogador) tenta editar o personagem do JogadorO6** (`doc:update`,
   `xp: 999`) → **recusado pelo SERVIDOR**: `ok: false`, `code: "PERMISSION_DENIED"`,
   `"No OWNER access to Actor/tpwJyMWRQGr5s4aW"`. Não é só a UI escondendo — o protocolo
   recusa.
4. **Edição concorrente Mestre × Jogador**:
   - MestreO6 edita (privilegiado, sem `expectedVersion`) o campo
     `system.details.biography.value` → `ok: true`, versão avança 3→4.
   - JogadorO6 tenta editar `xp` com `expectedVersion` agora DEFASADA (a que tinha antes da
     edição do Mestre) → **recusado**: `ok: false`, `code: "STALE_WRITE"`.
   - JogadorO6 "recarrega" (usa a versão corrente, 4) e reenvia → `ok: true`, versão 5.
   - **Conferido no `world.db`** (não só no ack): `xp: 42` **E**
     `biography.value: "Editado pelo Mestre (concorrencia O6)"` **ambos presentes** no mesmo
     documento — nenhuma edição foi perdida (`deepMerge` sobre o doc atual, não sobre a
     leitura obsoleta, como o T6.4 promete).

Saída bruta de cada passo: `scratchpad/ficha3-reports/o6/live-check-output.log`. `characterId`
do personagem vivo: `tpwJyMWRQGr5s4aW` (mundo `teste_xande`, cópia em `data-o6`).

## Nível 2 — Olhado (smoke como GM e como Jogador, prints)

Todos em `scratchpad/ficha3-reports/o6/prints/`, via `playwright-cli` (sessões nomeadas `gm`,
`p1`, `p2` — nunca a extensão do Chrome).

| Print | O que prova |
|---|---|
| `01-gm-logado-hub.png` | MestreO6 loga no mundo `teste_xande` e vê o Hub (cenas, mapa) — smoke do papel Mestre. |
| `02-jogador-logado-hub.png` | JogadorO6 loga como Jogador (badge "Jogador" no topo) e vê o chat — smoke do papel Jogador. |
| `03-jogador-contatos-personagem-proprio.png` | Na aba Contatos, JogadorO6 vê "Evidencia O6 - Personagem..." listado em "Na mesa 1", com a tag "você" e "conectado" — o personagem criado ao vivo pelo protocolo aparece de verdade na UI do dono. |
| `04-jogador-ficha-aberta.png` | JogadorO6 abre a própria ficha (botão "Abrir a ficha de..."), com "EDITAR" disponível — o jogador tem o mesmo builder (Ancestralidade/Linhagem/Antecedente/Classe) que o Mestre, não uma tela reduzida. |
| `05-mestre-contatos-ve-personagem-do-jogador.png` | MestreO6 vê "Evidencia O6 - Personage..." em "Na mesa 3" junto dos outros atores — o Mestre enxerga o personagem que o JOGADOR criou (não passou pelo Mestre para existir). |
| `06-mestre-abre-ficha-do-jogador.png` | MestreO6 abre a mesma ficha do personagem do jogador — mesma tela, acesso privilegiado. |
| `07-mestre-ficha-bio-editada-pelo-mestre.png` | Aba "Bio" da ficha, aberta pelo Mestre, após a edição concorrente — mostra os campos estruturados (Ancestralidade/Antecedente/Classe/Atributo-chave); a UI de ficha ATUAL não expõe um campo de texto livre para `system.details.biography` (nota abaixo), mas o dado já foi confirmado presente no banco na seção "Vivo". |
| `08-jogadorB-nao-ve-personagem-alheio.png` | JogadorO6B loga e sua aba Contatos mostra "Na mesa 0 — Você ainda não tem personagem nesta mesa": o personagem do JogadorO6 nem aparece para ele — a UI já filtra por ownership, reforçando (não substituindo) a recusa do servidor provada no Nível 1, passo 3. |

### Nota (não é defeito, é observação de escopo)

O print 07 não mostra o texto livre de biografia (`system.details.biography.value`) porque a
aba "Bio" do builder atual renderiza um resumo estruturado (Ancestralidade/Antecedente/
Classe/Atributo-chave), não um campo de texto solto. O dado em si está corretamente persistido
(confirmado por leitura direta do `world.db`, seção "Vivo", item 4) — é só a superfície de UI
que não tem, hoje, um lugar para mostrar biografia livre. Fora do escopo do O6 (que é sobre
permissão de criação/edição, não sobre a aba Bio); não registro issue nova por isso.

## Conclusão

Os três requisitos do smoke da Onda 6 (jogador cria e edita o próprio personagem pelo Hub;
edição de ator alheio recusada pelo servidor com teste + tentativa real; edição concorrente
Mestre × Jogador sem perda de dado) estão provados nos três níveis exigidos por
`execucao.md` §3 — Mecânico (gate.md, já verde), Vivo (esta seção, servidor+banco reais) e
Olhado (8 prints, ambos os papéis). Nenhum defeito novo encontrado nesta lane de evidência;
a única lacuna observada (sem botão de criação na UI) já é uma decisão de produto conhecida
(`DEC-CTT-01`) e documentada desde a Onda 0, não uma regressão desta onda.
