# r21 — Achados do usuário testando o builder ao vivo

> Registro para sobreviver ao compact da conversa. Tudo aqui foi reportado pelo
> Alexandre testando o mundo `argiburgo` no navegador, com o servidor rodando em
> `localhost:33000`, na build de 2026-08-01/02 (commit `0b0d531`).
> **Nada nesta lista foi corrigido ainda.**

---

## A1 — Pré-requisito de eixo de subclasse não é recusado nem marcado ⚠️ ALTA

**O que aconteceu:** personagem Bárbaro com o instinto **Enfurecido pelo Sangue**
(`Bloodrager`). O builder deixou escolher o talento **Arrogância Dracônica**
(`Draconic Arrogance`), que exige **`dragon instinct`**. Não recusou, não marcou,
não avisou.

**Por que importa:** o dado do pré-requisito EXISTE e está correto — tanto que o
mapa de nós resolve essa mesma aresta (`Dragon Instinct → Draconic Arrogance`,
depois que o universo de nós passou a incluir as opções de eixo). Ou seja: o
builder tem a informação e não a usa.

**Onde olhar:** `isFeatEligible` em
`packages/client/src/lib/sheets/pf2e/planVM.ts` — ela avalia categoria, trait e
nível, mas **não avalia `system.prerequisites`**, que é texto livre
(`[{value: "dragon instinct"}]`). Nenhum caminho do client lê esse campo hoje.

**Relação com a frente 3 (em andamento):** a frente 3 implementa a marcação
visual de "pré-requisitos não satisfeitos". Este achado é o caso concreto que ela
tem de cobrir — e cobre um tipo específico: pré-requisito que aponta para uma
**opção de eixo de subclasse** (instinto, malandragem, tese...), não para um
talento. Verificar se a frente 3 resolve isto; se não, é trabalho adicional.

**Cuidado ao corrigir:** pela regra do próprio projeto (specs/31 DEC-BC-05,
reafirmada pelo Alexandre), requisito **marca, não bloqueia**. A correção certa é
deixar escolher e sinalizar em vermelho com o motivo — não impedir.

---

## A2 — Não existe estado de ficha ("estou em fúria") 🆕 FEATURE NOVA

**O que falta:** não há como dizer à ficha "estou em fúria" e ver os números
mudarem. Fúria é um **estado**, não uma escolha de construção — e a ficha só
modela construção.

**Casos que o Alexandre citou** (todos com a mesma forma: um modo que liga e
altera números enquanto está ativo):

| Classe       | Estado                                                 |
| ------------ | ------------------------------------------------------ |
| Bárbaro      | **Fúria** (Rage)                                       |
| Magus        | **Cascata Arcana** (Arcane Cascade)                    |
| Swashbuckler | **Panache**                                            |
| Taumaturgo   | **Exploit Vulnerability**                              |
| Ladino       | Surprise Attack — _ele mesmo marcou dúvida se encaixa_ |

Sobre a dúvida do Ladino: Surprise Attack não é um modo que se liga — é uma
condição da primeira rodada do combate. Provavelmente pertence a outra família
(efeito condicional de rolagem), não à de estado alternável. Decidir na hora de
especificar.

**Onde isso encosta no que já existe:** o motor já tem `Effect` como item
embutido com `modifiers[]` e duração (`specs/17-sistema-pf2e.md` DEC-PF2-04 e
DEC-PF2-07), e condições já aplicam efeito mecânico automático. O que falta é a
camada de **ligar/desligar pela ficha** e a materialização do efeito de cada um
desses estados. Não é motor novo; é uso do motor que existe + UI.

**Escopo real:** isto é uma rodada própria, não um fix. Precisa de spec: quais
estados existem, o que cada um altera, quem pode ligar (dono/GM), se persiste
entre sessões, e como aparece no card de rolagem.

---

## A3 — Nome da classe não é traduzido no card do Plano 🐛 MÉDIA

