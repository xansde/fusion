# Bhrotto — ajustes futuros

Ajustes já decididos pelo Alexandre, ou achados menores abertos, que ficam para depois. Cada entrada diz o que muda,
o que toca e de onde veio. O comportamento de hoje continua até alguém pegar o ajuste.

## Aplicar condição usa o alvo da rolagem

- **O que muda**: o botão "Aplicar condição" do card passa a usar o alvo da rolagem (a foto da mensagem,
  `targetSnapshot`) em vez da mira atual na hora do clique. É o que a regra pede (RAW).
- **Hoje**: sem `source.messageId`, `actor:applyCondition` aplica em quem está mirado no clique (decidido em
  2026-10-06: manter por enquanto).
- **Toca**: o contrato REQ-SYS-142 do Alquimista (ALQ-F1-09), de outra frente.
- **Origem**: I-5 da revisão da onda 7.

## Menores abertos (revisão da onda 7)

- **Caçador de Monstros**: o hook do crítico não confere que a rolagem-pai é um card `hunt-prey`.
- **"1×/dia por criatura" (DC-04)**: só exibido, não aplicado pelo servidor.
- **Companheiro órfão**: o `grantSlotId` continua o antigo no servidor depois de voltar ao sub-slot vazio.
