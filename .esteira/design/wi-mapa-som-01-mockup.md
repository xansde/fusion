# Design — mockup · wi-mapa-som-01

**Item:** Upload aceita mp3 e ogg, com teto de tamanho por tipo
**Marco:** M3 — Som ambiente sincronizado (plano `pln-mapa-som`)
**Superfície:** `packages/client/src/components/assets/FilePicker.svelte` ("Asset Browser")
**Data:** 2026-08-07

> Este documento é o **antes de codar**: como a mudança aparece para quem usa.
> Nada aqui é contrato imutável — se a realidade do código divergir, Implementar
> segue e registra a divergência.

---

## 0. O gesto — leia isto primeiro

A lição enfileirada no Discovery ("peça implementada não significa peça
alcançável") se aplica em cheio aqui. Depois deste item, o áudio entra por
**dois** gestos, e só um deles existe hoje:

| Gesto | Existe depois deste item? | Observação |
|---|---|---|
| **Arrastar e soltar** um `.mp3`/`.ogg` na zona de drop do Asset Browser | **Sim** | `handleDrop` não filtra por `accept` — o navegador entrega qualquer arquivo. É o gesto que fecha a prova deste item. |
| **Browse files** → diálogo do SO mostrando mp3/ogg | **Só onde o chamador pedir** | `accept` deixa de ser fixo e vira prop; os chamadores atuais (cena, token) continuam **só imagem**. Quem passa `kinds={["audio"]}` é a UI da biblioteca de música, no item seguinte do M3. |

Ou seja: **este item não pode ser dado como pronto com "o servidor aceita"** — a
prova é soltar um mp3 na grid e ver o card `♫` aparecer.

---

## 1. Asset Browser — estado ocioso (chamador padrão: imagem)

Comportamento **inalterado** para `SceneCreateDialog` e `TokenAddDialog`.

```
┌──────────────────────────────────────────────────────────────────┐
│  Asset Browser                                              ✕    │
├──────────────────────────────────────────────────────────────────┤
│  [ Search by name…                                            ]  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ⇧  Drop image files here    or    [ Browse files ]        │  │
│  │     PNG, JPEG, WebP, SVG · até 20 MB                       │  │  ← linha nova
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────┐ ┌────────┐ ┌────────┐                                │
│  │ [img]  │ │ [img]  │ │   ♫    │   ← card de áudio: já funciona  │
│  │ mapa-… │ │ token… │ │ tavern…│      (isImageExtension=false    │
│  │ 2.1 MB │ │ 88 KB  │ │ 6.4 MB │       + mime audio/* → ícone)   │
│  └────────┘ └────────┘ └────────┘                                │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  Or paste an external URL                                        │
│  [ https://example.com/image.webp            ]  [ Use URL ]      │
└──────────────────────────────────────────────────────────────────┘
```

A linha de formatos/limite abaixo do "Drop …" é **nova**: hoje o usuário só
descobre o limite errando. Ela é derivada do mesmo mapa que valida — não é
texto solto.

## 2. Asset Browser — chamador de áudio (`kinds={["audio"]}`)

Este é o estado que a UI da biblioteca de música (item seguinte) vai montar. O
mockup entra aqui porque é ele que justifica a prop `kinds` nascer neste item.

```
┌──────────────────────────────────────────────────────────────────┐
│  Asset Browser                                              ✕    │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ⇧  Drop audio files here    or    [ Browse files ]        │  │
│  │     MP3, OGG · até 100 MB                                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────┐ ┌────────┐                                           │
│  │   ♫    │ │   ♫    │      (grid filtrada por kind)              │
│  │ tavern…│ │ combat…│                                            │
│  │ 6.4 MB │ │ 9.1 MB │                                            │
│  └────────┘ └────────┘                                           │
└──────────────────────────────────────────────────────────────────┘
```

Diálogo do SO aberto pelo "Browse files": `accept=".mp3,.ogg"`.

## 3. Upload em andamento

Nada muda na mecânica da barra — muda só o que aparece nela, porque agora um
arquivo de 60 MB é um upload legítimo e demorado, não um erro instantâneo.

```
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ tavern-loop.mp3          ▓▓▓▓▓▓▓▓░░░░░░░░  47%             │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ combat-drums.ogg         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ✓               │  │
│  └────────────────────────────────────────────────────────────┘  │
```

## 4. Os quatro erros — mensagem por mensagem

O que o usuário lê é o que decide se ele acerta na segunda tentativa. Cada
mensagem abaixo tem um dono no código (cliente ou servidor) — as duas rotas
precisam dizer a **mesma** coisa.

| # | Situação | O que aparece na linha do upload | Quem produz |
|---|---|---|---|
| 1 | Soltou um `.wav` | `Formato não suportado. Aceitos: PNG, JPEG, WebP, SVG, MP3, OGG.` | cliente (extensão) e servidor (415, magic bytes) |
| 2 | mp3 de 140 MB | `Arquivo muito grande (140.2 MB). Máximo para áudio: 100 MB.` | cliente (antes de subir) e servidor (413) |
| 3 | png de 35 MB | `Arquivo muito grande (35.0 MB). Máximo para imagem: 20 MB.` | cliente e servidor (413) |
| 4 | `.mp3` na extensão, bytes de outra coisa | `Formato não suportado. Aceitos: …` | **só servidor** (415) — o cliente confia na extensão de propósito |

```
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ambient.wav   Formato não suportado. Aceitos: PNG, …  ✕    │  │
│  └────────────────────────────────────────────────────────────┘  │
```

O caso 4 é o que prova que a validação do cliente é UX e não segurança: renomear
`virus.exe` para `.mp3` passa pelo cliente e morre no servidor com 415.

> **Idioma das mensagens:** as mensagens atuais do `clientValidation.ts` e da
> rota estão em **inglês** (`"File type not supported…"`). O mockup acima está
> em pt-BR só para leitura. Implementar mantém o idioma que já está no arquivo —
> traduzir a UI não é escopo deste item.

## 5. O que NÃO muda (e por isso não aparece no mockup)

- Grid, busca, seleção, URL externa, dedup: intocados.
- Ícone `♫` e `guessMime()` para `.mp3`/`.ogg`: **já existem** e já funcionam.
- Excluir na UI: item separado do M3.
- Player, volume, sincronização: itens seguintes do M3.

## 6. Teto de tamanho — de onde saiu o número

`specs/20-assets-e-midia.md`, REQ-AST-008: *"Limites padrão: imagens 50 MB,
vídeo 500 MB, áudio 100 MB."*

O código hoje usa **20 MB para tudo** (`DEFAULT_MAX_BYTES` no servidor,
`MAX_UPLOAD_BYTES` no cliente). Este item introduz o teto **por tipo** e adota
`áudio = 100 MB` da spec. **Imagem fica em 20 MB** — subir para os 50 MB da spec
é uma mudança de comportamento que ninguém pediu neste item.

> **Suposição declarada:** a fase Plano registrou ter fechado a questão "teto de
> upload para áudio" com o dono, mas o `run-input.json` não carregou o número. O
> design adota o valor da spec (100 MB). Se o dono fechou outro número, é uma
> constante a trocar — não muda o desenho.
