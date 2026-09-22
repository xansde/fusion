# Evidência viva — Onda 4b (T4.4, Aparições do Animist fazem efeito)

Lane de evidência "Vivo"/"Olhado" pendente desde o gate mecânico (`gate.md`: "prova
Vivo/Olhado (servidor+browser) não foi produzida nesta onda nem neste gate"). Disparada
pelo feedback direto do Alexandre:

> "no Animista, ao selecionar os espíritos (aparições) não adicionou nada na minha lista de
> magia, não adicionou filtro, não adicionou aba, não mudou nada"

## Setup

- Worktree: `scratchpad/wt-d`, branch `ficha3/o4b` (core, HEAD `2f7b980b`), submodule em
  `ficha3/o4b` (`497313a8`) — já buildada, sem alteração de código nesta lane.
- Data-dir: `scratchpad/data-o4b` (cópia de `~/.fusion/worlds/teste_xande`, original intocado).
- Servidor: `node packages/server/dist/cli/index.js serve --port 33033 ... --world teste_xande`,
  PID 5796 — boot saudável, encerrado com `taskkill //PID 5796 //F` ao final (confirmado:
  `netstat` sem LISTENING na 33033 depois).
- Browser: Playwright real (`playwright-cli -s=o4b`), sessão de Mestre (`gm_o4b`), setup wizard
  completo, login, ator "Novo Ator" (já existente no mundo copiado, nível 3).

## O que foi provado (nível "Vivo" — servidor + browser reais)

1. **Trocar a classe para Animist cria os slots de Sintonia de Aparição.** Ao clicar "Classe
   Bárbaro Barbarian" → escolher "Animist" → Confirmar, o bloco Nível 1 passou a mostrar
   "Animist 1", duas "Sintonia de Aparição", "Prática Animista" e a feature
   "Animist & Apparition Spellcasting". Print: `prints/01-animist-nv1-antes-aparicoes.png`.

2. **Antes de escolher qualquer aparição, a aba Magias NÃO tem "Apparition Spells"** — só
   `divine Spells` (vazio) e `Foco`. Print: `prints/02-magias-antes-aparicoes.png`.

3. **Escolher a 1ª aparição (Custodian of Groves and Gardens) cria a aba "Apparition Spells" na
   hora**, com o truque "Videira Emaranhada" (Entangling Vine, elevado ao patamar 2 pela regra
   de heightening de truque) já na lista de Truques, e "Patamar 1: 1/1 usos hoje" (slot
   espontâneo). Print: `prints/03-magias-depois-1a-aparicao.png`.

4. **A aba Foco ganha a vessel spell da aparição** — "Jardim de Cura" (Custodian), com 1 Ponto
   de Foco (0/1, correto para nível 1-2). Print: `prints/04-foco-vessel-spell.png`.

5. **As 2 Lore skills da aparição são concedidas como treinadas** — "Saber (Farming)" e "Saber
   (Herbalism)" em +6 (treinado), ao lado das Lore pré-existentes do antecedente (Legal,
   Scribing). Print: `prints/05-pericias-lore-aparicao.png`.

6. **Escolher a 2ª aparição (Lamentation of Sinister Deals) UNE o repertório** — Truques agora
   mostram "Videira Emaranhada" (Custodian) + "Mensagem"/Message (Lamentation), ambos elevados
   ao patamar 2. Print: `prints/06-magias-repertorio-2-aparicoes.png`.

7. **Trocar UMA aparição troca o repertório dela, preservando a outra.** Troquei a 1ª aparição
   (Custodian → Crafter in the Vault) pelo botão "Editar: Custodian…" → escolher "Crafter in the
   Vault" → Confirmar:
   - Truques passaram a ser "Sigilo" (Sigil, de Crafter) + "Mensagem" (ainda de Lamentation,
     intacto) — "Videira Emaranhada" sumiu junto com Custodian. Print:
     `prints/07-magias-apos-troca-aparicao.png`.
   - A vessel spell em Foco trocou para "Mercado de Desejos" (Traveling Workshop, de Crafter).
     Print: `prints/08-foco-vessel-apos-troca.png`.
   - (Lore também trocou no dado do ator — ver seção "Dado do ator" abaixo: `apparitionLore-0/1`
     passaram de Farming/Herbalism para `lore-architecture`/`lore-engineering`, as duas de
     Crafter in the Vault.)

8. **Recarregar a página mantém tudo.** Após `reload()`, reabri a ficha: a aba "Apparition
   Spells" ainda mostra "Mensagem" + "Sigilo" nos Truques, "Sure Strike" no Patamar 1 (ver nota
   de contaminação abaixo) e "Repertório completo neste patamar" nos dois patamares. Print:
   `prints/09-apos-reload-magias-persistem.png`.

9. **Picker de aparição mostra o texto REAL do livro** (Apparition Skills, Apparition Spells por
   patamar, Vessel Spell, Avatar) — não é um dropdown genérico. Print:
   `prints/00-picker-aparicao.png`.

**Conclusão sobre o feedback do Alexandre:** no build `ficha3/o4b` (`2f7b980b` + submódulo
`497313a8`), o cenário relatado — "selecionar aparição não muda nada" — **não se reproduz**.
A aba, o filtro (Truques/Patamar), a lista de magias e a vessel spell reagem à escolha e à troca
de aparição, ao vivo, com dado real. Isso bate com a causa raiz documentada em
`T4.4-aparicoes.md`: o feedback foi levantado ANTES desta lane consertar
`chooseClassChoice("apparition", …)`; o commit que resolve isso (`497313a8` no satélite) já está
na branch `ficha3/o4b`, só não tinha prova viva.

