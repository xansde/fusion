# Gate da Onda 0 — runbook operacional (verificado ao vivo em 2026-09-21)

Este documento existia como lacuna (tasks.md, nota da Onda 0: "o caminho operacional do gate
não está documentado"). O passo a passo abaixo foi executado de ponta a ponta nesta sessão —
servidor real, mundo real, browser real — e cada comando foi confirmado antes de entrar aqui.

## 1. Onde os dados das classes moram e como chegam ao mundo

**Lido em runtime, nunca copiado para dentro do mundo.** `CompendiumService`
(`packages/server/src/compendium/service.ts`) descobre os packs em
`systems/<systemId>/packs/<slug>/` (pack.json + documents.json) a cada boot do servidor.
O `world.db` de um mundo **não contém** cópia dos packs — só referências (`Compendium.<uuid>`)
e os documentos que o Mestre/jogador importou para dentro de um ator.

Consequência prática: **não é preciso criar um mundo novo** para testar dado de classe
atualizado. Basta que o `--data-dir` aponte para um `systems/pf2e/packs/` já buildado (pelo
`pnpm build` do submodule `external/fusion-systems-2e`) — um mundo antigo (`teste_xande`)
funciona, porque ele lê os packs do sistema em disco, não de si mesmo.

## 2. Subir o servidor num mundo de teste, fora da worktree e do `~/.fusion` real

```bash
# 1. copiar o mundo de teste real para o scratchpad (NUNCA alterar o ~/.fusion original)
DATADIR="<scratchpad>/data-o0"
mkdir -p "$DATADIR/worlds"
cp -r "$USERPROFILE/.fusion/worlds/teste_xande" "$DATADIR/worlds/teste_xande"
rm -f "$DATADIR/worlds/teste_xande/world.lock"   # stale lock do dono original

# 2. worktree já buildada (dist/ presente) — usar o CLI direto, sem pnpm
cd <worktree>
node packages/server/dist/cli/index.js user add teste_xande <nome> \
  --role GAMEMASTER --password "<senha>" --data-dir "$DATADIR"
node packages/server/dist/cli/index.js user add teste_xande <nome-jogador> \
  --role PLAYER --password "<senha>" --data-dir "$DATADIR"

# 3. escolher porta livre entre 33001-33099 (netstat -ano | grep LISTENING | grep ":330")
CI=1 node packages/server/dist/cli/index.js serve --port 33005 --data-dir "$DATADIR" \
  --world teste_xande --no-open --log-level info
```

`CI=1` evita o auto-open de browser do M6. `--world teste_xande` já abre o mundo no boot
(sem isso, o boot fica esperando escolha manual).

### Assinatura de boot saudável (nos logs)

```
"msg":"World opened"
"msg":"Auth routes registered"
"msg":"Server listening at http://127.0.0.1:<porta>"
"msg":"Fusion server ready for connections at http://0.0.0.0:<porta>"
```

## 3. Setup wizard — obrigatório num data-dir novo, mesmo com `--world`

Um `--data-dir` recém-criado **não tem** `Config/fusion.json` com `setupCompleted: true` — o
`--world` no `serve` não pula esse wizard, ele só decide qual mundo abrir DEPOIS do setup.
Ao abrir `http://localhost:<porta>/` pela primeira vez, o navegador cai em `/setup`:

1. **Diretório de dados** — já vem preenchido com o `--data-dir` passado; "Próximo".
2. **Porta do servidor** — já vem com a porta passada; "Próximo".
3. **Admin Key** — senha administrativa do servidor (distinta do login de jogador/Mestre);
   preencher + confirmar; "Próximo".
4. **Conectividade** — tela de revisão com QR codes; "Concluir configuração".
5. Cai na tela "Convide jogadores"; navegar de novo para `/` (ou clicar "Ir para o Fusion").

Depois disso, `Config/fusion.json` existe no `--data-dir` e novas sessões nesse mesmo
data-dir **não** passam pelo wizard de novo.

## 4. Login como Mestre e como jogador

A tela raiz (`/`) lista os usuários do mundo (os criados por `user add` + os que já existiam
no mundo copiado) num `listbox`. Clicar no usuário, digitar a senha no campo que aparece,
clicar "Entrar no World". Basta repetir em outra aba/sessão de browser para logar como um
segundo papel (o cookie de sessão é por contexto de browser — usar `-s=<nome>` diferente no
`playwright-cli`, ou uma aba nova dentro do MESMO contexto reusa a sessão já autenticada).

## 5. Onde fica o personagem — lacuna de produto encontrada

**Não existe, hoje, um botão "criar personagem novo" na UI do Mestre.** A aba "Contatos"
lista os atores tipo `character` já existentes no mundo (com botão "Abrir a ficha"); a aba
"NPCs" só cria atores tipo `npc`/`hazard` ("Novo não-jogável"). O código documenta isso
explicitamente: `packages/client/src/lib/npcs/createNpc.ts`, cabeçalho — _"`character` é
nascido com o jogador (DEC-NPC-02)"_ — ou seja, o fluxo de nascimento de personagem-jogador
é uma decisão de produto **ainda não implementada** como entry point de UI. Isso bate com a
memória do projeto (`project_gaveta_lateral_specs.md`: "personagem nasce com o player, emenda
37/05, não aplicada ainda").

**Consequência para o gate:** não dá para simplesmente "criar um Monk" do zero pela UI. O
caminho usado nesta sessão foi reaproveitar atores `character` já existentes no mundo copiado
(`Tobias`, `Novo Ator`) e um terceiro clonado por escrita direta no `world.db` (ver
`evidencia-viva.md`), todos resetados para nível 1 sem classe antes do teste. **Isso é um
workaround de teste, não o fluxo real do produto** — o buraco em si (falta de "criar
personagem") deveria virar issue própria (ver `evidencia-viva.md`, seção Pendências).

## 6. Fluxo de build de personagem (uma vez logado como Mestre, ator aberto)

1. Abrir a ficha do ator (botão "Abrir a ficha de \<nome\>" na lista de Contatos).
2. A coluna "Plano" (lado esquerdo da janela da ficha) mostra Ancestralidade → Linhagem →
   Antecedente → Classe → blocos por nível.
3. Clicar em "Classe —" (ou "Classe \<Nome atual\>" para trocar) abre um diálogo com as 29
   classes listadas e um campo de busca; clicar na classe desejada, depois "Confirmar".
4. Cada bloco "NÍVEL N" lista os slots daquele nível (Nível de classe, Talento de Ancestralidade,
   Treinamento de Perícias, etc.) e as features esperadas daquele nível (chips com nome
   pt-BR + nome em inglês).
5. "Subir de nível → N+1" no rodapé da coluna avança o personagem.

## 7. Encerrar o servidor sem deixar processo órfão

```bash
netstat -ano | grep ":<porta>"     # pega o PID que está LISTENING
taskkill //PID <pid> //F           # Git Bash no Windows
```

Confirmar depois com `netstat -ano | grep ":<porta>"` (saída vazia ou só `TIME_WAIT`).
