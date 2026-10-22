# Onda 6 — Evidência viva FINAL (níveis "vivo" e "olhado")

Esta lane encontrou o trabalho de evidência viva já produzido em uma execução anterior
(`ficha3-reports/o6/evidencia-viva.md`, `live-check-output.log`, 8 prints em `prints/`).
Nesta passada, cada peça foi RE-VERIFICADA de forma independente (não apenas confiada):

## Verificações feitas nesta passada

1. **Os 8 prints foram abertos e olhados um a um** (`Read` na imagem, não só listagem de
   arquivo). Cada um confere exatamente com a legenda descrita em `evidencia-viva.md`:
   - `01-gm-logado-hub.png` — MestreO6 logado, painel de Mapa/Cenas visível (Hub do GM).
   - `02-jogador-logado-hub.png` — JogadorO6 logado, painel de Chat visível, badge "Jogador".
   - `03-jogador-contatos-personagem-proprio.png` — aba Contatos do JogadorO6 mostra
     "Evidencia O6 - Personage..." em "Na mesa 1", tag "você" + "conectado".
   - `04-jogador-ficha-aberta.png` — JogadorO6 abre a própria ficha (builder completo:
     Ancestralidade/Linhagem/Antecedente/Classe, botão EDITAR ativo).
   - `05-mestre-contatos-ve-personagem-do-jogador.png` — MestreO6 vê "Na mesa 3", incluindo
     o personagem criado pelo jogador, junto com Novo Ator e Tobias.
   - `06-mestre-abre-ficha-do-jogador.png` — Mestre abre a mesma ficha do personagem do
     jogador, mesmo builder, acesso privilegiado.
   - `07-mestre-ficha-bio-editada-pelo-mestre.png` — aba "Bio" da ficha mostra resumo
     estruturado (Ancestralidade/Antecedente/Classe/Atributo-chave), sem campo de texto
     livre — confirma a nota já registrada: a UI atual não expõe
     `system.details.biography.value` como texto solto, mas o dado está no banco (item
     "Vivo" nº 4). Não é defeito desta onda.
   - `08-jogadorB-nao-ve-personagem-alheio.png` — JogadorO6B vê "Na mesa 0 — Você ainda
     não tem personagem nesta mesa": reforça na UI a recusa do servidor.
2. **Worktree `wt-o0` limpa**: `git status --short` mostra só o resíduo pré-existente
   `tools/importer-pf2e/` (untracked, de onda anterior, não tocado por esta lane) — nenhum
   código de produção alterado por esta passada.
3. **Branch já pushada e íntegra**: `git log --oneline -1` local (`10ebb270`) idêntico ao
   `origin/ficha3/o6` — nada pendente de push.
4. **Servidor encerrado**: `netstat -ano | grep ":33061"` (porta usada na sessão que gerou
   a evidência) retorna vazio — nenhum processo `LISTENING` órfão.
5. **Gate mecânico** (`gate.md`) confirmado verde: build/typecheck/lint/lint:boundaries/
   format:check/spec:report limpos; suite completa sem regressão nova (23 falhas
   pré-existentes idênticas ao baseline da Onda 1); branches core e satélite pushadas e
   pinadas corretamente.
6. **Lane funcional** (`T6.1-T6.4.md`) confirmada: criação de personagem próprio pelo
   jogador com ownership forçada ao criador, validação server-side de build
   (`validateCharacterBuild`), e teste explícito do cenário de concorrência Mestre×Jogador.

## Conteúdo integral da evidência "Vivo" (protocolo real + leitura direta do `world.db`)

Reproduzido de `evidencia-viva.md` (não alterado — a apuração é a mesma, só reverificada):

1. JogadorO6 cria o PRÓPRIO personagem via `doc:create` (protocolo socket.io real, mesmo
   evento que o client usa) com `ownership: {default: 3}` forjado no payload → `ok: true`.
   Lido direto do `world.db`: `ownership = {"default":0,"SY4qE4XZ2C3GPDtl":3}` — a
   ownership forjada foi ignorada; o servidor forçou `{creator: OWNER}`.
2. JogadorO6 edita o próprio personagem (`doc:update`, `xp: 5`) → `ok: true`.
3. JogadorO6B tenta editar o personagem do JogadorO6 (`doc:update`, `xp: 999`) → recusado
   pelo SERVIDOR: `ok: false`, `code: "PERMISSION_DENIED"`, `"No OWNER access to
   Actor/tpwJyMWRQGr5s4aW"`.
4. Edição concorrente: MestreO6 edita `system.details.biography.value` (privilegiado, sem
   `expectedVersion`) → versão 3→4. JogadorO6 tenta editar `xp` com `expectedVersion`
   defasada → recusado (`STALE_WRITE`). JogadorO6 recarrega (versão 4) e reenvia → `ok:
   true`, versão 5. Conferido no `world.db`: `xp: 42` **e**
   `biography.value: "Editado pelo Mestre (concorrencia O6)"` presentes juntos no mesmo
   documento — nenhuma edição perdida.

Saída bruta: `ficha3-reports/o6/live-check-output.log`. `characterId`:
`tpwJyMWRQGr5s4aW` (mundo `teste_xande`, cópia isolada em `data-o6`).

## Pendências para issue

Nenhuma pendência nova encontrada por esta lane de evidência. As únicas duas pendências
relacionadas à Onda 6 já estão registradas (ver `gate.md`, seção "Pendências para issue"):

1. `xansde/fusion#233` — ownership do eidolon (companheiro do Summoner) quando a Onda 3
   landar em `alfa/app`.
2. `xansde/fusion-systems-2e#109` — `validateCharacterBuild` não cobre contagem de perícias
   treinadas por classe/nível.

A lacuna de UI "sem botão criar personagem" (`DEC-CTT-01`) é decisão de produto já
registrada desde a Onda 0 (`gate-runbook.md`, seção 5) — não é defeito, não gera issue nova.

## Conclusão

Os três requisitos da Onda 6 (jogador cria e edita o próprio personagem pelo Hub; edição de
ator alheio recusada pelo servidor com teste + tentativa real; edição concorrente
Mestre×Jogador sem perda de dado) estão provados e RE-VERIFICADOS nos três níveis exigidos
por `execucao.md` §3:

- **Mecânico** — `gate.md`, verde, sem regressão.
- **Vivo** — protocolo real + `world.db` lido diretamente, reproduzido acima e conferido
  contra `live-check-output.log`.
- **Olhado** — 8 prints, ambos os papéis (Mestre e Jogador), cada um aberto e conferido
  nesta passada.

Nenhum defeito novo. Nenhum código de produção tocado por esta lane. Servidor encerrado,
branch já pushada, worktree limpa.
