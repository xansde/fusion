# TODO do Fusion — trabalho adiado com motivo

> Lista curta e viva. Item só entra aqui quando foi **decidido adiar**, não
> quando foi esquecido. Cada item diz o que é, por que não foi feito agora e o
> que precisa acontecer antes.

---

## A2 — Estados de ficha ("estou em fúria") 🆕 FEATURE — adiado para r22

**Origem:** achado do dono testando o builder ao vivo em 2026-08-01
(`.fusion-build/r21/achados-do-usuario.md`, seção A2). **Decisão de 2026-08-02:**
fica fora da r21 por ser feature nova com necessidade de spec, não correção.

**O que falta:** não há como dizer à ficha "estou em fúria" e ver os números
mudarem. A ficha modela **construção** (o que o personagem É); não modela
**estado** (o que o personagem está fazendo agora).

**Casos levantados pelo dono** — todos com a mesma forma: um modo que liga,
altera números enquanto ativo, e desliga:

| Classe       | Estado                                                 |
| ------------ | ------------------------------------------------------ |
| Bárbaro      | **Fúria** (Rage)                                       |
| Magus        | **Cascata Arcana** (Arcane Cascade)                    |
| Swashbuckler | **Panache**                                            |
| Taumaturgo   | **Exploit Vulnerability**                              |
| Ladino       | Surprise Attack — _o próprio dono marcou dúvida_       |

Sobre a dúvida do Ladino: Surprise Attack **provavelmente não pertence a esta
família**. Não é um modo que se liga — é uma condição da primeira rodada do
combate. Pertence a "efeito condicional de rolagem", que é outro mecanismo.
Decidir isso é parte de escrever a spec, não pressupor.

**Família vizinha já mapeada:** as **stances** do Monk (Crane, Mountain, Tiger…)
são o mesmo padrão — feat que liga um modo. A curadoria do Monk (r22) já anota
quais feats são stances, para esta rodada ter o dado pronto.

**Onde encosta no que já existe:** o motor já tem `Effect` como item embutido
com `modifiers[]` e duração (`specs/17-sistema-pf2e.md` DEC-PF2-04 e DEC-PF2-07),
e condições já aplicam efeito mecânico automático. **Não é motor novo** — é uso
do motor que existe, mais uma camada de ligar/desligar na ficha.

**O que a spec precisa responder antes de qualquer código:**

1. Quais estados existem e de onde vêm (feature de classe? feat? stance?).
2. O que cada um altera, mecanicamente, no `Effect`.
3. Quem pode ligar/desligar (dono do personagem, GM, ambos).
4. Exclusividade: dois estados podem estar ligados ao mesmo tempo? Stances são
   mutuamente exclusivas por regra — o modelo precisa expressar isso.
5. Persistência: sobrevive à sessão? Ao refresh? Zera no fim do combate?
6. Como aparece no card de rolagem (o modificador precisa ser rastreável, não
   um número que apareceu do nada).
7. Sincronização: é estado de servidor (autoritativo) ou de cliente? Pela regra
   do projeto — validação de permissão sempre no servidor — provavelmente
   servidor, e isso tem custo de rede a considerar.

**Pré-requisito:** spec própria antes de implementar. Sem ela, cada estado vira
um caso especial escrito à mão e a dívida se multiplica por classe.

---

## A3 — Ator nasce junto: jogador ganha personagem, NPC nasce com ficha 🆕 PEDIDO DO DONO — 2026-08-23

**Origem:** pedido do dono em 2026-08-23, no meio da sessão do Elfo Ancião:
*"Quando criar um jogador, deve criar simultaneamente um personagem para aquele
jogador. Pode ser uma ficha crua. Ao criar um NPC, também quero que eles crie
com ficha crua."*

**Estado apurado (não é campo aberto — metade já existe):**

| Metade | Onde está | Situação |
| --- | --- | --- |
| jogador → personagem | `specs/05-usuarios-e-permissoes.md` REQ-USR-025/025a-d; `specs/37-configuracoes.md` REQ-CFG-051/051a | **especificado E implementado** no servidor — `AuthService.createUser` cria o `character` na MESMA transação, com `ownership.default = none`, o novo usuário como `OWNER` e `flags.fusion.playerId` de volta para o usuário |
| NPC → ficha crua | `specs/42-aba-npcs.md` REQ-NPC-040..047 (criação "do zero" pede subtipo e nome) | a spec cria o **ator**; que ele nasça com **ficha** utilizável não está escrito em lugar nenhum |

**O que falta descobrir antes de mexer em código** — a metade do jogador já está
pronta no servidor, então se o dono viu isso NÃO acontecer, o defeito está em
outro lugar:

1. A tela de criação de usuário (aba Configurações) chama `POST /api/users`, ou
   grava o usuário por outro caminho que pula a criação do ator?
2. O mundo `teste_xande` tem o usuário `Tobias` (PLAYER) com um ator `Tobias`
   que é dele por `ownership` mas **não tem `flags.fusion.playerId`** — foi
   criado antes desta implementação, ou por um caminho que não é o
   `createUser`. Vale confirmar qual dos dois antes de concluir qualquer coisa.
3. "Ficha crua" para NPC: o ator `npc` criado do zero abre ficha hoje? Se abre
   vazia, o pedido já está atendido e vira só verificação; se não abre, o que
   falta é a ficha de não-jogável — que a própria `42` §10 declara como **spec
   futura, sem dona**.

**Por que não foi feito junto:** o pedido chegou no meio de outra entrega
(DEC-MC-01) e a resposta certa depende do item 1 acima — implementar antes de
saber se o caminho já existe é o jeito de ganhar um segundo caminho de criação
fazendo a mesma coisa.
