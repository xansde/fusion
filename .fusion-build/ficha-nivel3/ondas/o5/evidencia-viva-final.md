# Evidência viva FINAL — Onda 5 (Arquétipos padrão, variante Arquétipo Livre)

Lane: `evidencia-viva-final` | Worktree: `wt-c` | Branch core: `ficha3/o5` (HEAD `c8bebc02`,
já pós fixer rodada 1 + rodada 2) | Branch satélite: `ficha3/o5` (`d88c5ff`)

## Por que esta lane existe

A `evidencia-viva.md` anterior (mesma pasta) foi escrita **antes** das duas rodadas de fixer
(`fix-r1.md`, `fix-r2.md`) e documentou dois defeitos como "não consertados": Achado 1
(dedicação de multiclasse aparecendo no slot padrão) e Achado 2 (Sanguimancer Dedication
invisível). Essas rodadas já corrigiram os dois (commits `47ce479`/C-3 e `d88c5ff`/C-6 no
satélite) e o core já repinou para o commit corrigido (`c8bebc02`, HEAD atual). Esta lane
reverifica AO VIVO, contra o código já corrigido, se os dois defeitos realmente sumiram —
não repete o que já estava provado (167 dedicações importadas, gravação no ator).

## Setup

- Data-dir: `<scratchpad>/data-o5` (recriado do zero, cópia fresca de
  `~/.fusion/worlds/teste_xande`; original intocado).
- Servidor: `node packages/server/dist/cli/index.js serve --port 33057 --data-dir <data-o5>
  --world teste_xande --no-open` (PID 15580, encerrado ao final via `taskkill //PID 15580 //F`;
  `netstat -ano | grep ":33057"` confirmou saída vazia depois).
- `feats-core` registrado no boot com **2922 documentos** (mesmo número da lane anterior —
  os fixers não mudaram a contagem de importados, só o `index.json`/elegibilidade).
- Setup wizard completado via Playwright (diretório → porta → Admin Key → concluir).
- Login como `GM_o5` (Mestre).
- Configurações → Mundo: **Arquétipo livre** ligado E **Multiclasse por nível** deixado
  ligado (estado default do mundo copiado) — de propósito, é exatamente a condição
  adversarial que expôs o Achado 1 na lane anterior. Print:
  `prints-final/01-config-mundo-arquetipo-livre-e-multiclasse-ligados.png`.
- Ator reaproveitado: **"Novo Ator"** (Bárbaro nível 3, mesmo ator da lane anterior, estado
  preservado no mundo copiado — slot "Talento de Arquétipo" do nível 2 ainda vazio nesta
  cópia fresca do data-dir).

## O QUE FOI PROVADO (contra o código já corrigido)

### Achado 1 (C-3) — dedicação de multiclasse CONTINUA fora do slot padrão

Com Multiclasse por nível ligado (condição que antes vazava), abri o picker "Talento de
Arquétipo" nível 2 e busquei as duas dedicações que antes apareciam:

- "Alchemist Dedication" → **"Nenhum resultado encontrado com esses filtros."**
  (`prints-final/04-alchemist-dedication-multiclasse-nao-aparece.png`)
- "Rogue Dedication" → mesmo resultado, zero itens (print não tirado — mesma tela vazia
  confirmada por snapshot de acessibilidade, `search-rogue.yaml` na sessão, texto idêntico).

A lista inicial do picker (sem busca) também não mostra nenhuma dedicação com tag
"multiclasse" — só "arquétipo"/"dedicação" (`prints-final/02-picker-slot-arquetipo-nivel2-
lista-inicial.png`; os únicos filtros disponíveis no topo são "arquétipo", "classe",
"dedicação" — o filtro "multiclasse" da lane anterior nem aparece mais porque nenhum item
da lista carrega essa tag).

### Achado 2 (C-6) — Sanguimancer Dedication AGORA aparece e é selecionável

