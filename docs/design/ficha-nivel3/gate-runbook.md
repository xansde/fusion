# Gate da Onda 0 — runbook operacional (verificado ao vivo em 2026-09-21; seção 5 corrigida na Onda 6b)

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

## 5. Onde fica o personagem — gatilho real é criar o usuário (correção de 2026-09-21, T6.5)

**Superado pela investigação da T6.5 (Onda 6b).** A seção original desta nota (Onda 0) dizia
"não existe botão criar personagem novo" e descrevia um workaround de reaproveitar atores já
existentes. Isso não é mais o caminho a seguir: a T6.5 (`ficha3-reports/o6b/T6.5-criar-personagem.md`)
cruzou três specs e confirmou que **um botão "Criar personagem" violaria decisão de produto
fechada** (REQ-CFG-051a, REQ-NPC-055a). O gatilho real, já implementado e provado ao vivo
nesta mesma onda, é:

1. Mestre logado → **Configurações → Usuários → "Criar usuário"** → nome, papel
   `Jogador`/`Confiável`, senha.
2. Ao confirmar, `AuthService.createUser` (REQ-USR-025) cria, na mesma transação, um Actor
   `character` **em branco** do qual o novo usuário é `OWNER` (`ownership[userId] = 3`).
   (Antes do fix `20edd60d`/C2 desta onda, o comando de CLI `fusion user add` não passava por
   esse serviço e não criava o Actor — a rota de UI/API sempre criou corretamente.)
3. Esse Actor aparece imediatamente na aba **Contatos → "Na mesa"** de todo mundo, marcado
   "você" para o próprio dono; duplo-clique (ou "Abrir a ficha") abre a `CharacterSheet` com a
   coluna **Plano visível por padrão** (`planVisible = $state(true)`), pronta para escolher
   ancestralidade/antecedente/classe e subir de nível — qualquer uma das 29 classes.
4. **"O Mestre também cria e escolhe o dono"**: como REQ-USR-025 não separa "criar usuário" de
   "escolher dono", o Mestre criando o usuário **é** o Mestre escolhendo o dono do personagem
   que nasce junto.

**Para o gate:** não é preciso mais reaproveitar atores existentes nem escrever direto no
`world.db` para simular um personagem novo — basta criar um usuário PLAYER pela UI de
Configurações. Evidência completa (prints + verificação em `world.db`) em
`ficha3-reports/o6b/evidencia-viva.md` / `evidencia-viva-final.md`.

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

## 8. Companion nasce ao reabrir a ficha; trocar classe num ator reusado duplica item

Verificado ao vivo em 2026-09-21 (evidência viva da Onda 3, ator companheiro):

- **A criação do ator companheiro (eidolon do Summoner, familiar da Witch) é um "heal on-open"
  (`runHealAutoCompanion`), não um efeito imediato do clique em "Confirmar" no diálogo de
  classe/eidolon.** Depois de aplicar a classe (e, no caso do Summoner, escolher o tipo de
  Eidolon no slot do Plano), **feche a janela da ficha e abra de novo** — só nesse reabrir o
  servidor cria o ator `type: "familiar"` com `system.companionKind` (`"eidolon"`/`"familiar"`)
  e `system.masterActorId` apontando para o dono, com `ownership` copiado do master. Ele
  aparece aninhado sob o personagem na gaveta Contatos e como card na aba "Pets" da própria
  ficha.
- **Cuidado ao reusar um ator de rodadas anteriores do gate para trocar de classe**: se ele já
  tiver um item `type: "class"` (de uma rodada anterior), trocar a classe pelo diálogo do Plano
  **não substitui** esse item — ele fica um segundo `class` no array `items`, e o card do Plano
  passa a mostrar a classe ERRADA (a primeira do array), enquanto a classe nova só aparece nos
  `choices`/`classFeature`s (ver issue #246, `xansde/fusion`). Isso também impede a heal de
  encontrar a classe certa (ela lê `items.find(i => i.type === 'class')`). **Workaround**: para
  testar uma classe nova num ator de teste já contaminado, resetar o ator a nível 1 sem classe
  antes (via escrita direta no `world.db` de teste — nunca no ator real de produção): mantenha
  só os itens `ancestry`/`heritage`/`background`, zere `system.level.value` para `1` e filtre
  `system.build.choices` para as entradas `backgroundSkill-*`/`backgroundLore-*`. Depois reabra
  o servidor e reaplique a classe do zero pela UI.
