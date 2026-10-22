# Linguagem visual do Fusion (fundação, 22/10/2026)

Fonte única: `packages/client/src/styles/base.css`. Todo componente do cliente e das fichas
de sistema pinta com `var(--fusion-*)`; ninguém escreve cor, fonte, raio ou sombra crua.
Trocar a direção visual é trocar os valores desse arquivo.

Direção implementada: **A, "Lanterna"** (carvão quente + latão como acento único). A
alternativa ousada (**B, "Grimório de bolso"**) e o diagnóstico que motivou as duas estão na
revisão de 22/10 (`Projects/fusion/revisao-ui-2026-10-22.html` no vault). Decisão
provisória: o Alexandre pode mandar trocar.

## Regras de leitura (requisito: um jogador da mesa tem dislexia)

- Fonte de corpo **Atkinson Hyperlegible Next** (OFL, auto-hospedada em
  `styles/fonts/`); números e dados em **Atkinson Hyperlegible Mono**. Nada de CDN: o
  servidor roda offline na máquina do GM.
- Escala em rem: `--fusion-text-xs` 13px (o piso, só legenda e selo), `-sm` 14px,
  `-base` 15px (corpo), `-md` 16px (texto corrido), `-lg` 18px, `-xl` 22px, `-2xl` 28px.
  **Nenhum texto abaixo de 13px.**
- Entrelinha `--fusion-leading` 1,5; espaçamento de letra e palavra levemente aberto (já no
  `body`); texto corrido limitado a `--fusion-measure` (68ch); sempre alinhado à esquerda.
- Sem itálico em bloco, sem MAIÚSCULAS corridas (`text-transform: uppercase` não entra
  mais em código novo; rótulo é frase normal), sem texto justificado.
- Contraste AA sem preto puro em branco puro (claro) nem branco puro (escuro): use
  `--fusion-text`, `-muted`, `-subtle`; `-subtle` é o mínimo para texto.
- Números derivados com `font-variant-numeric: tabular-nums` (herdado do `body`).

## Fim do "IA-slop"

- Superfícies planas: `--fusion-bg` < `--fusion-surface` < `--fusion-surface-alt`. Sem
  gradiente, sem brilho, sem sombra decorativa: `--fusion-shadow-popover` e
  `--fusion-shadow-modal` só em camada flutuante (popover, menu, janela).
- Um acento (`--fusion-accent`) e só para o que é interativo ou selecionado. Cores
  semânticas (`success`, `warning`, `danger`, `info`, `magic`) só com significado.
- Raios pequenos: `--fusion-radius-sm` 3px, `--fusion-radius` 6px, `--fusion-radius-lg` 8px.
  Pílula só para contador.
- Sem cartão dentro de cartão: agrupar com espaço e um divisor, não com outra borda.
- Sem rótulo redundante nem texto de enchimento.

## Ícones

- Um conjunto: subconjunto do **Lucide** (ISC) em `packages/shared/src/ui/icons.ts`
  (`iconSvg(name)`), grade 24, traço 1,75 redondo, `currentColor`, sem preenchimento.
- No cliente: `components/common/Icon.svelte` (`<Icon name="map" />`). Em lugar que exige
  string SVG (registro da gaveta): `iconSvg(...)`.
- **Proibido** emoji ou caractere como ícone (⚡ 🗺 ✕ ⚙ ❯ ◆...). Glifo que faltar: copie o nó
  do `icon-nodes.json` do `lucide-static` na mesma versão (1.61.0) para `icons.ts`.
- Marca e favicon próprios: `components/common/FusionMark.svelte` e
  `packages/client/public/favicon.svg` (+ `favicon.ico`, `apple-touch-icon.png`,
  `icon-192.png`, `icon-512.png`).

## Tema

`lib/ui/theme.ts` escreve `data-theme="dark" | "light"` no `<html>` (preferência por
navegador, em `localStorage`; "sistema" segue o sistema operacional). Padrão: escuro.
Os tokens do claro ficam em `:root[data-theme="light"]` em `base.css`.

## Acessibilidade geral

- Foco visível global (`:focus-visible` com `--fusion-focus`, cor própria, nunca o acento).
- `prefers-reduced-motion` desliga transições e animações.
- Alvo de clique/toque mínimo `--fusion-target` (40px).
- Ícone sozinho precisa de nome acessível no botão (`aria-label`); `<Icon label>` só quando
  o ícone carrega sentido sozinho.

## Aliases

`base.css` declara aliases para 24 nomes que componentes usavam sem declaração
(`--fusion-color-*`, `--fusion-surface-raised`, `--fusion-radius-md`...). Código novo usa os
nomes canônicos; as lanes de área migram os antigos e removem os aliases quando zerarem.
