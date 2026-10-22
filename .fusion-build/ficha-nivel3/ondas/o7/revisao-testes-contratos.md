# Revisão adversarial — Onda 7 (lente: teste não-circular + contratos)

## Escopo real do diff

- Core `origin/alfa/app...ficha3/o7`: 1 commit (`80472647`), 1 arquivo —
  `docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html` (725 linhas, 23 prints base64).
- Satélite `origin/main...ficha3/o7`: **diff vazio** (branch = `origin/main` = `b5990b9`).
- T7.1 (molde) e T7.2 (comparador) já estão mergeados (Onda 7a, PR core #252/#253, satélite #150);
  não fazem parte deste diff.

**Contratos core <-> satélite:** nenhum tipo, schema ou API mudou nesta onda. Não há consumidor
(server, client, sheets) que possa quebrar. **Nenhum teste novo, nenhuma asserção alterada:** a lane
não mexeu em teste nem em código de produção. A lente de circularidade se aplica, então, ao único
"teste" da onda: o roteiro e2e (`.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts`, não
versionado) e à evidência que ele produz.

Conferi os números dos prints contra a regra do PF2e (Bard, Player Core): PV 16/24/32, CA 13/14/15,
Fort +3→+5, Ref +3→+7 (Reflex Expertise no nv3), Vont +5→+7, Percepção +5→+7, CD de classe/magia
13→15. **Estão certos, mas só para um personagem com todos os modificadores de atributo em 0.** Esse
é o ponto central dos achados abaixo.

## Achados

### A1 — importante — o roteiro não exercita os mecanismos que a fatia entrega, e a ficha final não é comparável ao molde
- Arquivo: `docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html` (passos 12, 14, 20; prints 14 e 21).
- Cenário: o roteiro preenche só os 4 cartões ABC e o slot de arquétipo. Dádivas de Atributo, **Musa**
  (escolha obrigatória do Bard no nv1), Talento de Ancestralidade, Idioma Bônus, Treinamento de
  Perícias (0/4), Talento de Classe e Talento de Perícia do nv2 ficam abertos. No print 14 o repertório
  espontâneo está **vazio** ("Nenhuma magia conhecida neste patamar", 0 truques) e a CD do Bardo é 13 =
  10+3+**Car 0**. Resultado: (a) aplicação de dádivas (o mecanismo mais sujeito a erro da criação) e
  repertório espontâneo (o motivo declarado de ter escolhido o Bard) nunca rodam; (b) o molde (chassi
  Humano/Erudito com CON 14 etc.) prevê PV 18 no nv1, a ficha do roteiro mostra 16 — o texto dos passos
  14 e 20 ("conferir aqui contra o molde fecha o aceite") promete uma comparação impossível com essa
  ficha; (c) o relatório T7.3 ("tudo condiz com o esperado", "repertório espontâneo" conferido) passa
  como aceite uma ficha que não tem repertório. Um defeito real em dádiva de atributo ou no picker de
  repertório passaria por este roteiro com 23 prints "olhados".
- Conserto: aplicar o chassi do molde (dádivas), escolher Musa, preencher repertório e perícias; ou
  rotular o roteiro como "prova de fluxo, não aceite" e tirar a frase dos passos 14/20.

### A2 — importante — o e2e não é reproduzível: o `.spec.ts` só existe na worktree de scratchpad
- Arquivo: `.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts` (só em `wt-c`); ausente em
  `C:/Users/xansd/pessoal/fusion/.claude/skills/tutorial-e2e/roteiros/` (conferido: os outros roteiros
  estão lá, este não).
- Cenário: a T7.4 exige que o Alexandre "execute o e2e", e o relatório T7.3 manda "reconstruir a
  skill a partir do repo principal". Quando a worktree de scratchpad for removida no fecho, o roteiro
  some. O que sobra é o HTML de 2,7 MB, que não roda. P2 do `PROCESSO-UI.md` diz que os roteiros vivem
  em `.claude/skills/tutorial-e2e/roteiros/` (do checkout principal).
- Conserto: copiar o `.spec.ts` para o `.claude/skills/tutorial-e2e/roteiros/` do checkout principal
  antes de apagar a worktree.

### A3 — importante — smoke só como Mestre; o caminho real (jogador dono criando a ficha) não foi exercitado
- Arquivo: roteiro HTML, os 23 passos têm a tag "Gamemaster"; spec usa só `gm`.
- Cenário: em produção quem constrói a ficha é o jogador OWNER (REQ-USR-025; memória: "personagem
  nasce com o player"). O Mestre passa por `isRolePrivileged`/`isGm`, então qualquer defeito de gate por
  ownership (`vm.editable` em `CharacterSheet.svelte`, `canEdit` em `plan/LevelCard.svelte:72`, ou a
  validação no servidor do update de `build.choices`/nível) fica invisível. P4 do `PROCESSO-UI.md` exige
  "testado como GM: sim/não; testado como player: sim/não", e o relatório T7.3 não registra.
- Conserto: repetir pelo menos ABC + subir de nível como o usuário criado (login do jogador).

### A4 — menor — texto do passo 07 contradiz o achado #254 da própria lane
- Arquivo: roteiro HTML, passo 07: "O Actor em branco aparece em 'Na mesa' assim que o usuário é criado."
- Cenário: quem seguir o tutorial não vê o Actor sem recarregar a página (issue xansde/fusion#254). O
  spec esconde isso com `gm.reload()` (linha ~90). O tutorial ensina um comportamento falso.

### A5 — menor — o roteiro não tem nenhuma asserção, e "1 passed" não prova nada
- Arquivo: `ficha-nivel3.spec.ts` (nenhum `expect`; `secao()` engole exceções); passo 17.
- Cenário: o passo 17 afirma "nenhuma de multiclasse deve aparecer aqui", mas o spec só busca
  "Dedication" e clica na primeira linha (Acrobat vem antes de Alchemist em ordem alfabética). Se uma
  dedicação de multiclasse vazasse para a lista, o roteiro passaria igual. Há ainda um ramo silencioso
  `if (dialogoClasseNivel.isVisible())`. Mitigação: a exclusão de multiclasse já tem teste próprio da
  Onda 5. Mesmo assim, a frase do tutorial não tem lastro no roteiro.

## Não são achados
- Satélite sem diff, e pin igual ao HEAD do satélite (`b5990b9f`): estado normal.
- Multiclasse fora do Arquétipo Livre: decisão do plano (`plano.md:20`), consistente.
- Falhas do gate (`pregen-parity` 22, `actionCategories` 1): idênticas às da 7a, não são regressão.
- Números do Bard nv1-3: corretos pela regra para atributos 0 (conferidos acima).

## Veredito
Nenhum bloqueante: o diff é só documentação e não quebra contrato. A1–A3 devem ser corrigidos nesta
onda para que o roteiro valha como evidência de aceite. Do jeito que está, ele prova o fluxo ABC +
arquétipo, não a ficha.
