/**
 * gen-familiar-abilities-i18n.mjs — one-off generator for the pt-BR overlay of
 * pf2e.familiar-abilities-core (r16-G4, spec 29 REQ-PET-020).
 *
 * Reads the committed pack documents.json, pairs each doc `_id` with a
 * hand-authored pt-BR name + description from TRANSLATIONS (keyed by EN name),
 * computes the canonical i18nSourceHash(name_EN, description_EN) so the server's
 * overlay staleness check accepts each entry, and writes
 * systems/pf2e/packs/familiar-abilities-core/i18n.pt-BR.json in the exact
 * format the CompendiumService expects (see actions-core/i18n.pt-BR.json).
 *
 * Clean-room: the pt-BR strings are original fan translations of the ORC/OGL EN
 * rules text; structural enricher tokens (@UUID[...], @Check[...], @Template[...],
 * @Damage[...], @Damage[...]{...} label, <span class="action-glyph">) are kept
 * verbatim — only human-readable label text is translated. Not an official
 * Paizo-BR translation.
 *
 * Run: node gen-familiar-abilities-i18n.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { i18nSourceHash } from "./src/hash.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = join(__dirname, "..", "..", "systems", "pf2e", "packs", "familiar-abilities-core");

/**
 * EN name → { name, description } pt-BR. Every one of the 111 pack docs must be
 * present; a missing entry aborts the run (so the overlay never ships partial).
 * Enricher tokens preserved verbatim; only labels translated.
 */
