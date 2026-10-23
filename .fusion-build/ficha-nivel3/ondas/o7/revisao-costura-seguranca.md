# Revisão adversarial o7 — lente COSTURA + CI + SEGURANÇA + UI

## Escopo real do diff

- Core `origin/alfa/app...ficha3/o7`: **1 commit, 1 arquivo** — `docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html` (2,7 MB, 23 PNG em base64). Nenhum código de produção.
- Satélite `origin/main...ficha3/o7`: **vazio** — `ficha3/o7` (b5990b9) já é o HEAD de `origin/main` (merge do PR #150, T7.1/T7.2 da o7a).
- Pin do submodule: `b5990b9` tanto em `origin/alfa/app` quanto em `ficha3/o7` — sem mudança de pin, coerente com o satélite.

## Checagens sem achado

- Higiene: nenhum data-dir, auth_secret, node_modules, vendor, out/, junction ou .env no diff. `.claude/` (skill + roteiro `ficha-nivel3.spec.ts`) não rastreada — conforme PROCESSO-UI P2 (skill local, não versionada).
- Isolamento do e2e: `lib/captura.ts` copia a demo para `mkdtemp` e aponta `--data-dir` para a cópia; o mundo `teste_xande` do print é a cópia, não o `~/.fusion` real.
- Conteúdo do HTML: sem senha, token, caminho local ou nome real nos textos; print do form de usuário tem o campo senha vazio.
- Tamanho: precedente já existe no repo (PNGs de 400-470 KB em `.fusion-build/ficha-nivel3/ondas/o5`, `o6b`). Não é padrão novo.
- CI: `prettier --check` no arquivo verde (rodado aqui). Sem teste novo no core, então `spec:report` não muda (gate confirma 719/719). Lockfile intocado. Satélite sem diff.
- Permissão/redação: sem código de servidor no diff — nada a validar.
- UI nova: nenhuma (o7 não altera componente); P3/lente protótipo não se aplica.

## Achados

### A1 — importante — o roteiro de aceite demonstra uma ficha ilegal pelo RAW como sucesso
Arquivo: `docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html` (passos 17, 18, 21); roteiro local `.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts:173-180`.
Cenário: o roteiro digita "Dedication" e clica na **primeira linha** do picker (Acrobat Dedication). O próprio print 17 mostra "Pré-requisitos: treinado em Acrobacia". O personagem é Human + Scholar + Bard com "Treinamento de Perícias (0/4)" em aberto (print 21) — Scholar treina Arcana/Nature/Occultism/Religion, Bard treina Occultism/Performance: Acrobacia NÃO está treinada. Mesmo assim o print 18/21 mostra a dedicação com o check verde "concedido", sem marca de requisito, e o relatório da lane afirma "Tudo condiz com o esperado". Causa no produto: `planVM.ts:2780-2811` classifica pré-requisito de rank de perícia como `unknown` e nunca marca (DEC-BC-05) — é limitação pré-existente, mas o artefato de aceite a apresenta como comportamento correto. Em produção o Alexandre (T7.4) lê este HTML como evidência de que o fluxo de arquétipo está certo, e um jogador pega Acrobat Dedication sem Acrobacia sem nenhum aviso.
Conserto nesta onda: roteiro treina Acrobacia antes (ou escolhe dedicação cujo pré-requisito o chassi cumpre) e regenera o HTML; registrar issue "pré-requisito de rank de perícia em talento de arquétipo não é marcado" (não achei issue existente com `gh issue list`).

### A2 — importante — a ficha fotografada não é o chassi do molde, mas os passos 14/20 dizem que ela "fecha o aceite"
Arquivo: HTML passos 14 e 20; `molde/README-molde.md:75` (chassi proposto 10/12/14/13/12/11, CON +2).
Cenário: o roteiro deixa Dádivas de Atributo, Musa, Talento de Ancestralidade, Idioma e Treinamento de Perícias abertos (print 21). Resultado: PV 16→24→32 e CA 13→15 com todos os modificadores zero. O molde que o Alexandre vai preencher (T7.4) usa CON +2 → PV esperado no nível 3 = 38, e DEX +1 → CA 16. Quando ele "executar o e2e" contra o molde, vai ver divergência de PV/CA/salvaguardas que é artefato do roteiro, não defeito do motor, e perder tempo caçando um bug inexistente, ou (pior) aceitar como "divergência conhecida" um número que esconde um bug real. As legendas "Conferir aqui contra o molde … fecha o aceite não-circular" e "Estado final para conferir contra o molde" são falsas para esta ficha.
Conserto: aplicar o chassi completo do molde no roteiro (boosts + escolhas obrigatórias) ou trocar as legendas para "fluxo, não comparável ao molde" e dizer isso no relatório.

### A3 — menor — legenda do passo 7 contradiz o achado #254
Arquivo: HTML passo 7; `ficha-nivel3.spec.ts:98`.
Cenário: a legenda diz "O Actor em branco aparece em 'Na mesa' assim que o usuário é criado", mas o roteiro precisou de `gm.reload()` (linha 90) justamente porque isso NÃO acontece (issue #254 aberta). Quem usa o HTML como tutorial cria o usuário, não vê o personagem e acha que errou. Consertar a legenda ("depois de recarregar — ver #254").

### A4 — menor — nenhum passo como player (PROCESSO-UI P4)
Arquivo: HTML, todos os 23 passos com tag "Gamemaster".
Cenário: o Actor é do jogador (REQ-USR-025), mas toda a criação nível 1-3 é feita pelo Mestre. Um defeito que só aparece para o dono não-privilegiado (ex.: player não vê o slot de Talento de Arquétipo, ou não consegue subir de nível na própria ficha) passa por este aceite. A o6b tinha prints de player; esta não. Issue ou seção extra "player abre a própria ficha nível 3".

## Veredito
Costura, pin, lockfile, CI e segurança limpos (o diff é só um HTML de documentação). Nada bloqueante. A1 e A2 são sobre a validade do próprio artefato de aceite e devem ser consertados nesta onda; A3/A4 viram issue.
