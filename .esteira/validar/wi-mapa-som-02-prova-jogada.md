# Prova jogada — som ambiente sincronizado (M3)

**Branch:** `feat/wi-mapa-som-01` (base `main`/`b337755`) — 11 commits, `27b3b42`
**Data:** 2026-08-08
**Quem decide:** o dono. Esta prova NÃO foi rodada por mim.

---

## Por que a suíte não basta

4218 testes verdes conviveram com um player que não tocava nada: a URL entregue
ao Howler era o nome puro do asset, que o navegador resolvia contra a página e
404ava. O defeito só apareceu ao inspecionar o argumento que chega na biblioteca
externa. É a lição do repo (`docs/lessons.md`) repetindo: o gesto do usuário é o
único juiz. Ouvir a faixa nos dois navegadores é a prova.

## Pré-requisitos

1. `pnpm build` do client **e reiniciar o servidor** — o servidor lê o
   `index.html` no boot (lição já registrada).
2. Duas telas: uma sessão de GM e uma de jogador (dois navegadores ou uma janela
   anônima).
3. Um `.mp3` e um `.ogg` de verdade à mão.

## Roteiro

### A — a faixa entra na biblioteca

1. Abrir a aba **Som** na sidebar → como GM, "Escolher faixa".
2. Arrastar o `.mp3` para a área de upload → card com ícone ♪ aparece na grade.
3. Repetir com o `.ogg`.
4. Tentar um `.wav` → recusado por tipo, sem card.

### B — o play chega aos dois lados (o item existe para isto)

5. GM escolhe a faixa e clica **Play** → a música começa **nas duas telas**.
6. GM clica **Stop** → silêncio nas duas telas.

### C — quem chega atrasado entra no lugar certo

7. GM dá Play. Esperar ~40 segundos.
8. Recarregar a tela do jogador → a música volta **de onde a mesa está** (não do
   início), com folga de uns 2 segundos. Este é o passo que prova o `startedAt`
   do servidor.

### D — volume é de cada um

9. Jogador arrasta o slider para ~20% → só a tela dele abaixa; a do GM não muda.
10. Recarregar a tela do jogador → o volume dele continua em 20%.

### E — o portão

11. A tela do jogador **não** mostra os botões de escolher faixa / Play / Stop —
    só o nome da faixa e o slider.
12. Com o servidor rodando, reiniciá-lo com a faixa tocando → ao reconectar, a
    mesa volta com a faixa (o estado é persistido, não vive só na memória).

### F — autoplay bloqueado (o caso que quase ficou mudo)

13. Abrir a tela do jogador em aba nova **sem clicar em nada** e com a faixa já
    tocando → aparece o aviso "clique para ativar áudio", sem modal bloqueante.
14. Clicar em qualquer lugar → a música entra, **na posição da mesa**.

### G — não-regressão da curadoria

15. Abrir "criar cena" → o card do `.mp3` **não** aparece na grade (antes
    aparecia e podia virar fundo de cena).
16. Arrastar o `.mp3` para o picker de imagem → recusado com mensagem nomeando o
    escopo.
17. Subir um `.png` normal continua funcionando.
18. Como GM, excluir um asset pelo botão da grade (dois cliques para confirmar) →
    some da lista. Como jogador, o botão não existe.

## O que fica em aberto, independente do resultado

- **Teto de áudio (100 MB)** segue como suposição herdada da spec 20; se o número
  acordado for outro, é uma constante em `upload-limits.ts` + a cópia de UX.
- **Escopo deliberadamente fora:** playlist, fila, crossfade, troca de faixa por
  cena, sons ambientes posicionais no canvas. Tudo isso é spec 13 além do M3.
