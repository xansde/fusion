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