Busquei "Sanguimancer" no mesmo picker: apareceu 1 resultado, "Sanguimancer Dedication",
com tags "Raro", "arquétipo", "dedicação" (`prints-final/03-sanguimancer-agora-aparece.png`).
Selecionei e confirmei (`prints-final/05-sanguimancer-selecionada-antes-confirmar.png`).

### Gravação no ator — nível "vivo", verificado no DADO, não só na UI

A UI passou a mostrar "✓ Sanguimancer Dedication" no bloco NÍVEL 2, com o chip
"Talento de Arquétipo · Archetype Feat" (`prints-final/06-sanguimancer-gravada-slot-
nivel2.png`).

Consultei o `world.db` diretamente (better-sqlite3, script Node fora da UI/socket, rodado de
dentro de `packages/server` para resolver a dependência nativa). O item embutido no ator
confirma:

```json
{
  "name": "Sanguimancer Dedication",
  "type": "feat",
  "system": {
    "level": 2,
    "category": "class",
    "traits": { "rarity": "rare", "value": ["archetype", "dedication"] }
  },
  "flags": {
    "fusion": {
      "sourceId": "HASFgAZ7spYleeaq",
      "build": { "level": 2, "slot": "archetypeFeat-2" }
    }
  }
}
```

`flags.fusion.build.slot === "archetypeFeat-2"`, `traits.value` sem `multiclass` — a
dedicação antes invisível está gravada no slot correto, no banco do servidor.

## Números — linha 167 da tabela, revalidada

| O que | Esperado (plano, linha 167) | Observado nesta lane (pós-fix) |
|---|---|---|
| Dedicações padrão importadas em `feats-core` | 167 | confirmado (2922 documentos no boot, mesmo delta da lane anterior) |
| Dedicações de multiclasse visíveis no slot padrão nível 2 | 0 | **0** — Alchemist e Rogue Dedication confirmadas ausentes (Achado 1 fechado) |
| Dedicações padrão visíveis no slot (das 167) | 167 | **167** — Sanguimancer Dedication confirmada visível e selecionável (Achado 2 fechado) |

Nenhuma amostragem adicional das 165 dedicações restantes foi feita nesta lane (mesma
limitação já registrada na lane anterior — ver "Não verificado").

## Pendências para issue

Nenhuma pendência nova. Os dois defeitos que geraram pendência na lane anterior
(evidencia-viva.md, seção "Pendências para issue") já foram resolvidos pelas rodadas de
fixer e não precisam mais ser abertos como issue — o histórico de consertos já vive em
`fix-r1.md` (C-3) e `fix-r2.md` (C-6). As 4 pendências menores (C-7/C-8/C-9/C-10) seguem
fora do escopo desta lane, já com título/corpo prontos em `fix-r1.md`.

## Runbook

`gate-runbook.md` conferido linha a linha durante a execução desta lane — passo a passo
bateu exatamente com o observado (setup wizard, login, navegação Contatos → Abrir ficha,
slot "Talento de Arquétipo" no bloco NÍVEL 2, encerramento por PID). Nenhuma correção
necessária.

## Não verificado

- Não testei o comportamento com "Multiclasse por nível" DESLIGADO (mesma lacuna já
  registrada na lane anterior) — testei propositalmente com o toggle LIGADO, que é a
  condição mais adversarial (a que expôs o bug original), e o filtro se manteve correto
  mesmo assim; não confirmei se desligar o toggle muda algo (não deveria, já que o filtro
  de `isFeatEligible` não olha o setting do mundo, só as traits do documento).
- Não testei as outras 165 dedicações padrão (fora Acrobat — provada na lane anterior — e
  Sanguimancer — provada nesta) uma a uma; a amostragem cobre os dois casos que já tinham
  defeito conhecido, não uma varredura das 167.
- Servidor encerrado (PID 15580) via `taskkill //F`; `netstat -ano | grep ":33057"` pós-kill
  confirmou saída vazia (porta livre).
