# wi-mapa-alvo-01 — Mockup: marcar/desmarcar alvo por clique direito

Mockup da fase Design (item `wi-mapa-alvo-01`, marco M2 do plano `pln-mapa-alvo`).
Base: `origin/build/app`. **Ver antes de codar.**

> **Este arquivo está fora do controle de versão de propósito.** A fase Design não cria
> branch e o checkout está em `feat/wi-mapa-grid-01`. Quem pegar `wi-mapa-alvo-01` deve
> levar `docs/design/wi-mapa-alvo-01/` inteiro para a branch do item.

## 1. O gesto

| Gesto | Onde | Resultado |
|---|---|---|
| **Botão direito** sobre um token | canvas | alterna o alvo **do usuário local** naquele token |
| Botão direito no vazio | canvas | nada (não deseleciona, não abre menu do browser) |
| Botão esquerdo | canvas | inalterado: seleciona / arrasta |
| Botão do meio, Espaço+esquerdo | canvas | inalterado: pan da câmera |
| Clique no botão ◎ da linha | CombatPanel | mesmo toggle do gesto do mapa |

O botão direito está livre hoje: o pan usa botão do meio ou Espaço+esquerdo
(`FusionCanvas._handlePointerDown:542`) e o menu de contexto do browser já é suprimido
no container (`FusionCanvas:133`). Nenhum atalho existente é sacrificado.

## 2. Tela do GM — antes e depois

Grade de 100px, três tokens. Retícula = quatro cantos em L sobre o footprint.
Vermelho `#ff4d4d` = alvo meu · Laranja `#ff9d2e` = alvo de outro (cores já existentes
em `TargetingMarker.ts:45-46`).

**(a) Estado inicial — nada marcado**

```
┌─ Mesa · cena "Cripta"  ──────────────────────────────── GM: Alexandre ─┐
│ · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·  │
│ ·        ┌──────┐        ·        ┌──────┐        ·                    │
│ ·        │ GOB1 │        ·        │ GOB2 │        ·   ┌──────┐         │
│ ·        └──────┘        ·        └──────┘        ·   │ HER  │         │
│ · · · · · · · · · · · · ·· · · · · · · · · · · · ·   └──────┘ · · ·   │
└────────────────────────────────────────────────────────────────────────┘
```

**(b) Botão direito em GOB1 e depois em GOB2 — dois alvos meus**

```
┌─ Mesa · cena "Cripta"  ──────────────────────────────── GM: Alexandre ─┐
│ · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·  │
│ ·       ┌╴    ╶┐         ·       ┌╴    ╶┐         ·                    │
│ ·        │ GOB1 │        ·        │ GOB2 │        ·   ┌──────┐         │
│ ·       └╴    ╶┘         ·       └╴    ╶┘         ·   │ HER  │         │
│ · · · · ·(vermelho)· · · ·· · · ·(vermelho)· · · ·   └──────┘ · · ·   │
└────────────────────────────────────────────────────────────────────────┘
```

Multiplos alvos por usuário são suportados por construção (`TargetingState.byUser` é um
`Set` por usuário) — o segundo clique **não** desmarca o primeiro.

**(c) Botão direito de novo em GOB1 — desmarca só ele**

```
│ ·        ┌──────┐        ·       ┌╴    ╶┐         ·                    │
│ ·        │ GOB1 │        ·        │ GOB2 │        ·   ┌──────┐         │
│ ·        └──────┘        ·       └╴    ╶┘         ·   │ HER  │         │
│                                  (vermelho)                            │
```

É exatamente isto que hoje não existe: o botão do CombatPanel manda `targeted=true`
fixo (`CombatPanel.svelte:446`), então a retícula só some quando o turno acaba.

## 3. Tela do jogador (segunda tela, mesma cena)

Com o GM marcando GOB2, a tela do jogador Ana mostra a retícula **laranja** — alvo de
outro usuário. Se a Ana marcar o HER com o botão direito, ela vê a dela em vermelho:

```
┌─ Mesa · cena "Cripta"  ─────────────────────────────────── Jogadora: Ana ─┐
│ ·        ┌──────┐        ·       ┌╴    ╶┐         ·      ┌╴    ╶┐         │
│ ·        │ GOB1 │        ·        │ GOB2 │        ·       │ HER  │        │
│ ·        └──────┘        ·       └╴    ╶┘         ·      └╴    ╶┘         │
│                                  (laranja)              (vermelho)        │
└───────────────────────────────────────────────────────────────────────────┘
```

Essa é a prova de duas telas do plano: GM marca 2, desmarca 1, jogador vê a cor de
"alvo de outro".

## 4. CombatPanel — o botão ◎ passa a refletir estado

Hoje o botão é sempre igual e sempre marca. Depois, ele é um toggle com estado visível
(reutiliza a classe `action-btn--active` que as outras ações da linha já usam):

```
  Iniciativa   Combatente        Ações
 ┌──────────────────────────────────────────────┐
 │   18        Goblin 1          [◎] [⚅] [☠]    │   ◎ apagado  = não é meu alvo
 │   15        Goblin 2          [◉] [⚅] [☠]    │   ◉ aceso    = é meu alvo (clique tira)
 │   12        Heroína           [◎] [⚅] [☠]    │
 └──────────────────────────────────────────────┘
   tooltip: "Marcar alvo" / "Desmarcar alvo"
```

O estado aceso vem de `isTargetedByUser(getTargetingState(), tokenId, userId)`, com
`targetingStore.version` lido para estabelecer a dependência reativa — mesmo padrão já
usado em `AntagonistaSheet.svelte:66`.

## 5. Feedback e casos de borda

| Caso | Comportamento desenhado |
|---|---|
| Latência do servidor | a retícula só aparece quando o broadcast `token:targeted` volta. **Sem estado otimista** — alvo não é movimento, não vale divergir cliente/servidor por 30ms. |
| Ack de erro | `onError` do manager (hoje só `console.warn`); nenhum toast novo neste item. |
| Sem combate ativo | funciona igual. O gesto do mapa **não** exige combate (o servidor nunca exigiu; era o painel que só existia dentro do combate). |
| Token oculto para o jogador | não é renderizado, logo não é clicável — nada a fazer. |
| Token alvo de mim **e** de outro | desenha vermelho (regra atual de `byLocalUser`). Limitação herdada, nomeada em `arquitetura.md` §6. |
| Fim do turno | limpeza automática existente (REQ-CBT-055) continua valendo e apaga as retículas do usuário do turno. |

## 6. O que este mockup NÃO desenha

Menu de contexto no botão direito (o gesto consome o botão direito inteiro), ataque
pelo mapa, régua de distância, contador "N usuários mirando" sobre o token.
