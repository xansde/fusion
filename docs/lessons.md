# Lições do Fusion

Aprendizados que custaram caro para descobrir. Uma seção por lição: o que
aconteceu, por que enganou, e o que fazer diferente da próxima vez.

## Peça implementada ≠ peça alcançável

**Quando:** varredura de código da fase Discovery do card "mapa jogável"
(2026-08-06).

**O que aconteceu:** a varredura procurou pela *cadeia de código* de cada
funcionalidade do DoD e concluiu que várias já existiam. Duas delas não
existiam para o usuário:

- **Indicador de alvo** — cadeia completa ponta a ponta, com teste
  (`TargetingMarker`, `combatCanvasController`). O único gatilho é um botão do
  `CombatPanel` que exige combate ativo e passa `targeted=true` fixo: nunca
  desmarca, e não há nenhum gesto no mapa que marque alvo.
- **`deleteAsset`** — exportado, testado, e sem nenhum botão na UI que o chame.

**Por que engana:** um `grep` pela função encontra a implementação, os testes
passam, e a cobertura parece honesta. O que falta não é código — é o caminho
que leva o usuário até ele.

**O que fazer:** ao mapear o que já existe, procurar o **gesto do usuário**
(clique, tecla, arraste, campo de formulário), não a cadeia de código que
responde a ele. Só depois de achar o gesto, seguir a cadeia. Funcionalidade sem
gesto é peça de reposição, não funcionalidade.