const TRANSLATIONS = {
  "Absorb Familiar": {
    name: "Absorver Familiar",
    description:
      "<p>Seu familiar pode se transformar em uma marca que você carrega na pele, geralmente parecendo uma mancha de nascença, tatuagem ou gema que vagamente lembra sua forma normal. Quando transformado, o familiar não pode agir exceto para voltar a ser um familiar. Ele não é afetado por efeitos de área e deve ser alvejado separadamente para ser afetado, o que exige saber que ele é uma criatura.</p> <p>Isso significa que você e seus aliados podem curar ou ajudar o familiar enquanto a maioria dos inimigos permanece sem saber de sua verdadeira natureza. Criaturas devem tentar um teste de @Check[perception|dc:20] para @UUID[Compendium.pf2e.actionspf2e.Item.Seek] para perceber que ele é de fato um familiar. Seu familiar ainda pode comunicar seus sentimentos empaticamente. Transformar o familiar entre as formas é uma atividade de 1 minuto com o traço concentração.</p>",
  },
  "Accompanist": {
    name: "Acompanhante",
    description:
      "<p>Seu familiar ajuda você a se apresentar. Sempre que você tentar um teste de Atuação, se seu familiar estiver por perto e puder agir, ele o acompanha com chilreios, palmas ou seu próprio instrumento em miniatura. Isso concede a você um bônus de circunstância +1, ou +2 se você for mestre em Atuação.</p>",
  },
  "Alchemical Gut": {
    name: "Estômago Alquímico",
    description:
      "<p>Seu familiar pode agir como um @UUID[Compendium.pf2e.equipment-srd.Item.Bomb Coagulant Alembic] engolindo a bomba a ser afetada, o que exige duas ações Interagir dele e uma sua. Seu familiar regurgita o item concentrado 1 minuto depois. Se seu familiar tentar destilar uma bomba de nível maior que o seu próprio –1, ele em vez disso sofre dano como se tivesse sido atingido com sucesso pela bomba.</p>",
  },
  "Ambassador": {
    name: "Embaixador",
    description:
      "<p>Seu familiar sabe agir de forma fofa ou concentrada sob comando, ajudando você a causar uma boa impressão.</p> <p>Apesar de ser um lacaio, seu familiar ganha 1 reação no início de seus turnos, que ele pode usar apenas para @UUID[Compendium.pf2e.actionspf2e.Item.Aid] você num teste de Diplomacia para @UUID[Compendium.pf2e.actionspf2e.Item.Make an Impression] (ele ainda precisa se preparar para ajudar você normalmente como na reação Ajudar, o que exige que ele participe ao longo da atividade).</p> <p>Ele tem sucesso automático em seu teste para Ajudar você com essas perícias, ou sucesso crítico automático se você for mestre na perícia em questão.</p>",
  },
  "Amphibious": {
    name: "Anfíbio",
    description:
      "<p>Ele ganha o traço anfíbio, permitindo respirar tanto no ar quanto na água, e tem tanto um Deslocamento terrestre quanto um Deslocamento de natação, cada um igual ao seu maior Deslocamento terrestre ou de natação.</p>",
  },
  "Animated": {
    name: "Animado",
    description:
      "<p>Com um pouco de magia do seu patrono, seu familiar-objeto pode se mover por conta própria. Ele ganha um Deslocamento de 25 pés. Você só pode selecionar esta habilidade para familiares-objeto.</p>",
  },
  "Augury": {
    name: "Augúrio",
    description:
      "<p>Seu familiar consegue vislumbrar os fios do destino para lhe dar uma pista enigmática sobre seu futuro. Seu familiar pode conjurar @UUID[Compendium.pf2e.spells-srd.Item.Augury] uma vez por dia usando sua tradição mágica e CD de magia. Você deve ter pelo menos 8º nível para selecionar esta habilidade.</p>",
  },
  "Burrower": {
    name: "Escavador",
    description:
      "<p>Ele ganha um Deslocamento de escavação de 5 pés, permitindo cavar buracos Minúsculos.</p>",
  },
  "Cantrip Connection": {
    name: "Conexão de Truque",
    description:
      "<p>Você pode preparar um truque adicional, ou, se você tem um repertório, designar um truque para adicionar ao seu repertório cada vez que selecionar esta habilidade; você pode retreiná-lo, mas não pode alterá-lo de outra forma. Você deve ser capaz de preparar truques ou adicioná-los ao seu repertório para selecionar isto.</p>",
  },
  "Climber": {
    name: "Escalador",
    description: "<p>Ele ganha um Deslocamento de escalada de 25 pés.</p>",
  },
  "Construct": {
    name: "Constructo",
    description:
      "<p>Seu familiar tem o traço constructo em vez do traço animal. O familiar é imune a efeitos de morte, doença, condenado, drenado, fatigado, cura, ataques não letais, paralisado, veneno, enjoado, espírito, inconsciente, vitalidade e vazio. Seu familiar deve ter a habilidade de mascote @UUID[Compendium.pf2e.familiar-abilities.Item.Tough] para selecionar isto.</p>",
  },
  "Damage Avoidance": {
    name: "Esquiva de Dano",
    description:
      "<p>Escolha um tipo de salvaguarda. Seu familiar não sofre dano quando obtém um sucesso naquele tipo de salvaguarda; isso não previne efeitos além do dano.</p>",
  },
  "Darkeater": {
    name: "Comedor da Escuridão",
    description:
      "<p>Seu familiar se recupera naturalmente nas sombras. Após passar 10 minutos consecutivos numa área de luz difusa ou escuridão, seu familiar recupera um número de Pontos de Vida igual à metade do seu nível.</p> <p>Esta habilidade é para um familiar sombra. Um conjurador de sombras, no entanto, pode selecionar esta habilidade para qualquer tipo de familiar.</p>",
  },
  "Darkvision": {
    name: "Visão no Escuro",
    description: "<p>Ele ganha visão no escuro.</p>",
  },
  "Dazzling Show": {
    name: "Exibição Deslumbrante",
    description:
      "<p><strong>Frequência</strong> uma vez por minuto</p><hr /><p><strong>Efeito</strong> Seu kinnara exibe suas penas brilhantes. Cada criatura dentro de uma @Template[type:emanation|distance:30] deve tentar uma salvaguarda de @Check[will|against:class-spell] contra sua CD de classe ou CD de magia, a que for maior, ou ficar @UUID[Compendium.pf2e.conditionitems.Item.Dazzled] por 2 rodadas.</p>",
  },
  "Dragon": {
    name: "Dragão",
    description: "<p>Seu familiar tem o traço dragão em vez do traço animal.</p>",
  },
  "Echolocation": {
    name: "Ecolocalização",
    description:
      "<p>Ele pode usar a audição como um sentido preciso dentro de 20 pés.</p>",
  },
  "Elemental": {
    name: "Elemental",
    description:
      "<p>Seu familiar tem o traço elemental em vez do traço animal. Escolha ar, terra, fogo, metal, água ou madeira. Seu familiar ganha aquele traço. O familiar é imune a sangramento, @UUID[Compendium.pf2e.conditionitems.Item.Paralyzed], veneno, sono e o elemento correspondente ao seu traço. Seu familiar deve ter a habilidade de familiar resistência para selecionar isto.</p>",
  },
  "Elemental Familiar (Air)": {
    name: "Familiar Elemental (Ar)",
    description:
      "<p>Seu familiar ganha o traço elemental do ar.</p> <p>Se seu familiar ficar completamente imóvel por 1 rodada, ele fica @UUID[Compendium.pf2e.conditionitems.Item.Invisible] até realizar sua próxima ação. Qualquer movimento, mesmo ser movido ou carregado por outra criatura, encerra este efeito.</p>",
  },
  "Elemental Familiar (Earth)": {
    name: "Familiar Elemental (Terra)",
    description:
      "<p>Seu familiar ganha o traço elemental da terra.</p> <p>Seu familiar ganha resistência a dano físico (exceto adamante) igual à metade do seu nível.</p>",
  },
  "Elemental Familiar (Fire)": {
    name: "Familiar Elemental (Fogo)",
    description:
      "<p>Seu familiar ganha o traço elemental do fogo.</p> <p>Seu familiar emite luz plena num raio de 20 pés (e luz difusa pelos 20 pés seguintes) e emite calor. Criaturas que permaneçam dentro de uma @Template[emanation|distance:15] não sofrem dano de frio ambiental severo.</p>",
  },
  "Elemental Familiar (Metal)": {
    name: "Familiar Elemental (Metal)",
    description:
      "<p>Seu familiar ganha o traço elemental do metal.</p> <p>Seu familiar ganha resistência a dano físico de armas de metal igual à metade do seu nível.</p>",
  },
  "Elemental Familiar (Water)": {
    name: "Familiar Elemental (Água)",
    description:
      "<p>Seu familiar ganha o traço elemental da água.</p> <p>Seu familiar pode se mover por uma fresta de pelo menos 5 cm de largura sem Espremer-se e pode Espremer-se por uma fresta de pelo menos 2,5 cm de largura.</p>",
  },
  "Elemental Familiar (Wood)": {
    name: "Familiar Elemental (Madeira)",
    description:
      "<p>Seu familiar ganha o traço elemental da madeira.</p> <p>Se seu familiar permanecer sob luz plena por 1 rodada, ele ganha cura rápida igual à metade do seu nível. Assim que sai da luz plena, este efeito termina.</p>",
  },
  "Erudite": {
    name: "Erudito",
    description:
      "<p>Seu familiar tem um conhecimento religioso incrível. Apesar de ser um lacaio, seu familiar ganha 1 reação no início de seus turnos, que ele pode usar apenas para @UUID[Compendium.pf2e.actionspf2e.Item.Aid] você num teste de Religião (ele ainda precisa se preparar para ajudar você normalmente como na reação Ajudar). Ele tem sucesso automático em seu teste para Ajudar você com testes de Religião, ou sucesso crítico automático se você for mestre em Religião.</p>",
  },
  "Extra Alchemy": {
    name: "Alquimia Extra",
    description:
      "<p>Seu familiar ajuda você a preparar itens no início do dia. Você pode criar um item adicional com @UUID[Compendium.pf2e.feats-srd.Item.Advanced Alchemy] durante suas preparações diárias. Você deve ter a habilidade Alquimia Avançada para selecionar esta habilidade.</p> <p>@UUID[Compendium.pf2e.feat-effects.Item.Effect: Extra Alchemy]</p>",
  },
  "Extra Vial": {
    name: "Frasco Extra",
    description:
      "<p>Seu familiar acumula líquidos alquímicos em seu corpo. Uma vez por dia, você pode Interagir quando seu familiar estiver adjacente a você para ganhar um frasco versátil. Você deve ter a habilidade @UUID[Compendium.pf2e.classfeatures.Item.Versatile Vials] para selecionar esta habilidade.</p>",
  },
  "Familiar Focus": {
    name: "Foco do Familiar",
    description:
      "<p>Uma vez por dia, seu familiar pode usar 2 ações com o traço concentração para restaurar 1 Ponto de Foco à sua reserva de foco, até seu máximo usual. Você deve ter uma reserva de foco para selecionar isto.</p>",
  },
  "Familiar of Balanced Luck": {
    name: "Familiar da Sorte Equilibrada",
    description:
      "<p>Seu familiar tem um ponto no corpo que parece um amuleto de boa sorte ou um mau agouro, dependendo do ângulo. Quando você Conjura ou Sustenta um feitiço, uma criatura dentro de 15 pés do seu familiar recebe, à sua escolha, um bônus de status +1 na CA dela ou uma penalidade de status –1 na CA dela até o início do seu próximo turno.</p> <p>@UUID[Compendium.pf2e.feat-effects.Item.Effect: Familiar of Balanced Luck]</p>",
  },
  "Familiar of Bolstering Aid": {
    name: "Familiar do Auxílio Fortalecedor",
    description:
      "<p>Seu familiar conhece todo tipo de truque que pode ajudar! Quando você Conjura ou Sustenta um feitiço, e seu familiar está adjacente a um aliado, aquele aliado ganha um bônus de status +2 no próximo teste de perícia que não seja de ataque que ele tentar antes do início do seu próximo turno.</p> <p>@UUID[Compendium.pf2e.feat-effects.Item.Effect: Familiar of Bolstering Aid]</p>",
  },
  "Familiar of Enticing Negotiation": {
    name: "Familiar da Negociação Sedutora",
    description:
      "<p>Seu familiar constantemente sussurra ofertas distrativas de poder, riqueza e outras tentações aos seus inimigos, mesmo que seu familiar normalmente não tenha meios de falar. Quando você Conjura ou Sustenta um feitiço e seu familiar está dentro de 10 pés de um inimigo, o inimigo fica @UUID[Compendium.pf2e.conditionitems.Item.Off-Guard] até o início do seu próximo turno. Seu familiar só pode distrair um único inimigo por rodada dessa forma.</p>",
  },
  "Familiar of Flowing Script": {
    name: "Familiar da Escrita Fluida",
    description:
      "<p>Seu familiar é coberto por um padrão que parece letras de uma língua desconhecida, uma que parece atrair atenção mesmo enquanto ilude a compreensão. Quando você Conjura ou Sustenta um feitiço, as letras começam a mudar rapidamente, causando distração. Até o início do seu próximo turno, seu familiar pode fornecer flanqueamento para você e seus aliados como se ele fosse capaz de atacar e tivesse um alcance de 5 pés; isto é um efeito visual.</p>",
  },
  "Familiar of Freezing Rime": {
    name: "Familiar da Geada Congelante",
    description:
      "<p>Seu familiar é frio ao toque, com o hálito sempre visível. Quando você Conjura ou Sustenta um feitiço, você pode fazer com que gelo se forme numa @Template[burst|distance:5] centrada num quadrado do espaço do seu familiar. Aqueles quadrados são terreno difícil até o início do seu próximo turno.</p>",
  },
  "Familiar of Insightful Observation": {
    name: "Familiar da Observação Perspicaz",
    description:
      "<p>Seu familiar ostenta um terceiro olho na cabeça ou no corpo, semelhante àquele cravado na testa de Cobyslarni. Quando você Conjura ou Sustenta um feitiço, seu familiar pode tentar um teste para Relembrar Conhecimento como uma ação livre com qualquer perícia na qual você seja treinado ou melhor, usando seu bônus, e transmitir psiquicamente a informação a você.</p>",
  },
  "Familiar of Keen Senses": {
    name: "Familiar dos Sentidos Aguçados",
    description:
      "<p>Seu familiar tem olhos brilhantes, orelhas que se contorcem ou algum outro sinal dos sentidos poderosos de uma fera. Quando você Conjura ou Sustenta um feitiço, seu familiar ganha, à sua escolha, um faro impreciso, tremorsentido ou sentido de ondas, com alcance de 60 pés até o início do seu próximo turno, e ele pode imediatamente @UUID[Compendium.pf2e.actionspf2e.Item.Point Out] como uma ação livre.</p> <p>@UUID[Compendium.pf2e.feat-effects.Item.Effect: Familiar of Keen Senses]</p>",
  },
  "Familiar of Nimble Flight": {
    name: "Familiar do Voo Ágil",
    description:
      "<p>Mesmo que seu familiar não tenha asas, ele às vezes pode se mover como se levado pelo vento. Quando você Conjura ou Sustenta um feitiço, seu familiar pode Voar até 15 pés; este movimento não desencadeia reações.</p>",
  },
  "Familiar of Obscuring Snowfall": {
    name: "Familiar da Nevasca Obscurecedora",
    description:
      "<p>Seu familiar está sempre coberto por uma fina camada de neve, que ele solta conforme necessário. Quando você Conjura ou Sustenta um feitiço, você pode fazer com que neve aderente caia numa @Template[type:burst|distance:5] centrada num quadrado do espaço do seu familiar. Essa nevasca permanece até o início do seu próximo turno, e inimigos que entrarem nesses quadrados durante esse período ficam @UUID[Compendium.pf2e.conditionitems.Item.Dazzled] até o início do seu próximo turno.</p><hr /><p><em>Nota PFS:</em> Para esta habilidade, escolha um canto do quadrado do familiar para o centro da explosão.</p>",
  },
  "Familiar of Ongoing Misery": {
    name: "Familiar da Miséria Contínua",
    description:
      "<p>Seu familiar parece hostil a todas as criaturas exceto você, sibilando para elas se chegam perto demais. Quando você Conjura ou Sustenta um feitiço, seu familiar pode amaldiçoar uma criatura dentro de 15 pés dele, prolongando uma condição negativa à sua escolha que afeta a criatura por 1 rodada. Esta extensão pode ser aplicada apenas uma vez a um dado caso de uma condição. Isto é um efeito de maldição. Isto prolonga apenas condições com duração cronometrada (como \"1 rodada\" ou \"até o fim do seu próximo turno\") e não impede que condições sejam removidas por outros meios.</p>",
  },
  "Familiar of Overwhelming Tides": {
    name: "Familiar das Marés Avassaladoras",
    description:
      "<p>Seu familiar constantemente pinga água do oceano. Quando você Conjura ou Sustenta um feitiço, você pode fazer com que uma pequena onda surja do seu familiar. Uma criatura dentro de 10 pés do seu familiar é empurrada 5 pés para longe dele.</p>",
  },
  "Familiar of Paired Perplexity": {
    name: "Familiar da Perplexidade Pareada",
    description:
      "<p>Seu familiar tem o dobro de uma pequena característica que uma criatura normal teria, como uma segunda cauda ou um par extra de bigodes. Quando você Conjura ou Sustenta um feitiço, seu familiar parece se duplicar e estar em dois lugares ao mesmo tempo. Uma criatura à sua escolha dentro de 20 pés dele fica @UUID[Compendium.pf2e.conditionitems.Item.Stupefied]{Estupidificado 1} até o início do seu próximo turno; isto é um efeito visual.</p>",
  },
  "Familiar of Parasitic Might": {
    name: "Familiar do Poder Parasita",
    description:
      "<p>Seu familiar parece esquálido e desnutrido ou de outra forma à beira da morte, embora esteja bastante saudável. Quando você Conjura ou Sustenta um feitiço, seu familiar pode drenar a força minguante de outrem para se sustentar. Uma criatura dentro de 15 pés do seu familiar com menos da metade dos seus Pontos de Vida máximos fica @UUID[Compendium.pf2e.conditionitems.Item.Sickened]{Enjoado 1} a menos que tenha sucesso numa salvaguarda de @Check[fortitude] contra sua CD de magia.</p>",
  },
  "Familiar of Restored Spirit": {
    name: "Familiar do Espírito Restaurado",
    description:
      "<p>Seu familiar é agradavelmente quente e macio, parecendo dissipar preocupações com sua mera presença. Quando você Conjura ou Sustenta um feitiço, uma criatura disposta dentro de 15 pés do seu familiar ganha Pontos de Vida temporários iguais a 2 + metade do seu nível, que duram até o início do seu próximo turno.</p> <p>@UUID[Compendium.pf2e.feat-effects.Item.Effect: Familiar of Restored Spirit]</p>",
  },
  "Familiar of Stalking Night": {
    name: "Familiar da Noite Espreitante",
    description:
      "<p>Seu familiar é escuro de pelo ou pena, e a luz parece desaparecer dentro dele. Quando você Conjura ou Sustenta um feitiço, e seu familiar está adjacente a um inimigo do qual ele está @UUID[Compendium.pf2e.conditionitems.Item.Concealed], @UUID[Compendium.pf2e.conditionitems.Item.Hidden] ou não detectado, o inimigo fica @UUID[Compendium.pf2e.conditionitems.Item.Frightened]{Amedrontado 1}.</p>",
  },
  "Familiar of Swarm's Heart": {
    name: "Familiar do Coração do Enxame",
    description:
      "<p>Seu familiar é cercado por uma nuvem de insetos inofensivos. Quando você Conjura ou Sustenta um feitiço, os insetos formam enxame para proteger você e seus aliados. Até o início do seu próximo turno, seu familiar concede @UUID[Compendium.pf2e.conditionitems.Item.Concealed]{Ocultação} a você ou qualquer aliado enquanto compartilha o mesmo espaço.</p>",
  },
  "Fast Movement": {
    name: "Movimento Veloz",
    description:
      "<p>Aumente um dos Deslocamentos do seu familiar de 25 para 40 pés.</p>",
  },
  "Flatten": {
    name: "Achatar",
    description:
      "<p>Seu familiar pode se achatar à largura de uma folha de papel, passando facilmente pelas menores frestas e brechas. Desde que uma porta ou outro obstáculo tenha uma fresta que caiba uma folha de papel, seu familiar pode passar por ela sem precisar Espremer-se.</p>",
  },
  "Flier": {
    name: "Voador",
    description: "<p>Ele ganha um Deslocamento de voo de 25 pés.</p>",
  },
  "Focused Rejuvenation": {
    name: "Rejuvenescimento Focado",
    description:
      "<p>Quando você Reconcentra, você gera energia mágica que cura seu familiar. Seu familiar recupera 1 Ponto de Vida por nível sempre que você Reconcentra.</p>",
  },
  "Fungus": {
    name: "Fungo",
    description: "<p>Seu familiar tem o traço fungo em vez do traço animal.</p>",
  },
  "Gills": {
    name: "Guelras",
    description:
      "<p>Seu familiar desenvolve um conjunto de guelras, permitindo respirar água além de ar.</p>",
  },
  "Grasping Tendrils": {
    name: "Tentáculos Agarradores",
    description:
      "<p><strong>Pré-requisitos</strong> @UUID[Compendium.pf2e.feats-srd.Item.Leshy Familiar Secrets]</p> <p>Seu familiar pode estender cipós ou tentáculos similares, aumentando seu alcance para 15 pés.</p>",
  },
  "Greater Resistance": {
    name: "Resistência Maior",
    description:
      "<p>Seu familiar aumenta a resistência que ganha de sua habilidade de familiar resistência para 3 + metade do seu nível. Seu familiar deve ter a habilidade @UUID[Compendium.pf2e.familiar-abilities.Item.Resistance] para selecionar isto.</p>",
  },
  "Independent": {
    name: "Independente",
    description:
      "<p>Num encontro, se você não Comandar seu familiar, ele ainda ganha 1 ação por rodada. Normalmente, você ainda decide como ele gasta essa ação, mas o Mestre pode determinar que seu familiar escolha suas próprias táticas em vez de realizar sua ação preferida. Isto não funciona com @UUID[Compendium.pf2e.familiar-abilities.Item.Valet] ou habilidades similares que exigem um comando, se você for capaz de cavalgar seu familiar, ou situações similares.</p>",
  },
  "Innate Surge": {
    name: "Surto Inato",
    description:
      "<p>Uma vez por dia, você pode se valer da magia inata do seu familiar para reabastecer a sua. Você pode conjurar uma magia inata obtida de um talento de ancestralidade que você já tenha conjurado hoje. Você ainda deve Conjurar a Magia e cumprir os outros requisitos da magia.</p>",
  },
  "Item Delivery": {
    name: "Entrega de Item",
    description:
      "<p>Se seu familiar está adjacente a você, você pode Comandá-lo para entregar um item. Em vez de suas 2 ações normais, seu familiar Interage para pegar um item que você está segurando de Carga leve ou menos, então realiza uma ação de movimento, e finalmente Interage para passar o item a outra criatura disposta.</p> <p>Ele pode em vez disso administrar o item à criatura se puder fazê-lo com 1 ação e tiver um tipo de item apropriado (como elixir alquímico). Se seu familiar não alcançar o alvo neste turno, ele segura o item até ser comandado de outra forma. Seu familiar deve ter a habilidade destreza manual para selecionar esta habilidade.</p>",
  },
  "Jet": {
    name: "Jato",
    description:
      "<p>Seu familiar pode usar rajadas de energia elemental ou magia para @UUID[Compendium.pf2e.actionspf2e.Item.Leap] até 30 pés em qualquer direção, mesmo que isso exceda sua distância máxima normal de salto. O Salto deve começar e terminar numa superfície sólida capaz de suportar o familiar.</p>",
  },
  "Kick Up Dust": {
    name: "Levantar Poeira",
    description:
      "<p><strong>Frequência</strong> uma vez por hora</p><hr /><p><strong>Efeito</strong> Seu coelho de poeira se sacode e chuta para levantar poeira numa @Template[type:emanation|distance:5]. Cada criatura na área deve tentar uma salvaguarda de Fortitude contra a maior entre sua CD de classe ou CD de magia. Uma criatura que falha em sua salvaguarda começa a espirrar descontroladamente e fica @UUID[Compendium.pf2e.conditionitems.Item.Slowed]{Lento 1} e não pode realizar reações por 1 rodada; numa falha crítica ela fica @UUID[Compendium.pf2e.conditionitems.Item.Slowed]{Lento 2}.</p>",
  },
  "Kindling": {
    name: "Combustível",
    description:
      "<p>Você pode imolar o corpo do seu familiar para uma onda de poder. Uma vez por dia, como uma ação livre, quando você Conjura uma Magia que tem o traço fogo, causa dano e não tem duração, você pode sacrificar seu familiar para potencializar a magia. Seu familiar é imediatamente morto, e você ganha um bônus de status ao dano daquela magia igual ao dobro da graduação da magia.</p> <p>@UUID[Compendium.pf2e.feat-effects.Item.Effect: Kindling]</p>",
  },
  "Kinspeech": {
    name: "Fala de Parentesco",
    description:
      "<p>Ele pode entender e falar com animais da mesma espécie. Para selecionar isto, seu familiar deve ser um animal, deve ter a habilidade fala, e você deve ter pelo menos 6º nível.</p>",
  },
  "Lab Assistant": {
    name: "Assistente de Laboratório",
    description:
      "<p>Ele pode usar sua ação @UUID[Compendium.pf2e.actionspf2e.Item.Quick Alchemy]. Você deve ter Alquimia Rápida, e seu familiar deve estar no seu espaço. Isto tem o mesmo custo e requisito de quando você mesmo a usa. Ele deve ter a habilidade @UUID[Compendium.pf2e.familiar-abilities.Item.Manual Dexterity] para selecionar isto.</p>",
  },
  "Levitator": {
    name: "Levitador",
    description:
      "<p>Usando magnetismo, magia ou outras forças, seu familiar pode flutuar até 3 pés acima de superfícies sólidas e líquidas enquanto se move num Deslocamento de 25 pés. Isso permite que ele ignore terreno difícil e efeitos danosos relacionados ao contato direto com a superfície. Normalmente permite que o familiar também evite acionar as reações de perigos que exigem que você pise neles ou numa placa de pressão acoplada.</p>",
  },
  "Lifelink": {
    name: "Elo de Vida",
    description:
      "<p>Se seu familiar seria reduzido a 0 PV por dano, como uma reação com o traço concentração, você pode sofrer todo o dano, e seu familiar não sofre nenhum. No entanto, efeitos especiais que ocorreriam devido àquele dano (como veneno de cobra) ainda se aplicam.</p>",
  },
  "Lightning Armillary": {
    name: "Armilar Relâmpago",
    description:
      "<p><strong>Efeito</strong> Seu familiar voa em círculos ao redor da arma ou mão de um aliado adjacente, dissolvendo-se em múltiplos anéis de relâmpago. Até o início do seu próximo turno, a arma ou ataque desarmado afetado causa 1d6 de dano de eletricidade adicional, ou 1d8 de dano de eletricidade se você Conjurar uma Magia com o traço ar ou eletricidade neste turno. Seu familiar permanece na forma de anel de relâmpago, impedindo-o de ser alvejado ou realizar quaisquer ações.</p> <p>@UUID[Compendium.pf2e.feat-effects.Item.Effect: Lightning Armillary]</p>",
  },
  "Lightning Needles": {
    name: "Agulhas de Relâmpago",
    description:
      "<p><strong>Requisitos</strong> Você Conjurou uma Magia que teve os traços ar ou eletricidade neste turno;</p><hr /><p><strong>Efeito</strong> Seu familiar absorve a carga elétrica excedente e libera uma @Template[type:emanation|distance:5] de eletricidade estática que flui pelos meridianos das criaturas. Criaturas na emanação que falham numa salvaguarda de @Check[fortitude|options:area-effect,damaging-effect] contra sua CD de magia ficam @UUID[Compendium.pf2e.conditionitems.Item.Clumsy]{Desajeitado 1} até o fim de seu próximo turno. Se uma criatura estiver encharcada ou sobre ou dentro de água dentro da emanação, ela também sofre @Damage[1d4[persistent,electricity]|options:area-damage] de dano numa salvaguarda falha.</p>",
  },
  "Luminous": {
    name: "Luminoso",
    description:
      "<p>Seu familiar brilha com uma luz reconfortante. Ele emite luz plena num raio de 30 pés e luz difusa pelos 30 pés seguintes. Ele pode suprimir ou retomar esta luz usando uma ação, que tem o traço concentração.</p>",
  },
  "Major Resistance": {
    name: "Resistência Principal",
    description:
      "<p>Seu familiar aumenta a resistência que ganha de sua habilidade de familiar @UUID[Compendium.pf2e.familiar-abilities.Item.Resistance] para um valor igual ao seu nível. Para selecionar isto você deve ter pelo menos 8º nível.</p>",
  },
  "Manual Dexterity": {
    name: "Destreza Manual",
    description:
      "<p>Ele pode usar até dois de seus membros como se fossem mãos para realizar ações de manipulação.</p>",
  },
  "Mask Freeze": {
    name: "Congelar Máscara",
    description:
      "<p>Quando na forma de máscara, seu familiar pode ocultar suas qualidades sobrenaturais óbvias para passar por uma máscara simples e despretensiosa. Ele não precisa Personificar para enganar um olhar de passagem, e ganha um bônus de circunstância +4 à sua CD de Enganação contra um observador ativo Procurando ou de outra forma estudando-o.</p>",
  },
  "Mass-Produced": {
    name: "Produzido em Massa",
    description:
      "<p>Se seu shikigami morrer, você pode religar seu espírito a outra boneca de papel durante suas próximas preparações diárias.</p>",
  },
  "Master's Form": {
    name: "Forma do Mestre",
    description:
      "<p>Seu familiar pode mudar de forma como uma ação única, transformando-se num humanoide da sua ancestralidade com a mesma idade, gênero e compleição de sua forma verdadeira, embora ele sempre mantenha um resquício claramente antinatural de sua natureza, como olhos de gato ou língua de serpente. Esta forma é sempre a mesma cada vez que ele usa esta habilidade. Isto de outra forma usa os efeitos de @UUID[Compendium.pf2e.spells-srd.Item.Humanoid Form], exceto que a mudança é puramente cosmética. Ele apenas parece humanoide e não ganha novas capacidades. Seu familiar deve ter as habilidades destreza manual e fala para selecionar isto.</p>",
  },
  "Medic": {
    name: "Médico",
    description:
      "<p>Seu familiar pode se valer do poder da sua divindade para @UUID[Compendium.pf2e.actionspf2e.Item.Cast a Spell] uma vez por dia. O familiar pode conjurar a versão de 1 ação de @UUID[Compendium.pf2e.spells-srd.Item.Heal] num nível 2 níveis abaixo do seu espaço de magia de maior graduação, que ele só pode conjurar em você. Você deve ser capaz de conjurar magias de 3ª graduação de espaços de magia para selecionar esta habilidade.</p>",
  },
  "Partner in Crime": {
    name: "Parceiro do Crime",
    description:
      "<p>Seu familiar é seu associado criminoso. Apesar de ser um lacaio, seu familiar ganha 1 reação no início de seus turnos, que ele pode usar apenas para Ajudar você num teste de perícia de Enganação ou Ladinagem (ele ainda precisa se preparar para ajudar você normalmente como na reação Ajudar). Ele tem sucesso automático em seu teste para Ajudar você com essas perícias, ou sucesso crítico automático se você for mestre na perícia em questão.</p>",
  },
  "Path of the Tempest": {
    name: "Caminho da Tempestade",
    description:
      "<p><strong>Frequência</strong> uma vez por 10 minutos;</p><hr /><p><strong>Efeito</strong> Seu familiar invoca ventos que aceleram e protegem você. Você ganha um bônus de status de +10 pés ao seu Deslocamento até o fim do seu turno. Quando você Desloca-se neste turno, você não desencadeia reações. Além disso, você não precisa Deslocar-se antes de um @UUID[Compendium.pf2e.actionspf2e.Item.Long Jump] neste turno.</p> <p>@UUID[Compendium.pf2e.feat-effects.Item.Effect: Path of the Tempest]</p>",
  },
  "Plant": {
    name: "Planta",
    description: "<p>Seu familiar tem o traço planta em vez do traço animal.</p>",
  },
  "Plant Form": {
    name: "Forma de Planta",
    description:
      "<p>Seu familiar-planta pode mudar de forma como uma ação única, transformando-se numa planta Minúscula de um tipo mais ou menos similar à natureza do familiar. Isto de outra forma usa os efeitos de @UUID[Compendium.pf2e.spells-srd.Item.One with Plants]. Você deve ter um familiar com o traço planta para selecionar esta habilidade.</p>",
  },
  "Play Dead": {
    name: "Fingir-se de Morto",
    description:
      "<p>Seu familiar finge estar inanimado, escondendo suas capacidades sobrenaturais. Ele pode Esconder-se sem qualquer cobertura ou ocultação de criaturas que não percebem que ele está vivo, desde que esteja num local onde ele não pareceria fora de lugar. Se o familiar tem sucesso, os observadores ainda o veem, mas o confundem com um objeto inanimado. Depois de serem enganados uma vez, eles percebem que seu familiar está vivo, e ele não pode mais se Esconder deles dessa forma.</p>",
  },
  "Poison Reservoir": {
    name: "Reservatório de Veneno",
    description:
      "<p>Seu familiar tem um reservatório para veneno, permitindo aplicar um veneno de contusão na arma exposta de um aliado adjacente com uma única ação Interagir. Você deve fornecer o veneno e infundi-lo neste reservatório usando duas ações Interagir consecutivas. Você deve ter um familiar homúnculo para selecionar esta habilidade.</p>",
  },
  "Pot of Tea": {
    name: "Bule de Chá",
    description:
      "<p>Seu sábio tapir é treinado na arte da medicina herbal e pode preparar um bule de chá curativo. Uma vez por dia, seu familiar pode gastar 10 minutos para preparar folhas de chá finas e ervas. O sábio tapir deve se concentrar no chá durante esse tempo — se ele realizar qualquer outra ação, o chá fica estragado, embora o sábio tapir possa começar de novo. Uma vez que o bule de chá esteja pronto, o sábio tapir pode servir duas xícaras de chá com cada uma das ações abaixo; cada vez, ele dá 1 xícara a um aliado adjacente e bebe 1 xícara ele mesmo. As três infusões devem ser servidas e oferecidas em ordem (por exemplo, o sábio tapir não pode servir a segunda infusão até ter servido a primeira). O chá permanece bom por 1 hora após o preparo; se não for bebido até então, o bule esfria, e qualquer chá restante perde seu poder.</p><ul><li><strong>Primeira Infusão</strong> <span class=\"action-glyph\">2</span> A infusão restaura um número de Pontos de Vida igual a 1d8 vezes metade do seu nível (mínimo 1d8) e concede um bônus de circunstância +4 à próxima salvaguarda contra doença ou veneno tentada dentro de 24 horas.</li><li><strong>Segunda Infusão</strong> <span class=\"action-glyph\">2</span> A infusão restaura um número de Pontos de Vida igual a 1d4 vezes metade do seu nível (mínimo 1d4) e concede um bônus de circunstância +2 à próxima salvaguarda contra doença ou veneno tentada dentro de 24 horas.</li><li><p><strong>Terceira Infusão</strong> <span class=\"action-glyph\">2</span> A infusão concede Pontos de Vida temporários iguais ao seu nível por 1 hora.</p></li></ul>",
  },
  "Purify Air": {
    name: "Purificar Ar",
    description:
      "<p><strong>Pré-requisitos</strong> @UUID[Compendium.pf2e.feats-srd.Item.Leshy Familiar Secrets]</p> <p>Seu familiar recicla o ar, fornecendo oxigênio suficiente para uma criatura Média em áreas com ar viciado, como uma câmara selada ou espaço extradimensional. Se o leshy estiver dentro da área de um efeito de veneno inalado ou um efeito que depende do olfato, criaturas dentro de uma @Template[emanation|distance:15] do leshy ganham um bônus de circunstância +2 às suas salvaguardas contra o efeito.</p>",
  },
  "Radiant": {
    name: "Radiante",
    description:
      "<p>Seu familiar é preenchido com uma radiância divina que o torna resistente às forças do mal. Seu familiar ganha resistência a dano do mal e do vazio igual à metade do seu nível.</p> <p><em>Nota: Como efeitos colocados num ator não podem referenciar dados de outro ator, a resistência de metade do nível do PC não é automatizável. Atualize as resistências do familiar de acordo.</em></p>",
  },
  "Recall Familiar": {
    name: "Reconvocar Familiar",
    description:
      "<p>Uma vez por dia, você pode usar uma atividade de 3 ações, que tem o traço concentração, para teleportar seu familiar ao seu espaço. Seu familiar deve estar dentro de 1 milha ou a tentativa de convocá-lo falha. Isto é um efeito de teleporte.</p>",
  },
  "Resistance": {
    name: "Resistência",
    description:
      "<p>Escolha dois dos seguintes: ácido, frio, eletricidade, fogo, veneno ou sônico. Seu familiar ganha resistência igual à metade do seu nível (resistência mínima 1) contra os tipos de dano escolhidos.</p>",
  },
  "Restorative Familiar": {
    name: "Familiar Restaurador",
    description:
      "<p>Uma vez por dia, seu familiar pode usar 2 ações com o traço concentração para ceder parte de sua energia e curar você. Ele deve estar no seu espaço para fazê-lo. Você restaura um número de Pontos de Vida igual a @Damage[(max(floor(@actor.level/2),1))d8[healing]]{1d8 vezes metade do seu nível} (mínimo 1d8).</p>",
  },
  "Scent": {
    name: "Faro",
    description:
      "<p>Ele pode usar o faro como um sentido impreciso dentro de 30 pés.</p>",
  },
  "Seal-Bearer": {
    name: "Portador do Selo",
    description:
      "<p>Durante suas preparações diárias, você pode inscrever um símbolo ou selo em seu shikigami que corresponda ao elemento ar, terra, fogo, metal, água ou madeira. Se você usar a habilidade combustível do shikigami naquele dia, ela se aplica a uma magia que cause dano com o traço relevante ao elemento escolhido, em vez de apenas ao traço fogo.</p>",
  },
  "Second Opinion": {
    name: "Segunda Opinião",
    description:
      "<p>Seu familiar é seu confidente acadêmico. Apesar de ser um lacaio, seu familiar ganha 1 reação no início de seus turnos, que ele pode usar apenas para @UUID[Compendium.pf2e.actionspf2e.Item.Aid] você num teste de perícia para Relembrar Conhecimento com uma perícia na qual ele tem a habilidade de familiar @UUID[Compendium.pf2e.familiar-abilities.Item.Skilled] (ele ainda precisa se preparar para ajudar você normalmente como na reação Ajudar).</p> <p>Ele tem sucesso automático em seu teste para Ajudar você com essas perícias, ou sucesso crítico automático se você for mestre na perícia em questão. Seu familiar deve ter a habilidade habilidoso para selecionar isto.</p>",
  },
  "Shadow Projection": {
    name: "Projeção de Sombra",
    description:
      "<p>Seu makhluk wayang projeta sua sombra numa silhueta maior de si mesmo, permitindo-lhe agarrar coisas fora de seu alcance óbvio. Ele aumenta seu alcance para 10 pés para fins de realizar ações Interagir não hostis até o fim do seu turno.</p>",
  },
  "Shadow Step": {
    name: "Passo Sombrio",
    description:
      "<p>Esta habilidade é para um Familiar Sombra. Um @UUID[Compendium.pf2e.feats-srd.Item.Shadowcaster Dedication]{Conjurador de Sombras}, no entanto, pode selecionar esta habilidade para qualquer tipo de familiar. Seu familiar ganha a ação @UUID[Compendium.pf2e.actionspf2e.Item.Shadow Step].</p> <p>Você deve ter pelo menos 7º nível para selecionar esta habilidade de familiar para seu familiar.</p>",
  },
  "Share Senses": {
    name: "Compartilhar Sentidos",
    description:
      "<p>Uma vez a cada 10 minutos, você pode usar uma ação única com o traço concentração para projetar seus sentidos em seu familiar. Quando você faz isso, você perde toda a informação sensorial do seu próprio corpo, mas pode sentir através do corpo do seu familiar por até 1 minuto. Você pode Dispensar este efeito.</p>",
  },
  "Skilled": {
    name: "Habilidoso",
    description:
      "<p>Escolha uma perícia que não seja Acrobacia ou Furtividade. O modificador do seu familiar para aquela perícia é igual ao seu nível mais o modificador do seu atributo de conjuração, em vez de apenas o seu nível. Você pode selecionar esta habilidade repetidamente, escolhendo uma perícia diferente cada vez.</p>",
  },
  "Snoop": {
    name: "Bisbilhoteiro",
    description:
      "<p>Seu familiar mantém os olhos e ouvidos abertos, pronto para relatar cada fragmento de fofoca que capta, ajudando você a reunir informações.</p> <p>Apesar de ser um lacaio, seu familiar ganha 1 reação no início de seus turnos, que ele pode usar apenas para @UUID[Compendium.pf2e.actionspf2e.Item.Aid] você num teste de Diplomacia para @UUID[Compendium.pf2e.actionspf2e.Item.Gather Information] (ele ainda precisa se preparar para ajudar você normalmente como na reação Ajudar, o que exige que ele participe ao longo da atividade).</p> <p>Ele tem sucesso automático em seu teste para Ajudar você com essas perícias, ou sucesso crítico automático se você for mestre na perícia em questão.</p>",
  },
  "Soul Bond": {
    name: "Vínculo de Alma",
    description:
      "<p>Os espíritos dos seus kinnars são intrinsecamente ligados. Embora sejam dois seres, ainda são considerados uma única criatura, agem como uma única criatura, usam estatísticas normais de familiar e estão sujeitos a todos os efeitos normais que vêm com ser uma única criatura. Seus espíritos ligados permitem que evitem ataques contra sua mente. Se seus kinnars forem submetidos a um efeito mental que permite uma salvaguarda, eles rolam duas vezes e ficam com o resultado mais alto; isto é um efeito de fortuna.</p>",
  },
  "Soul Sight": {
    name: "Visão da Alma",
    description:
      "<p>Seu familiar ganha @UUID[Compendium.pf2e.bestiary-ability-glossary-srd.Item.Lifesense] com alcance de 30 pés.</p>",
  },
  "Speech": {
    name: "Fala",
    description: "<p>Ele entende e fala um idioma que você conhece.</p>",
  },
  "Spell Battery": {
    name: "Bateria de Magia",
    description:
      "<p>Você ganha um espaço de magia adicional pelo menos 3 graduações abaixo do seu espaço de magia de maior graduação; você deve ser capaz de conjurar magias de 4ª graduação usando espaços de magia para selecionar esta habilidade de mestre.</p>",
  },
  "Spell Delivery": {
    name: "Entrega de Magia",
    description:
      "<p>Se seu familiar está no seu espaço, você pode conjurar uma magia com alcance de toque, transferir seu poder ao familiar e comandar o familiar para entregar a magia. Se você fizer isso, o familiar usa suas 2 ações da rodada para se mover até um alvo à sua escolha e tocar aquele alvo. Se ele não alcançar o alvo para tocá-lo neste turno, a magia não tem efeito.</p>",
  },
  "Spellcasting": {
    name: "Conjuração",
    description:
      "<p>Escolha uma magia em seu repertório ou que você preparou hoje pelo menos 5 graduações abaixo do seu espaço de magia de maior graduação. Seu familiar pode Conjurar aquela Magia uma vez por dia usando sua tradição mágica, modificador de ataque de magia e CD de magia. Se a magia tem uma desvantagem que afeta o conjurador, tanto você quanto seu familiar são afetados. Você deve ser capaz de conjurar magias de 6ª graduação usando espaços de magia para selecionar isto.</p>",
  },
  "Spirit Touch": {
    name: "Toque Espiritual",
    description:
      "<p>Seu familiar pode tocar criaturas incorpóreas. Se você tem a habilidade de mestre entrega de magia do seu familiar, qualquer magia que o familiar entregue com ela ganha os benefícios da runa de propriedade <em>@UUID[Compendium.pf2e.equipment-srd.Item.Ghost Touch]</em>.</p>",
  },
  "Stunning Flare": {
    name: "Clarão Atordoante",
    description:
      "<p><strong>Frequência</strong> uma vez por 10 minutos;</p><hr /><p><strong>Efeito</strong> Seu fogo-fátuo de lanterna libera uma grande explosão de chamas, lançando uma luz anormalmente brilhante. Cada criatura dentro de uma @Template[type:emanation|distance:15] deve tentar uma salvaguarda de @Check[fortitude|against:class-spell] contra sua CD de classe ou CD de magia, a que for maior, ou ficar @UUID[Compendium.pf2e.conditionitems.Item.Blinded] por 1 rodada e então @UUID[Compendium.pf2e.conditionitems.Item.Dazzled] por 2 rodadas depois.</p>",
  },
  "Synchronize Spirit": {
    name: "Sincronizar Espírito",
    description:
      "<p>Você pode sincronizar sua energia espiritual com a do seu familiar para temporariamente se tornar parte espírito você mesmo. Uma vez por rodada, você pode Sustentar para sincronizar seu espírito com o do seu familiar. Você permanece sincronizado com seu espírito até o início do seu próximo turno. Enquanto sincronizado, sempre que você Golpear ou Conjurar uma Magia sem duração que cause dano, você causa dano de espírito em vez do seu dano normal.</p>",
  },
  "Tattoo Transformation": {
    name: "Transformação em Tatuagem",
    description:
      "<p>Seu familiar pode se transformar numa tatuagem que você carrega na pele. Quando transformado em tatuagem, o familiar parece uma versão colorida e estilizada de si mesmo e não pode agir exceto para voltar a ser um familiar. Ele não é afetado por efeitos de área e deve ser alvejado separadamente para ser afetado, o que exige saber que ele é uma criatura. Isso significa que você e seus aliados podem curar ou ajudar o familiar enquanto a maioria dos inimigos permanece sem saber de sua verdadeira natureza. Criaturas devem tentar um teste de @Check[perception|dc:20|showDC:all] para Procurar para perceber que uma tatuagem é de fato um familiar (o que poucos inimigos tentarão). Seu familiar ainda pode comunicar seus sentimentos empaticamente. Transformar-se em tatuagem ou voltar à forma de familiar é uma atividade de 1 minuto com o traço concentração.</p>",
  },
  "Threat Display": {
    name: "Exibição de Ameaça",
    description:
      "<p>Seu familiar ajuda você a transmitir ameaças sem palavras através de linguagem corporal.</p> <p>Sempre que você tentar um teste de Intimidação para @UUID[Compendium.pf2e.actionspf2e.Item.Demoralize] uma criatura, se seu familiar estiver dentro de 30 pés do seu alvo e puder agir, ele o acompanha com rosnados, sibilos ou eriçando os pelos.</p> <p>Se ele puder fazê-lo, você não sofre a penalidade normal de -4 no teste de Intimidação caso seu alvo não entenda o idioma que você está falando.</p>",
  },
  "Toolbearer": {
    name: "Porta-Ferramentas",
    description:
      "<p>Seu familiar pode carregar um kit de ferramentas de até Carga leve. Desde que seu familiar esteja adjacente a você, você pode sacar e guardar as ferramentas como parte da ação que as usa, como se você as estivesse vestindo. Seu familiar deve ter a habilidade destreza manual para selecionar isto.</p>",
  },
  "Touch Telepathy": {
    name: "Telepatia por Toque",
    description:
      "<p>Seu familiar pode se comunicar telepaticamente com você via toque. Se ele também tem a habilidade fala, ele pode se comunicar telepaticamente via toque com qualquer criatura se elas compartilharem um idioma.</p>",
  },
  "Tough": {
    name: "Resistente",
    description: "<p>Os PV máximos do seu familiar aumentam em 2 por nível.</p>",
  },
  "Tremorsense": {
    name: "Tremorsentido",
    description:
      "<p>Seu familiar percebe agudamente quaisquer vibrações que trafegam por uma superfície. Ele ganha tremorsentido impreciso com alcance de 30 pés.</p>",
  },
  "Valet": {
    name: "Assistente Pessoal",
    description:
      "<p>Você pode comandar seu familiar para lhe entregar itens de forma mais eficiente. Seu familiar não usa suas 2 ações imediatamente ao seu comando. Em vez disso, até duas vezes antes do fim do seu turno, você pode fazer seu familiar Interagir para pegar um item de Carga leve ou desprezível que você está vestindo e colocá-lo em uma de suas mãos livres. O familiar não pode usar esta habilidade para pegar itens guardados. Se o familiar tem um número diferente de ações, ele pode pegar um item para cada ação que tem quando comandado dessa forma.</p>",
  },
  "Verdant Burst": {
    name: "Explosão Verdejante",
    description:
      "<p><strong>Pré-requisitos</strong> @UUID[Compendium.pf2e.feats-srd.Item.Leshy Familiar Secrets]</p> <p>Quando seu familiar morre, ele libera sua energia primal para conjurar a versão de 3 ações de @UUID[Compendium.pf2e.spells-srd.Item.Heal], intensificada para uma graduação 1 abaixo do seu espaço de magia de maior graduação. A magia <em>curar</em> ganha um bônus de status igual ao dobro da graduação da magia aos Pontos de Vida que ela restaura a plantas. Você deve ser capaz de conjurar magias de 2ª graduação usando espaços de magia para selecionar esta habilidade de familiar.</p>",
  },
  "Versatile Form": {
    name: "Forma Versátil",
    description:
      "<p>O corpo fabricado do seu familiar permite que você faça ajustes nele quando necessário. Uma vez por dia, você pode gastar 10 minutos para trocar uma habilidade de familiar ou de mestre que seu familiar possui. Para selecionar esta habilidade, seu familiar deve ser um constructo, e você deve ser pelo menos treinado em Ofício.</p>",
  },
  "Vina Song": {
    name: "Canção de Vina",
    description:
      "<p><strong>Frequência</strong> uma vez por hora, veja abaixo</p><hr /><p><strong>Efeito</strong> Sua kinnari toca elegantemente seu instrumento. Cada criatura dentro de uma @Template[type:emanation|distance:30] deve tentar uma salvaguarda de Vontade contra sua CD de classe ou CD de magia, a que for maior, ou ficar @UUID[Compendium.pf2e.conditionitems.Item.Fascinated] por 1 rodada. Uma kinnar pode usar esta habilidade novamente na rodada seguinte para continuar a canção e forçar as criaturas afetadas a tentar outra salvaguarda de Vontade; numa falha, a criatura fica fascinada por uma rodada adicional. Uma vez que a kinnar pare de tocar, ela não pode usar esta habilidade novamente por 1 hora. Uma criatura que tem sucesso em qualquer salvaguarda ou tem sua fascinação quebrada fica temporariamente imune à Canção de Vina daquela kinnar por 24 horas. Kinnars são imunes a esta habilidade.</p>",
  },
  "Wavesense": {
    name: "Sentido de Ondas",
    description:
      "<p>Seu familiar pode sentir vibrações na água. Ele ganha sentido de ondas impreciso com alcance de 30 pés.</p>",
  },
};

