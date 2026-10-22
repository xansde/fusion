# Revisão adversarial o7 — lente REGRA PF2e + CAMINHO DE PRODUÇÃO

Escopo real do diff integrado: core `origin/alfa/app...ficha3/o7` = 1 arquivo
(`docs/design/ficha-nivel3/onda7/roteiro-e2e-ficha-nivel3.html`, T7.3). Satélite
`origin/main...ficha3/o7` = vazio (T7.1/T7.2 já mergeados no #150 / o7a). Revisei o HTML
(texto + os 23 prints extraídos e olhados), o roteiro `ficha-nivel3.spec.ts` (só na worktree)
e o código de ficha que os prints exercitam.

## O que está CERTO pela regra (conferido nos prints)

Bard humano, atributos zerados (Dádivas não preenchidas), sem armadura:
- PV 16/24/32 (Human 8 + Bard 8 por nível, Con 0) — correto.
- CA 13→15 (10 + treinado em sem armadura 2 + nível) — correto.
- Nível 1: Fort +3 (T), Ref +3 (T), Vont +5 (E), Percepção +5 (E) — correto.
- Nível 3: Ref +7 (Reflex Expertise no 3) , Fort +5, Vont +7, Percepção +7 — correto.
- CD de classe / CD de magia 13 → 15 (treinado) — correto. Patamar 1: 2 usos (nv1), 3 (nv3) — correto.
- Pool de dedicação não mostra multiclasse (Alchemist Dedication apareceria entre Acrobat e Aldori) — ok.

## Achados

### A1 — importante — Selo de proficiência "U" em salvaguardas e Percepção de toda ficha criada pelo builder
`external/fusion-systems-2e/sheets/pf2e/src/lib/sheets/pf2e/characterSheetVM.ts:1045-1055`
(saves) e `:1014`/`:1021-1023` (perception). O `total` vem da derivação (rank concedido pela
classe), mas o `rankLabel` vem de `system.saves.<x>.rank` / `system.perception.rank` persistido,
que o builder nunca escreve (fica 0). Cenário: Bard nv1 criado pelo builder → Fortitude "+3 U",
Vontade "+5 U", "PERC. (U)"; nv3 → Ref "+7 U" (é Expert). Visível nos prints 12, 21 e 23 do
próprio roteiro — a lane declarou "tudo condiz". Em produção o jogador lê "Destreinado" em
salvaguardas que são Treinado/Expert. É exatamente o campo "ranks de proficiência" do molde
T7.1. Sem issue aberta (varri as abertas do satélite).

### A2 — importante — O roteiro e2e não existe fora da worktree temporária
`.claude/skills/tutorial-e2e/roteiros/ficha-nivel3.spec.ts` está só em `wt-c` (scratchpad);
não está no repo principal (`C:/Users/xansd/pessoal/fusion/.claude/skills/tutorial-e2e/roteiros/`
não tem o arquivo) nem versionado. Cenário: fecho remove a worktree → a T7.4 ("preencher os
moldes E EXECUTAR o e2e", dono Alexandre) não tem o que executar; o entregável vira só um HTML
de prints de uma rodada. A própria nota da lane manda "reconstruir a skill a partir do repo
principal", que não contém o roteiro.

### A3 — importante — O e2e pula o caminho de produção decidido na Onda 6 (o jogador cria)
T7.3 depende de "ondas 0-6"; a decisão 2 / T6.1 é "o jogador cria e edita o próprio ator pelo
Hub" e T6.2 valida no servidor. Os 23 passos são todos como Gamemaster (Criar usuário →
Contatos → ficha). `PROCESSO-UI.md` P4 exige smoke GM e player. Cenário: regressão em
ownership/redação/validação de servidor no fluxo do jogador (T6.2/T6.3, #109) passa neste
aceite sem ser vista, porque o GM é privilegiado e não passa pelos mesmos predicados.

### A4 — menor — O aceite certifica uma ficha ilegal pela regra (Acrobat Dedication sem Acrobacia treinada)
Roteiro, seção nível 2: pega `.picker-row` **first()** da busca "Dedication" → Acrobat
Dedication (pré-requisito "trained in Acrobatics", visível no print 17). Bard + Scholar sem
perícias escolhidas ("Treinamento de Perícias (0/4)") não é treinado em Acrobacia; a ficha
mostra ✓ verde (prints 18/21) e a regra `upgrade` leva Acrobacia a Expert pulando o
pré-requisito. 95 das 167 dedicações têm pré-requisito de rank de perícia que o resolvedor
(planVM.ts:2780-2810) deliberadamente não avalia — lacuna já registrada em
fusion-systems-2e#144. O achado da o7 é o artefato de aceite apresentar esse estado como
"condiz com o esperado"; escolher uma dedicação legal (ou treinar Acrobacia antes) e citar #144.

### A5 — menor — Nível 3 do conjurador não foi olhado onde muda
Print 23 corta em "PATAMAR 1 3/3"; o Patamar 2 (a novidade do nv3 do Bard: 2 espaços de 2º
patamar) não aparece, a aba Foco e a aba Perícias nunca são abertas, e o repertório fica vazio
(nenhuma magia conhecida é adicionada). Cenário: se o nv3 gerar 0 espaços de 2º patamar ou
pool de foco 0, os 23 prints continuam idênticos. O texto dos passos 20/23 afirma que "slots e
magias" e "foco" foram conferidos.

### A6 — menor — Legenda do passo 7 contradiz o próprio contorno
HTML passo 07: "O Actor em branco aparece em 'Na mesa' assim que o usuário é criado." O roteiro
faz `gm.reload()` justamente porque não aparece (fusion#254). Quem seguir o tutorial sem reload
não encontra a ficha.

## Fora de achado (registrado)
- Pin do core no commit do satélite pré-merge: estado normal.
- Mundo/ator já existentes: o roteiro só cobre personagem nova; não encontrei cenário concreto
  de falha introduzido pela o7 (diff é só doc), então não reporto.
