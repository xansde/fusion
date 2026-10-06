# Bhrotto Raiz-funda 100% jogável — decisões (2026-10-05)

Frente para tornar jogável o Bhrotto Raiz-funda (campanha A Queda, jogador Flávio): Ranger 3 Leshy
(Root Leshy), Wildborne, Outwit, dois companheiros jovens (urso e antílope-montaria) via Animal Companion +
Beastmaster Dedication. Base: `alfa/app` 2cd67095 + satélite `v0.3.20`. Levantamento:
`.fusion-build/bhrotto/L-ficha.md` (achados B1–B14).

## Decisões do Alexandre

| ID    | Tema                               | Decidido                                                                                                                                                                                                                                                          |
| ----- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-B01 | Números do companheiro             | **Derivados por tipo + estágio.** Pack homebrew de tipos de companheiro (urso e antílope agora, extensível) e um passo de derivação que calcula PV, CA, saves, perícias e golpes a partir do nível do dono e do estágio (jovem, maduro, incrível, ágil/selvagem). |
| D-B02 | Recálculo                          | **No servidor.** Mudou o dono, o servidor re-deriva os companheiros ligados a ele (fecha a Q-PET-02).                                                                                                                                                             |
| D-B03 | Montaria                           | **Combate Montado completo**: estado montado, token do cavaleiro anda com o da montaria, regras de Combate Montado (penalidades, ações da montaria, Apoio montado).                                                                                               |
| D-B04 | Tela dos companheiros              | **Ficha própria só.** Cada companheiro é um ator com ficha própria (cabeçalho "pertence a …"); a ficha do Bhrotto só tem os vínculos. Sem aba Pets para ele.                                                                                                      |
| D-B05 | Presa (Caçar Presa)                | **Marca real no token.** Usar Caçar Presa com um alvo marca aquele token; os bônus de Astúcia e do Caçador de Monstros só valem contra ele. Exige alvo persistente e a ficha saber o alvo da rolagem.                                                             |
| D-B06 | Runas                              | **Editor de runas na arma** (potência, striking, propriedade), genérico para qualquer arma.                                                                                                                                                                       |
| D-B07 | Wildborne                          | **Curado da fonte ORC** (Howl of the Wild), sem texto nem arte da Paizo, conferido pelo Alexandre.                                                                                                                                                                |
| D-B08 | Dependências de outras frentes     | **Trazer para este plano** as peças planejadas no Guerreiro (alvo, contexto de ataque) e no Alquimista (expiração de efeito, ganchos de turno, rule elements) de que o Bhrotto precisa, seguindo os contratos já desenhados lá.                                   |
| D-B09 | Criação dos companheiros           | **Pelo Plano.** O talento Animal Companion abre um sub-slot "escolher companheiro" (tipo) que cria o ator ligado; a Beastmaster Dedication abre um segundo. O jogador faz sozinho.                                                                                |
| D-B10 | Comandar e Apoio                   | **Automático.** Na ficha do companheiro, Comandar posta o card; Apoio aplica no dono o efeito do benefício (urso: +1d8 cortante contra o alvo; antílope: sangramento persistente montado), que expira sozinho no início do próximo turno do dono.                 |
| D-B11 | Limite de tamanho (Titan Wrestler) | **Checado com alvo.** Agarrar, Empurrar e Derrubar contra um alvo checam o tamanho (até 1 acima; Titan Wrestler, até 2).                                                                                                                                          |
| D-B12 | Noble Bloom                        | **Pode, como exceção do Mestre.** O Plano marca o talento como liberado pelo Mestre (o Acesso pede a herança crisântemo).                                                                                                                                         |
| D-B13 | Riqueza do nível 3                 | **O Mestre ajusta a carteira.** Sem regra automática de riqueza por nível.                                                                                                                                                                                        |

## Pendências do jogador (não preencher)

Idiomas · general feat do nível 1 (o PDF sugere Toughness, PV 49) · Ocultismo ou Religião da regra da casa ·
qual companheiro vem de cada talento.

## Revisão do protótipo fiel (Alexandre, 2026-10-05)

| ID    | Tema                              | Decidido                                                                                                                                                                                                                                                                                                                                           |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-B14 | Escolha do tipo de companheiro    | O seletor de tipo mostra também a ação/habilidade que o companheiro ganha ao virar **Maduro** (e os avanços seguintes), mesmo sem cumprir o requisito ainda — serve para planejar o personagem.                                                                                                                                                    |
| D-B15 | Tipo repetido                     | Pode escolher o **mesmo tipo mais de uma vez** (ex.: dois ursos).                                                                                                                                                                                                                                                                                  |
| D-B16 | Estados de combate citam a arma   | O texto de um estado nunca pode ficar preso ao nome de uma arma antiga. Se acompanhar a arma equipada for complexo, **não citar a arma**: descrever o efeito genérico (ex.: "reduz em um o passo do dado da arma").                                                                                                                                |
| D-B17 | Manobras de Atletismo             | **Fora da tela de combate do protótipo** (já existem na aba Ações) — evita overengineering. A checagem de tamanho (D-B11) continua valendo na ação.                                                                                                                                                                                                |
| D-B18 | Texto "contra a presa"            | Generalizar: **"Contra a presa"**, nunca o nome do alvo ("Contra o ogro").                                                                                                                                                                                                                                                                         |
| D-B19 | Editor de runas                   | A lógica de edição foi aprovada. Ajustes: o rótulo "dados" ficou confuso; "Golpeadora" não agradou como tradução de _striking_ (tradução em aberto); o nível da runa (Golpeadora/Maior/…) não pode ficar só dentro do selecionável — o nome do campo tem de dizer o que se escolhe. Regra detalhada das runas a explicar antes de decidir o resto. |
| D-B20 | Validação de runas                | **Sem aviso nem bloqueio**: o editor de runas é livre (o Mestre confia nos jogadores).                                                                                                                                                                                                                                                             |
| D-B21 | Tradução de _striking_            | **"Runa de ataque"** (e as versões maior/suprema). O campo mostra o efeito em dados de dano.                                                                                                                                                                                                                                                       |
| D-B22 | Avanços do companheiro no seletor | Mostrar "a partir de Maduro" **sem** citar nível de classe: Maduro vem de um talento opcional (Mature Animal Companion), não de um nível automático.                                                                                                                                                                                               |
| D-B23 | Faixa "Estados de combate"        | Aprovada, mas compacta: cada estado mostra **só o nome**; clicar no nome mostra o efeito. Evita a faixa crescer demais com o tempo.                                                                                                                                                                                                                |

## Respostas às decisões do plano (Alexandre, 2026-10-05)

DC-01 antecipar o merge da `feat/alquimista` (ondas 1–5) em `alfa/app` · DC-08 o companheiro **ativo** herda
Caçar Presa e Astúcia · **DC-10: o jogador continua editando a própria carteira** (o Mestre só ganha "Ajustar
carteira"; refina a D-B13) · DC-02..07, DC-09, DC-11, DC-12 como recomendado em `tasks.md` §1.

## Escolhas do jogador (Alexandre, 2026-10-05)

General feat extra do nível 1: **Toughness** · regra da casa: **Ocultismo** · **urso** vem do Animal Companion
(classe), **antílope** da Beastmaster Dedication (arquétipo) · Wildborne é de um livro **Lost Omens** (DC-12
desbloqueada: curar da fonte). Pendente: idiomas.