**O que aconteceu:** no print, o card **CLASSE** mostra `Barbarian` — cru, sem
pt-BR e sem subtítulo EN. Os cards vizinhos aparecem certos: `Rato da Sombra
Shadow Rat`, `Performista de Fogos de Artifício Fireworks Performer`.

**Causa provável, com evidência:** a tradução existe. Medido no overlay
`systems/pf2e/packs/classes-core/i18n.pt-BR.json`:

```
Barbarian → Bárbaro      Fighter → Guerreiro     Kineticist → Cineticista
Ranger    → Patrulheiro  Rogue   → Ladino        Wizard     → Mago
Magus     → Magus (nome próprio, mantido)
```

Logo o defeito é de **client**: o card de classe não passa pelo
`buildContentNameTranslator` (r14) que os demais cards ABC usam, ou o tradutor
não foi alimentado com o pack `classes-core`. Procurar em `PlanColumn.svelte` /
`planVM.ts` o ponto onde o card ABC de classe monta o rótulo.

---

## A4 — String em inglês na aba Ações (colateral, visto no print) 🐛 BAIXA

`No strikes available. Equip a weapon.` aparece cru no topo da aba **Ações**.
Regra do repo (r14): pt-BR sempre principal. Chave i18n faltando ou texto
hardcoded.

---

## Estado da rodada quando a sessão caiu

**Servidor:** rodava em `localhost:33000` com o mundo `argiburgo`. Backup do
mundo feito antes de subir, em
`C:\Users\xansd\.fusion\backups\argiburgo-pre-r21-20260801-214707`.

**Commitado e no remoto** (branch `build/app`):

| commit    | conteúdo                                                            |
| --------- | ------------------------------------------------------------------- |
| `c2ca1ea` | curadoria de classe como dado + derivação de proficiência           |
| `0186111` | 5 classes novas nos packs (7 classes, 151 features, 898 feats)      |
| `266bea6` | portão de duplicata semântica                                       |
| `0b0d531` | eixos de subclasse clicáveis + pt-BR 100% + varredura das 7 classes |

**Trabalho em andamento — PRESERVADO em branches** (as três frentes commitaram
`wip:` antes de a sessão cair; nada se perdeu):

| branch                       | commit    | frente                                          | volume     |
| ---------------------------- | --------- | ----------------------------------------------- | ---------- |
| `worktree-wf_39a551e1-8d7-1` | `2e13f5a` | talento repetido (`maxTakable`) — **concluída** | 266 linhas |
| `worktree-wf_39a551e1-8d7-2` | `9d7bb6e` | Ancestralidade Adotada                          | 482 linhas |
| `worktree-wf_39a551e1-8d7-3` | `b414e4b` | re-seleção + marcação de pré-requisito          | 644 linhas |

As frentes 2 e 3 **não chegaram a reportar** — o código está lá, mas ninguém
confirmou que os testes passam. Ao retomar: rodar as suítes em cada branch antes
de mergear, não confiar no `wip`.

**Pendências já conhecidas, além dos achados acima:**

1. Talento já esgotado (`maxTakable`) **continua aparecendo na lista** e só é
   recusado ao confirmar — o índice do pack não publica `maxTakable` nem
   `flags.fusion.sourceId`. Corrigir publicando os dois campos em
   `systems/pf2e/packs/feats-core/pack.json` (`indexFields`).
2. Erro de typecheck **pré-existente** em
   `packages/client/src/lib/sheets/pf2e/__tests__/varredura-classes.test.ts:397`
   (`exactOptionalPropertyTypes`).
3. Dívida herdada da r13: 8 documentos de `spells-core` com enricher traduzido
   por dentro (`@Damage[5d6[veneno]`) — quebram o botão de dano. Não são deste
   delta; a QA os acusa.

**Artefato entregue:** mapa de nós das 7 classes —
https://claude.ai/code/artifact/d28e0cb7-821e-4868-a996-b49f9c02989e
(gerado por `tools/importer-pf2e/src/curation/grafo-de-feats.mjs`; regenerar com
`node src/curation/grafo-de-feats.mjs` e reinjetar o JSON no HTML do scratchpad).