// ---------------------------------------------------------------------------

function main() {
  const docsPath = join(PACK_DIR, "documents.json");
  const docs = JSON.parse(readFileSync(docsPath, "utf8"));

  const entries = {};
  const missing = [];

  for (const doc of docs) {
    const tr = TRANSLATIONS[doc.name];
    if (!tr) {
      missing.push(doc.name);
      continue;
    }
    // Source EN description as stored in documents.json (post-strip prose).
    const descEn = doc.system?.description ?? "";
    entries[doc._id] = {
      name: tr.name,
      sourceHash: i18nSourceHash(doc.name, descEn),
      description: tr.description,
    };
  }

  if (missing.length > 0) {
    console.error(`[gen-fam-i18n] ${missing.length} docs SEM tradução:`);
    for (const m of missing) console.error("  - " + m);
    process.exit(1);
  }

  const overlay = {
    schemaVersion: 1,
    packId: "pf2e.familiar-abilities-core",
    locale: "pt-BR",
    generatedAt: new Date().toISOString(),
    generator: "tools/translate-packs/gen-familiar-abilities-i18n.mjs",
    attribution:
      "Tradução pt-BR derivada (fan-content) do texto ORC/OGL em inglês do pack; NÃO é a tradução oficial brasileira. Texto-fonte: foundryvtt/pf2e (ORC/OGL por documento).",
    entries,
  };

  const outPath = join(PACK_DIR, "i18n.pt-BR.json");
  writeFileSync(outPath, JSON.stringify(overlay, null, 2) + "\n", "utf8");
  console.log(
    `[gen-fam-i18n] escrito ${outPath} — ${Object.keys(entries).length}/${docs.length} entradas`,
  );
}

main();