## Dado do ator (servidor/banco, não só UI)

Query direta em `data-o4b/worlds/teste_xande/world.db`, tabela `actors`, id
`uPI3hK89HeppNd4a` ("Novo Ator"):

- `system.build.choices` tem `classLevel-1` apontando pro item `class` "Animist"
  (`9KiqZVG9r5g8mC4V`) e 4 slots `apparitionLore-0..3` = `lore-architecture`,
  `lore-engineering` (Crafter, pós-troca), `lore-legal`, `lore-scribing` (Lamentation) — bate
  exatamente com a Lore das 2 aparições finais, confirmando que a troca da 1ª aparição
  atualizou o dado persistido, não só a UI.
- `items[]` tem `spellcastingEntry` "Apparition Spells" de fato criado, com `spell` embarcadas
  "Message", "Sigil" (repertório atual) e "Mending"/"Knock"/"Traveling Workshop" (magias de
  patamar mais alto da Crafter, herdadas do parse do `class-features-core`, ainda não
  acessíveis no nível 3 mas já carregadas — consistente com "Vessel Spell: Traveling Workshop"
  do texto do picker).

## Defeito registrado (não consertado, achado ao vivo)

**Trocar a classe (picker "Classe") não remove o item `class` nem os `classFeature`/`action`
da classe anterior — fica um "fantasma" que exibe rótulo errado.**

- Cenário concreto: ator "Novo Ator" tinha `class` Barbarian + `classFeature` Rage/
  Quick-Tempered/Furious Footfalls. Ao trocar para Animist pelo picker de Classe (mesmo fluxo
  usado no teste acima), o item `class` "Barbarian" (`YDRiP7uVvr9WRhOI`) e os 3 `classFeature`
  dele continuaram no array `items[]` do ator — só o `system.build.choices.classLevel-1.ref`
  passou a apontar pro novo item `class` "Animist". Consequência visível na UI, **imediatamente
  após confirmar a troca** (antes de qualquer reload): o card "Classe" no topo do Plano mostra
  "Bárbaro Barbarian" (não "Animista Animist"), e o bloco Nível 1 mistura features de Animist
  ("Animist & Apparition Spellcasting") com as de Barbarian ainda visíveis ("Fúria"/Rage,
  "Estopim Curto"/Quick-Tempered). Print: `prints/02-magias-antes-aparicoes.png` (rótulo
  "Bárbaro Barbarian" já visível ali) e `prints/10-defeito-classe-label-stale-apos-reload.png`
  (confirma que sobrevive a reload).
- Log do console confirma que o próprio produto já sabe que o ator estava "sujo": ao abrir a
  ficha, `[Plan heal] materialized 3 missing grant(s), removed 0 ghost entrie(s)` — ou seja, o
  "Novo Ator" usado neste teste já vinha de uma construção Animist ANTERIOR a esta lane
  (aparições escolhidas, nunca consumidas — exatamente o cenário que o heal de
  `PlanColumn.svelte` foi feito para cobrir, conforme `T4.4-aparicoes.md`). Isso explica também
  o `spell "Sure Strike"` que aparece dentro do Patamar 1 de Apparition Spells nos prints 07/09:
  é resíduo dessa construção anterior (não fabricado por este teste, não removido pelo heal
  porque heal só materializa grants faltando, não limpa excedentes).
- Escopo: bug de troca de classe em geral (não é código tocado por esta lane — `planVM.ts`/
  `PlanColumn.svelte` mexidos aqui tratam consumo de Apparition Attunement, não o picker de
  Classe em si). Não conserto (fora do escopo desta lane e regra "defeito não é consertado
  pela lane de evidência").

## Pendências para issue

1. **NOVA — repo `xansde/fusion`** (client, picker de Classe): "Trocar classe pelo picker não
   remove o item `class` nem os `classFeature`/`action` da classe anterior — fica rótulo
   'Classe X' e features fantasma na ficha". Corpo sugerido: reproduzir com Barbarian → Animist
   (ou qualquer troca), no ator já usado neste teste (`Novo Ator`, `teste_xande`); evidência em
   `evidencia-viva.md` desta lane (prints 02 e 10); causa provável: fluxo de troca de classe só
   atualiza `system.build.choices.classLevel-*.ref`, nunca remove os itens antigos do array
   `items[]`.
2. Nenhuma issue nova para a lógica de aparições em si — ela funcionou ao vivo. As pendências
   já registradas em `T4.4-aparicoes.md` (issues #101, #110, #115, #119 do satélite) continuam
   válidas e não foram tocadas por esta lane.

## Comandos e verificação

| Passo | Resultado |
| --- | --- |
| Boot do servidor (porta 33033) | verde — "Fusion server ready for connections" |
| Setup wizard + login GM | verde |
| Troca de classe → Animist | verde (com o defeito de rótulo registrado acima) |
| Escolha 1ª aparição (Custodian) | verde — aba/truque/vessel/lore criados |
| Escolha 2ª aparição (Lamentation) | verde — repertório unido |
| Troca da 1ª aparição (Custodian → Crafter) | verde — repertório e vessel trocaram, Lamentation intacto |
| Reload da página | verde — tudo persistiu (sessão de login e dado do ator; a JANELA da ficha fecha no reload, reaberta manualmente) |
| Query direta em `world.db` | confirma `choices`/`items` batendo com a UI |
| Encerrar servidor (PID 5796) | confirmado, `netstat` sem listener na 33033 |

## Arquivos

- Prints: `scratchpad/ficha3-reports/o4b/prints/00..10-*.png` (11 arquivos, todos olhados/
  descritos acima).
- Nenhum código de produção alterado nesta lane (só leitura + servidor de teste).
