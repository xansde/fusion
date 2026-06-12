# ETMOS RPG — Pesquisa Exaustiva de Fontes Locais

> Documento de pesquisa para o projeto FUSION VTT.
> Fontes primárias: `SRD-ETMOS-1.1.pdf` (SRD oficial, v1.1), `Ficha-final.pdf`, `particulas-v3.pdf`, `ocr_particulas.txt`, `ocr_ficha.txt`.
> Fontes secundárias (Quickstart): `etmos_full.txt` + `etmos sistema.pdf`.
> Pesquisador: agente Claude Code, 2026-06-11.
> Atualização: integração do SRD completo e ficha oficial.

---

## 0. Licença e Copyright

O SRD-ETMOS-1.1.pdf é identificado como **System Reference Document** (SRD) oficial do ETMOS RPG, da editora **Balde Galáctico**, autoria de **Rafa Reis**. O documento não traz menção explícita a licença Creative Commons, OGL ou similar — presume-se todos os direitos reservados. Para uso no FUSION VTT, a equipe deve negociar permissão ou verificar se há licença em repositório público.

---

## 1. Identificação do Sistema

| Campo                    | Valor                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Nome completo            | **ETMOS RPG**                                                                      |
| SRD                      | versão 1.1                                                                         |
| Quickstart               | "Grimório de Introdução à Linguagem Mágica — Baixe e Jogue!"                       |
| Autor                    | Rafa Reis                                                                          |
| Direção                  | Lucas Basso Salgado                                                                |
| Edição                   | Rayana Fridlund e Vinícius Ferreira Barth                                          |
| Projeto Gráfico / Design | Iago Pacheco                                                                       |
| Ilustração               | Vinícius Ferreira Barth                                                            |
| Consultoria de Arte      | Laura Bosi Ribeiro Ferreira                                                        |
| Revisão                  | Leandro Dorval Cardoso                                                             |
| Redator convidado        | Gabriel Claro Norato                                                               |
| Editora                  | **Balde Galáctico**                                                                |
| Gênero / Ambientação     | Fantasia urbana contemporânea, escola de magia, Brasil (São Paulo)                 |
| Jogadores                | 3–4 jogadores + 1 Narrador                                                         |
| Material necessário      | 2d6, ficha de personagem, papel, lápis, borracha. Baralhos de Grimório (opcionais) |

---

## 2. Ambientação e Cenário

- Dois mundos coexistem: o **Mundano** (lógico, concreto, sem magia) e o **Fantástico** (caótico, abstrato, mágico).
- Conectados por **Portais do Meio**: portas transitórias que surgem em locais ignorados/abandonados pelos humanos (orelhões, assentos de cinema comprados, prédios esquecidos etc.).
- A magia consiste em reproduzir os "ecos do diálogo criador" por meio da linguagem **Etmos**.
- Os personagens são alunos da escola **Brasilis**, localizada em São Paulo, fundada no Século 18. Cursos de 3 anos + 2 anos de graduação.
- Personagens são Oradores (magos) — tanto humanos (Mundanos) quanto seres Fantásticos (fadas, iaras etc.).
- **Buscadores**: agentes do governo Fantástico que neutralizam ameaças e protegem o segredo da existência do Fantástico.

---

## 3. Mecânica de Resolução

### 3.1 Dado base

- Todos os testes usam **2d6 + modificador**.
- Resultado igual ou maior à dificuldade = sucesso.
- Dificuldade base: **6**.

### 3.2 Quatro tipos de teste (SRD confirmado)

| Tipo           | Fórmula                                           | Quando usar                                                                                                                    |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Atributo**   | 2d6 + Atributo (Corpo / Mente / Alma)             | Ações genéricas — usa o Atributo mais apropriado                                                                               |
| **Habilidade** | 2d6 + bônus da Habilidade                         | Uso de uma Habilidade específica                                                                                               |
| **Conjuração** | 2d6 + Alma                                        | Potência mágica, velocidade ou foco do conjurador                                                                              |
| **Contestado** | 2d6 + Atributo/Habilidade/Conjuração vs. oponente | Duas vontades opostas; vence maior resultado; empate = quem provocou o Teste. Jogadores vencem empates contra NPCs do Narrador |

> Nota SRD: o Teste Contestado admite qualquer combinação de tipos (Atributo × Atributo, Conjuração × Conjuração, etc.) — o Narrador escolhe o mais apropriado à ficção.

### 3.3 Bônus Extraordinário

O Narrador pode conceder um Bônus Extraordinário (somado antes da rolagem) com base em:

- Situação oportuna
- Costume/conhecimento prévio
- Objetos úteis
- Ajuda de outra personagem competente
- Estado de equilíbrio emocional

### 3.4 Parâmetros de dificuldade

| Resultado necessário | Classificação                   |
| -------------------- | ------------------------------- |
| < 6                  | Simples — falha só se distraído |
| 6                    | Fácil                           |
| 7–10                 | Mediano                         |
| 11–14                | Árduo                           |
| 15+                  | Difícil                         |

**Fatores que aumentam a dificuldade:** baixa luminosidade/visibilidade, estado emocional extremo, solo instável, alta movimentação, cansaço, estado físico debilitado.

**Regra importante:** Um jogador **não pode repetir** o mesmo Teste com o mesmo propósito na mesma cena em que falhou.

---

## 4. Atributos (SRD)

Todas as Personagens possuem **3 Atributos**, com valor de **1 a 6**:

| Atributo  | Representa                    | Usos mecânicos                                                                                |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| **Corpo** | Capacidades físicas gerais    | Limite de Ferimentos (`4 + 1 para cada 2 pts`); Testes de Fadiga; Testes de Corpo; Iniciativa |
| **Mente** | Capacidades mentais gerais    | Complexidade Máxima de magia; Testes de Mente                                                 |
| **Alma**  | Força de conjuração e emoções | Limite de Estresse (`4 + Alma`); Testes de Conjuração; Testes de Alma                         |

> Correção do Quickstart: o SRD especifica que atributos vão de **1 a 6** (não 0 a 6 como inferido anteriormente). Os personagens pré-gerados com Corpo 0 ou Alma 0 provavelmente usam o valor 1 como mínimo.

---

## 5. Criação de Personagem — Passo a Passo Completo (SRD)

Para criar um Personagem de **Nível 1**:

1. **Escolha 2 Origens** (ver seção 7).
2. **Distribua 6 Pontos de Atributo** entre Corpo, Mente e Alma — nenhum Atributo pode ser maior que **4** na criação.
3. **Escolha 2 Habilidades Práticas e 2 Habilidades Teóricas** (ver seção 8).
4. **Monte o Grimório** com **2 Funções, 3 Objetos e 4 Características** (Complementos do Nível 1 são disponíveis por padrão — o SRD não restringe, estão listados na ficha).
5. **Calcule os derivados:** Limite de Ferimentos, Limite de Estresse, Complexidade máxima, Estado de Fadiga inicial (Normal).
6. **Defina o Conceito:** Básico (espécie/origem), Aparência, Pontos de Importância, Futuro, Valores e Comportamento (2 eixos).
7. **Monte o Inventário** inicial.

> Para personagens de nível mais alto: crie como Nível 1 e siga a progressão (ver seção 10).

---

## 6. Ficha de Personagem — Data Model Completo (Ficha Oficial)

### 6.1 Todos os campos da ficha oficial (Ficha-final.pdf)

```
FICHA DE PERSONAGEM
├── CABEÇALHO
│   ├── Nome do Jogador (texto)
│   ├── Nome do Personagem (texto)
│   ├── Ano Escolar (campo de texto — ex.: 1°, 2°, 3°)
│   ├── Idade (número)
│   ├── Nível (número)
│   └── Dados de Empenho (contador)
│
├── ATRIBUTOS (cada um: trilha de 6 caixas, marcadas até o valor)
│   ├── Corpo  (1–6)
│   ├── Alma   (1–6)
│   └── Mente  (1–6)
│
├── ESTADOS DE FADIGA (trilha linear: Normal → Cansado → Exausto → Esgotado)
│   ├── Normal   (Estresse ≤ Limite)
│   ├── Cansado  (1–5 pts acima do Limite) — +1 Ferimento ao sofrer qualquer Ferimento
│   ├── Exausto  (6–8 pts acima do Limite) — magia não Trivial: 2d6; se > Corpo+4, magia falha
│   └── Esgotado (9+ pts acima do Limite) — magia não Trivial: 2d6; se > Corpo+3, personagem morre
│
├── LIMITE DE FERIMENTOS (calculado: 4 + 1 por cada 2 pts de Corpo; exibido na ficha)
├── ESTRESSE ACUMULADO (contador)
│   └── Limite de Estresse (calculado: 4 + Alma; exibido na ficha)
│
├── COMPLEXIDADE MÁXIMA DE MAGIA (trilha de marcadores: Trivial → Regular → Difícil → Complexo → Milagre)
│   ├── Trivial  (qualquer Orador)
│   ├── Regular  (qualquer Orador)
│   ├── Difícil  (Mente > 2)
│   ├── Complexo (Mente > 4)
│   └── Milagre  (Mente > 6 — ou seja, Mente = 6 máximo)
│
├── MARCOS DE CRESCIMENTO (trilha de 5 caixas cada)
│   ├── Físicos    (5 caixas)
│   ├── Emocionais (5 caixas)
│   └── Mentais    (5 caixas)
│
├── ORIGENS (2 campos de texto livre com nome e efeito)
│
├── HABILIDADES PRÁTICAS (lista, campo de texto livre por habilidade)
├── HABILIDADES TEÓRICAS (lista, campo de texto livre por habilidade)
│
├── INVENTÁRIO (campo de texto livre)
│
└── GRIMÓRIO (verso da ficha — checkboxes para cada Partícula)
    ├── FUNÇÕES (18 checkboxes — lista completa, ver seção 9)
    ├── OBJETOS (19 checkboxes — lista completa, ver seção 9)
    ├── CARACTERÍSTICAS (34 checkboxes — lista completa, ver seção 9)
    └── COMPLEMENTOS (por nível: 1°, 2°, 3°, 4°)

CONCEITO (campo separado na ficha)
├── Básico (texto — espécie/origem)
├── Pontos de Importância (texto)
├── Aparência (texto)
├── Valores e Comportamento
│   ├── Eixo 1: polo A ←→ polo B
│   └── Eixo 2: polo A ←→ polo B
└── Futuro (texto)
```

### 6.2 Derivados calculados automaticamente

| Campo                          | Fórmula                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| Limite de Ferimentos           | `4 + floor(Corpo / 2)`                                         |
| Limite de Estresse             | `4 + Alma`                                                     |
| Complexidade máxima conjurável | Mente > 2 → Difícil; Mente > 4 → Complexa; Mente = 6 → Milagre |
| Estado de Fadiga               | derivado de (Estresse Acumulado − Limite de Estresse)          |

### 6.3 Proposta de Data Model do Actor Etmos para o VTT

```json
{
  "name": "string",
  "type": "orador",
  "system": {
    "player_name": "string",
    "ano_escolar": "string",
    "idade": "number",
    "nivel": "number",
    "especie": "string",
    "mundo_origem": "mundano | fantastico",
    "atributos": {
      "corpo": { "value": 1, "max": 6 },
      "alma": { "value": 1, "max": 6 },
      "mente": { "value": 1, "max": 6 }
    },
    "ferimentos": {
      "atual": 0,
      "limite": 0
    },
    "estresse": {
      "atual": 0,
      "limite": 0
    },
    "fadiga": {
      "estado": "normal | cansado | exausto | esgotado"
    },
    "complexidade_maxima": "trivial | regular | dificil | complexa | milagre",
    "dados_empenho": {
      "atual": 0,
      "expira_em_dia_seguinte": true
    },
    "marcos_crescimento": {
      "fisicos": { "value": 0, "max": 5 },
      "emocionais": { "value": 0, "max": 5 },
      "mentais": { "value": 0, "max": 5 }
    },
    "conceito": {
      "basico": "string",
      "aparencia": "string",
      "pontos_importancia": "string",
      "futuro": "string",
      "valores": [
        { "polo_a": "string", "polo_b": "string" },
        { "polo_a": "string", "polo_b": "string" }
      ]
    }
  }
}
```

**Item: Partícula de Grimório**

```json
{
  "name": "string",
  "type": "particula",
  "system": {
    "palavra_etmos": "string",
    "tipo": "funcao | objeto | caracteristica | complemento",
    "nivel_grimorio": "number | null",
    "subtipo_complemento": "modificador | criador | null",
    "descricao": "string",
    "icone_runico": "string"
  }
}
```

**Item: Origem**

```json
{
  "name": "string",
  "type": "origem",
  "system": {
    "mundo_associado": "mundano | fantastico | ambos",
    "exclusiva": "boolean",
    "descricao": "string",
    "efeito_mecanico": "string"
  }
}
```

**Item: Habilidade**

```json
{
  "name": "string",
  "type": "habilidade",
  "system": {
    "categoria": "pratica | teorica",
    "descricao": "string",
    "bonus": "number",
    "usos_por_dia": "number | null",
    "requer_acao": "boolean",
    "escolhivel_multiplas_vezes": "boolean"
  }
}
```

**Item: Frase Mágica (spell)**

```json
{
  "name": "string",
  "type": "frase_magica",
  "system": {
    "funcao_id": "item_id",
    "objeto_id": "item_id",
    "caracteristicas": ["item_id"],
    "complementos": ["item_id"],
    "frase_completa": "string",
    "intencao": "string",
    "complexidade": "trivial | regular | dificil | complexa | milagre",
    "estresse_gerado": "number"
  }
}
```

**Actor: Antagonista / Criatura**

```json
{
  "name": "string",
  "type": "antagonista",
  "system": {
    "ficha_base": "simples | intermediaria | avancada",
    "limite_ferimentos": "number",
    "estresse": "number",
    "complexidade_maxima": "trivial | regular | dificil | complexa | milagre",
    "movimentacao": "number",
    "comunicacao": "boolean",
    "atributos": {
      "corpo": "number",
      "mente": "number",
      "alma": "number"
    },
    "aptidoes": ["string"],
    "ataques": ["string"]
  }
}
```

---

## 7. Origens (SRD)

### 7.1 Regras gerais

- Toda Personagem tem **2 Origens**, escolhidas apenas na criação (não se obtém novas Origens depois).
- São divididas em **Mundanas** e **Fantásticas**.
- Origens marcadas como **EXCLUSIVAS** só podem ser obtidas por Personagens do tipo correspondente (Mundana Exclusiva = apenas Mundanos; Fantástica Exclusiva = apenas Fantásticos).

### 7.2 Catálogo de Origens (SRD — lista de exemplos canônicos)

| Nome                        | Tipo       | Exclusiva? | Efeito                                                                                                  |
| --------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| **Berço de Ouro**           | Mundana    | SIM        | Nunca falta dinheiro para bens cotidianos Mundanos                                                      |
| **Orador Prodígio**         | Fantástica | Não        | Começa com 1 Característica adicional no Grimório                                                       |
| **Atleta**                  | Mundana    | Não        | +1 no Limite de Ferimentos                                                                              |
| **"Inteligência das Ruas"** | Mundana    | SIM        | Começa com 1 das Habilidades: Ladinagem, Enganar ou Aparar                                              |
| **Voo**                     | Fantástica | SIM        | Pode voar até 30 km/h; no Mundano acumula 1 Estresse por 10 min de voo (ou a cada 2 rodadas em combate) |

> Nota: O SRD apresenta esses exemplos como ilustrativos. O Narrador pode criar Origens adicionais. A lista completa de Origens canônicas pode constar no livro base (não parte do SRD).

### 7.3 Origens dos personagens pré-gerados (Quickstart)

| Personagem       | Origem 1                                   | Origem 2                                                  |
| ---------------- | ------------------------------------------ | --------------------------------------------------------- |
| Mandla Ngobo     | Viajado (+1 Hab. à escolha)                | Criado no Fantástico (+1 em testes com o Fantástico)      |
| Dayana Muñoz     | Atleta (+1 Limit. Ferimentos)              | "Inteligência das Ruas" (Ladinagem/Sobrevivência/Enganar) |
| Angélica Aguilar | Orador Prodígio (+1 Característica)        | Charme Fantástico (influência mental; 1 Estresse)         |
| Marcela Souza    | Ensino Formal Mundano (+1 testes Mundanos) | Aluno Modelo (Herbologia + Reconhecer Sinais)             |

---

## 8. Habilidades (SRD)

### 8.1 Regras gerais

- Habilidades são capacitações além da magia — por prática (**Práticas**) ou estudo (**Teóricas**).
- Na criação: **2 Práticas + 2 Teóricas**.
- Várias Habilidades podem ser escolhidas **múltiplas vezes** (cada vez soma +2 ao bônus ou adiciona um sub-campo).

### 8.2 Habilidades Práticas (SRD — lista canônica)

| Habilidade                    | Efeito                                                                                         | Múltipla?              |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| **Conjuração Silenciosa (P)** | Pode conjurar sussurrando; +1 ponto de Estresse ao conjurar                                    | Não especificado       |
| **Armas Brancas (P)**         | Luta com armas brancas (facas, espadas, martelos etc.)                                         | Sim — +2 por vez       |
| **Diplomacia (P)**            | Convencer/negociar; pode ser usada mais de uma vez por situação                                | Sim — +2 por vez       |
| **Performance (P)**           | Capacidade artística geral (dança, canto, instrumento, teatro etc.); escolhe um ofício por vez | Sim — +2 + novo ofício |

### 8.3 Habilidades Teóricas (SRD — lista canônica)

| Habilidade                 | Efeito                                                                               | Múltipla?                                         |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **Treinamento Mágico (T)** | Aprende 1 Característica adicional para o Grimório                                   | Sim — até 3×, 1 Característica diferente cada vez |
| **Conhecimento (T)**       | Conhecimento teórico em área específica; +2 por vez escolhida                        | Sim — +2 por vez; sub-áreas:                      |
| — História                 | Eventos históricos, pessoas, lugares, conflitos                                      | Sim                                               |
| — Geografia                | Topologia Mundana e Fantástica, eventos físicos e climáticos                         | Sim                                               |
| — Zoologia                 | Fisiologia e comportamento de animais Mundanos e Fantásticos                         | Sim                                               |
| — Herbologia               | Flora Mundana e Fantástica, plantas cotidianas a ervas mágicas                       | Sim                                               |
| — Medicina                 | Fisiologia humana e tratamento de aflições físicas                                   | Sim                                               |
| — Mecânica e Engenharia    | Conhecimentos básicos sobre máquinas                                                 | Sim                                               |
| — Computação               | Computadores, hacking, criptografia, softwares                                       | Sim                                               |
| **Artes de Combate (T)**   | Pode optar por não rolar Iniciativa e se colocar onde desejar na Ordem de Iniciativa | Não especificado                                  |

### 8.4 Habilidades adicionais encontradas nos personagens pré-gerados (Quickstart)

| Habilidade                   | Tipo            | Efeito                                                                                |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| Sobrevivência                | Prática         | +2 em testes de sobrevivência                                                         |
| Pronto para Ação             | Prática         | +3 na rolagem de Iniciativa                                                           |
| Inspirador                   | Prática/Teórica | 1×/dia por alvo: confere 1 Dado de Empenho a aliado via ação social/artística         |
| Fanático por Mundanos        | Prática         | +1 em testes envolvendo Mundanos                                                      |
| Aparar                       | Prática         | Dificuldade de ataques contra você sobe em 2                                          |
| Ladinagem                    | Prática         | +2 em furtividade, roubo, arrombamento                                                |
| Percepção                    | Prática         | +2 em testes de percepção                                                             |
| Exceder os Limites           | Prática         | 1×/dia: conjura 1 Complexidade acima do limite; +2 Estresse extra                     |
| Armas de Longo Alcance       | Prática         | Ataques à distância                                                                   |
| Agilidade Mental             | Teórica         | 2 Reações por rodada (2ª acumula +3 Estresse)                                         |
| Dedicado                     | Teórica         | 1×/dia: ganha 1 Dado de Empenho extra                                                 |
| Comunicação de Intenção      | Teórica         | Distinção de intenções de qualquer criatura; Teste Alma dif. 8 para se fazer entender |
| Culinária                    | Teórica         | Comida preparada recupera +1 Ferimento                                                |
| Reconhecer Sinais            | Teórica         | Em cidade familiar, localiza Portais do Meio em 10 min                                |
| Expert em Oratória (Invocar) | Prática         | +2 em Testes Contestados e Conjuração ao Invocar                                      |

---

## 9. O Grimório — Sistema Mágico

### 9.1 Estrutura da Frase Mágica (SRD)

```
[FUNÇÃO] + [OBJETO(S)] + [CARACTERÍSTICA(S) opcional(is)] + [COMPLEMENTO(S) opcional(is)]
```

- **Obrigatório:** exatamente **1 Função** e **1 Objeto** (fundidos em uma palavra).
- A Frase pode ter **quantos Objetos e Características** forem necessários (todos existem como palavras individuais na frase, exceto Função+Objeto que fundem).
- **Complementos:** sempre ao final, como palavras individuais.
- A magia é falada em voz alta, em alto e bom tom.
- O efeito depende da frase **e** da **intenção** declarada — nenhuma frase tem efeito pré-determinado.

**Exemplo canônico (SRD):** _Et_ (Controlar) + _Imu_ (Mente) → _Etimu_ (Controlar Mente) — menor Frase funcional possível.

### 9.2 Tipos de Complemento (SRD — distinção Modificadores vs. Criadores)

**Modificadores** (palavras separadas na frase — interferem no efeito geral):

- _Mor_ (Maior) — potência, velocidade ou amplitude maior
- _Min_ (Menor) — potência, velocidade ou amplitude menor
- _Sin_ (Forma: Objeto Genérico) — efeito envolverá um objeto genérico
- _San_ (Forma: Círculo/Redoma/Esfera) — efeito tomará forma esférica/redoma
- _Sar_ (Forma: Parede/Barreira/Muralha) — efeito envolverá uma parede ou barreira
- _Itam_ (Inerte) — magia fica aguardando gatilho definido na Intenção; quanto mais específico o gatilho ou mais tempo inerte, maior a Complexidade

**Criadores** (conectam-se como prefixo a Características para criar novas Características):

- _Ada-_ (Variação) — prefixo que cria variação lógica da Característica (ex.: _adaQuan_ = Água→Gelo)
- _Ag_ (Adição) — conecta duas Características somando conceitos (ex.: _QuanAgAer_ = Água+Ar→Neblina)
- _No-_ (Negação) — prefixo que nega o conceito (ex.: _noTum_ = não Movimento→Inércia)
- _Mut-_ (Derivação) — prefixo que converte um Objeto em Característica (ex.: _Mutexa_ = Inanimado usado como Característica)

### 9.3 Catálogo Completo de Partículas (SRD + Ficha Oficial)

#### FUNÇÕES — 18 partículas

| Palavra Etmos | Significado       |
| ------------- | ----------------- |
| Al            | Alterar           |
| Ar            | Aprisionar        |
| Im            | Atacar / Ferir    |
| Ir            | Atrair / Repelir  |
| En            | Banir             |
| Et            | Controlar         |
| As            | Destruir          |
| Em            | Empoderar         |
| In            | Enfraquecer       |
| Ev            | Invocar / Criar   |
| Un            | Juntar / Conectar |
| Es            | Marcar            |
| Am            | Proteger          |
| An            | Restaurar         |
| Il            | Revelar           |
| Or            | Transmitir        |
| It            | Transportar       |
| Mat           | Matar\*           |

> \*"Mat" (Matar) aparece apenas na ficha do Quickstart de Marcela (não marcada como disponível para ela) e **não consta** na Lista Completa do SRD nem na ficha oficial. **Conclusão:** provavelmente era erro ou Função restrita/não canônica. O SRD é a fonte prioritária — "Mat" **não deve** ser implementada como Função padrão.

#### OBJETOS — 19 partículas

| Palavra Etmos | Significado        |
| ------------- | ------------------ |
| Ala           | Abstrato           |
| Ani           | Alma               |
| Ali           | Animais            |
| Iro           | Aura               |
| Eva           | Cadáver            |
| Ayu           | Clima              |
| Ibo           | Comida             |
| Omu           | Construção         |
| Eli           | Elemento           |
| Epi           | Explosão           |
| Exa           | Inanimado          |
| Azi           | Informação         |
| Imu           | Mente / Pensamento |
| Ivi           | Pessoa             |
| Una           | Sentido            |
| Ina           | Tecnologia         |
| Anu           | Tempo              |
| Era           | Terreno            |
| Ora           | Vegetação / Flora  |

#### CARACTERÍSTICAS — 34 partículas

| Palavra Etmos | Significado | Palavra Etmos | Significado        |
| ------------- | ----------- | ------------- | ------------------ |
| Dum           | Ácido       | Sag           | Munição            |
| Quan          | Água        | Necro         | Necrótico          |
| Aer           | Ar          | Apu           | Nojento / Secreção |
| Impe          | Armas       | Gus           | Paladar            |
| Kar           | Cheiro      | Roc           | Pedra              |
| Phys          | Corpo       | Cand          | Radiação           |
| Rat           | Dimensional | Kan           | Reflexo / Espelho  |
| Triz          | Elétrico    | Hem           | Sangue             |
| Bhas-         | Emoção      | Mul           | Som                |
| Ten           | Escuridão   | Cysg          | Sono               |
| Ig            | Fogo        | Tuni          | Tecido             |
| Vib           | Força       | Mun           | Terra              |
| Ym            | Gravidade   | Ast           | Velocidade         |
| Hin           | Idioma      | Tox           | Veneno             |
| Alui          | Ilusão      | Ocul          | Visão              |
| Mok           | Loucura     | —             | —                  |
| Lum           | Luz         | —             | —                  |
| Mag           | Magia       | —             | —                  |
| Tum           | Movimento   | —             | —                  |

#### COMPLEMENTOS — 10 partículas (organizadas por nível de Grimório)

| Nível Grimório | Palavra Etmos | Significado                        | Tipo        |
| -------------- | ------------- | ---------------------------------- | ----------- |
| 1°             | Mor           | Maior                              | Modificador |
| 1°             | Min           | Menor                              | Modificador |
| 1°             | San           | Forma: Círculo / Redoma / Esfera   | Modificador |
| 1°             | Sar           | Forma: Parede / Barreira / Muralha | Modificador |
| 1°             | Sin           | Forma: Objeto em geral             | Modificador |
| 2°             | Ag            | Adição                             | Criador     |
| 3°             | Ada-          | Variação                           | Criador     |
| 3°             | No-           | Negação                            | Criador     |
| 3°             | Mut-          | Derivação                          | Criador     |
| 4°             | Itam          | Inerte                             | Modificador |

**Resumo de contagens:**

- Funções: **18** (17 no SRD; "Mat" excluída do canônico)
- Objetos: **19**
- Características: **34**
- Complementos: **10** (5 Modificadores + 4 Criadores + 1 Modificador de nível 4)
- **Total de Partículas canônicas: 81**

### 9.4 Níveis de Complexidade (SRD confirmado)

| Nível        | Req. Mente | Estresse | Dano máximo potencial |
| ------------ | ---------- | -------- | --------------------- |
| 1 — Trivial  | —          | 0        | Negligível            |
| 2 — Regular  | —          | 1        | Superficial           |
| 3 — Difícil  | > 2        | 2        | Potencialmente letal  |
| 4 — Complexo | > 4        | 4        | Letal                 |
| 5 — Milagre  | = 6        | 7        | Cataclísmico          |

> Nota SRD: "Difícil: apenas acima de Mente 2" = Mente **> 2**, ou seja, Mente ≥ 3. "Complexo: apenas acima de Mente 4" = Mente ≥ 5. "Milagre: apenas acima de Mente 6" — como Mente vai até 6, significa Mente = 6 estritamente.

**9 parâmetros de Complexidade (Narrador):**

1. Quão diferente de fenômeno natural?
2. Quanto a realidade precisa se reorganizar?
3. Quão amplo é o efeito?
4. Quão específico demais é o efeito?
5. Quão próxima é a lógica da Frase ao efeito?
6. Qual o alcance?
7. Por quanto tempo dura?
8. Quão potente é?
9. Livre-arbítrio (não altera Complexidade, mas há resistência natural)

---

## 10. Progressão de Nível (SRD — completo)

### 10.1 Marcos de Crescimento

- 3 categorias: **Físico**, **Mental (Intelectual)** e **Emocional**.
- Ao longo da ficção, a Personagem acumula **Pontos de Desenvolvimento** ao concluir Marcos do mesmo tipo.
- Cada categoria tem trilha de **5 caixas** (5 Pontos de Desenvolvimento).
- Ao completar 5 Pontos numa categoria → ganha 1 **Bônus de Progressão** para aquela categoria e **não pode ganhar mais pontos nela** até subir de nível.

**Marcos de Crescimento Físico (exemplos canônicos do SRD):**

- Participar de competição esportiva significativa
- Derrotar antagonista em luta ou duelo
- Progredir em prática desportiva (faixa, titular em time, etc.)
- Passar por situação "perigosa" e sair vivo
- Treinar com afinco para competição
- Aprender nova habilidade ou esporte
- Ficar muito doente/ferido e se recuperar
- Sofrer 4 ou mais Ferimentos de uma vez
- Entrar no estado Esgotado e continuar em cena de ação por ao menos 3 rodadas

**Marcos de Crescimento Intelectual (exemplos canônicos do SRD):**

- Passar em testes/exames académicos estudados
- Participar de competição intelectual (xadrez, debate, redação)
- Concluir tarefa académica importante (livro, certificado, pesquisa)
- Descobrir verdade por trás de um mistério
- Ajudar um amigo a passar em prova difícil
- Defender-se completamente de magia Complexa pela primeira vez
- Ter interação significativa com ser de cultura muito diferente
- Ser criativo ao conjurar magia
- Fazer viagem longa e imergir na cultura local

**Marcos de Crescimento Emocional (exemplos canônicos do SRD):**

- Realizar apresentação artística para grande público
- Alcançar objetivo pessoal (vencer competição, obter certificação, ser reconhecido)
- Passar por desilusão amorosa
- Criar laços fortes (amizade ou românticos)
- Enfrentar seus medos
- Falhar durante evento para o qual se esforçou
- Comparecer a eventos sociais importantes
- Ter crenças e moralidades confrontadas
- Reconhecer seus erros e falhas
- Se Humano: fazer amizade com ser Fantástico de fora da escola (e vice-versa)

### 10.2 Bônus de Progressão e Opções por Nível (SRD)

Ao obter 1 Bônus de Progressão, a Personagem escolhe 1 das 3 opções (uma por categoria) — não pode repetir a mesma mais de uma vez:

| Transição de Nível | Opção Física                             | Opção Mental                 | Opção Emocional                   |
| ------------------ | ---------------------------------------- | ---------------------------- | --------------------------------- |
| Nível 1 → 2        | +1 Objeto e +1 Característica            | +1 ponto de Atributo (livre) | +1 Habilidade Prática             |
| Nível 2 → 3        | +1 Função                                | +1 ponto de Atributo (livre) | +1 Habilidade Teórica             |
| Nível 3 → 4        | +1 Objeto e +1 Característica            | +1 ponto de Atributo (livre) | +1 Habilidade Prática             |
| Nível 4 → 5        | +1 Função                                | +1 ponto de Atributo (livre) | +1 Habilidade Teórica             |
| Nível 5 → 6        | +1 Função, +1 Objeto e +1 Característica | +1 ponto de Atributo (livre) | +1 Hab. Teórica e +1 Hab. Prática |

> - As categorias de desenvolvimento reiniciam ao subir de nível.
> - A Personagem só sobe de nível após **completar todas as 3 categorias** (5 pontos em cada).
> - Em cenário escolar: o gatilho narrativo é a prova de final de ano (mas o Narrador tem liberdade de escolher o momento).

---

## 11. Combate

### 11.1 Iniciativa (SRD — D3 resolvida)

- **Fórmula: Teste de Corpo** (2d6 + Corpo).
- Quem tiver resultado mais alto age primeiro.
- Em empate: Jogadores vencem contra personagens do Narrador; empates entre Jogadores são decididos por quem tem Corpo mais alto.
- Habilidade "Artes de Combate": pode optar por não rolar e se colocar onde desejar na Ordem de Iniciativa.
- Habilidade "Pronto para Ação" (Quickstart): +3 na rolagem.

### 11.2 Estrutura do Turno

Cada participante faz **1 das 3 ações** por turno:

| Ação                         | Descrição                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| **Movimento**                | Desloca-se pelo ambiente; padrão 10 m em mapa de batalha                              |
| **Conjurar uma Magia**       | Conjura magia, OU usa item encantado, OU faz ataque não mágico                        |
| **Interagir com o Ambiente** | Trancar portas, empurrar móveis, esconder, conversar brevemente com aliado/adversário |

### 11.3 Reação (SRD — confirmado)

- **1 Reação por rodada**; recupera no início do próprio turno.
- Ativada quando um participante realiza ação objetivamente contra adversários (não qualquer ação).
- Pode ser usada para se defender **ou para defender um aliado** — geralmente conjurando magia.
- Magia de Reação **não causa Ferimentos** e **não perdura** (efeito instantâneo, encerra-se após a Reação).
- Exceção: Habilidade "Agilidade Mental" — 2 Reações por rodada; 2ª acumula +3 Estresse.

### 11.4 Defesa Mágica (Teste Contestado)

Tipo de defesa determinado por Teste Contestado, geralmente **Conjuração × Conjuração**:

| Resultado       | Efeito                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| Defesa Completa | Ataque completamente ineficaz                                           |
| Defesa Parcial  | Reduz 2 ou 1 Ferimentos (mínimo 1); demais efeitos com duração reduzida |
| Defesa Ineficaz | Ataque não alterado                                                     |

O Narrador define o tipo de Defesa avaliando: o que está sendo atacado vs. o que a defesa protege; a amplitude do ataque vs. da defesa; a especificidade da defesa.

### 11.5 Ferimentos (SRD — adição: regra de inconsciente)

| Quantidade | Descrição                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | Contusões, escoriações, cortes simples, queimaduras leves                                                                             |
| 2          | Cortes profundos, torções, leves concussões, queimaduras medianas, danos mentais/espirituais leves                                    |
| 3          | Cortes profundos, hemorragias, quebra de ossos, concussões, grandes queimaduras, danos mentais/espirituais medianos                   |
| 4          | Hemorragia severa, perda de membros, traumatismos, queimaduras graves, danos mentais/espirituais de alta intensidade — ameaçam a vida |

- **Nenhuma magia ou arma causa quantidade exata de dano** — o Narrador decide narrativamente dentro dos parâmetros acima.
- Exceção: Aptidões de criaturas/antagonistas podem causar quantidade exata de dano.
- **Inconsciente:** ao ultrapassar o Limite de Ferimentos, Personagem cai inconsciente; não pode agir; acorda quando Ferimentos acumulados voltam ao Limite (ao acordar: +3 pontos de Estresse).
- **Morte imediata:** Ferimentos = Limite + 4.
- **Morte enquanto inconsciente:** receber +1 Ferimento adicional.

---

## 12. Estresse e Fadiga (SRD confirmado)

### 12.1 Regras adicionais do SRD

- Estresse acumula mesmo se a magia **não surtir o efeito pretendido**.
- Estresse acumula **após** a magia ser conjurada.
- Estado Cansado: "de 1 a 5 Estresse acima do Limite" (o Quickstart dizia "+5" — o SRD esclarece que é 1–5 pts acima).

### 12.2 Tabela completa

| Estado   | Estresse acima do Limite | Penalidade                                                                                                           |
| -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Normal   | 0                        | —                                                                                                                    |
| Cansado  | 1–5                      | +1 Ferimento a todo Ferimento sofrido (não acumula com estados seguintes)                                            |
| Exausto  | 6–8                      | Magia não Trivial: 2d6; se > Corpo+4 → magia falha (Estresse ainda acumula); +1 Ferimento por dano                   |
| Esgotado | 9+                       | Magia não Trivial: 2d6; se > Corpo+3 → morre após conjurar (efeito ocorre); substitui Exausto; +1 Ferimento por dano |

---

## 13. Totens e Santuários (SRD — novo)

- Magia **não pode ser conjurada no Mundano** sem Totem ou Santuário.
- **Totem:** objeto encantado com matéria-prima Mundana, confeccionado no Fantástico. Sintonia com uma única pessoa. Perde a sintonia após 100 anos sem uso.
- **Santuário:** local que replica o efeito de Totem para toda uma área. Pode ser criado espontaneamente ou artificialmente (com Totem de encantamento específico).
- **Rank (0–5):** indica quantos pontos de Estresse extras são acumulados ao conjurar magia não Trivial pelo intermédio do Totem/Santuário.
- **Ser Fantástico sem Totem no Mundano:** após `Corpo + 1` minutos, é teletransportado forçosamente para o Fantástico, sofrendo Ferimentos e acumulando Estresse até atingir o Limite de ambos.

---

## 14. Encantamento de Itens (SRD — novo)

- Qualquer objeto pode ser encantado.
- Encantamento = frase mágica com Intenção pré-definida gravada no objeto.
- Processo: sessões de trabalho de **3 horas/dia**, dias consecutivos (máximo 24h entre sessões).
- **Sistema de Pontos de Preparo (PP):** o Narrador define o Grau de Sofisticação:

| Grau        | Complexidade da Frase | PP necessários |
| ----------- | --------------------- | -------------- |
| Simples     | Trivial ou Regular    | 5              |
| Sofisticado | Difícil               | 10             |
| Primoroso   | Complexa ou Milagre   | 15             |

**Fatores que afetam PP acumulados:**

| Fator                                                            | Modificador                          |
| ---------------------------------------------------------------- | ------------------------------------ |
| Veículo Consumível (uso único: poção, comida, adesivo)           | +1 PP                                |
| Veículo Persistente (uso múltiplo: vestuário, joias)             | −2 PP                                |
| Qualidade do Veículo: Inferior / Mediana / Alta / Ideal          | −2 / 0 / +2 / +3 PP                  |
| Qualidade das Ferramentas: Ruins / Medianas / Boas / Excelentes  | −2 / 0 / +1 / +3 PP                  |
| Frase marcada no objeto: Nada / Pouco / Bastante / Completamente | −15 / −5 / +2 / +5 PP                |
| Habilidade Artesão (nível 1/2/3)                                 | +1 / +2 / +3 PP                      |
| Sessões consecutivas (1/2/3/4/5/6/7/9/12/20/30)                  | −15/−12/−7/−3/0/+1/+2/+3/+4/+5/+6 PP |

- Sessões extras no mesmo dia: +3 Estresse por sessão além da primeira.
- Encantamento concluído quando PP acumulados ≥ PP necessários.

---

## 15. Antagonistas e Fichas Base (SRD — novo)

- **Fichas Base** para criaturas: Simples, Intermediária, Avançada (valores de atributos crescentes).
- **Aptidões:** habilidades e características da criatura; algumas são Ataques (usados na Ação regular ou Interagir com o Ambiente).
- Criatura pode ter qualquer quantidade de Aptidões escolhidas pelo Narrador.
- Exemplo Simples (Morto Vivo): Ferimentos 5, Estresse 4, Complexidade Regular, Movimentação 6m, Corpo 1, Mente 0, Alma 0.
- Exemplo Intermediário (Curupira): Ferimentos 7, Estresse 6, Complexidade Difícil, Movimentação 9m, Corpo 3, Mente 2, Alma 2.

**Aptidões canônicas de exemplo:**

- Comunicação de Intenção, Bruto (+1 Ferimento causado), Habitat Natural (+1 em testes no habitat), Resistência Fantástica (+2 em Contestados contra magia), Ninho, Combatente (soma 1 Atributo em ataques), Ser Fantástico.
- Ataques: Pancada Pesada (2 Ferimentos, Defesa Ineficaz, 1m), Grito Fúnebre (2 Ferimentos + surdez em 30m), Explosão Mental (2 Ferimentos + 2 extras se acima do Limite de Estresse, 15m), Explosão Elemental (3 Ferimentos, área 5m, Teste Corpo dif. 13).

---

## 16. Descanso e Recuperação (SRD — adições)

**Regra adicional importante:** fora do mundo de origem, Descanso Completo vira Parcial e Parcial não surte efeito.

| Tipo                                                               | Ferimentos               | Estresse                |
| ------------------------------------------------------------------ | ------------------------ | ----------------------- |
| Parcial                                                            | −1 Ferimento             | −3 Estresse             |
| Completo                                                           | −2 Ferimentos            | Elimina todo o Estresse |
| +Tratamento Médico (independente)                                  | −2 Ferimentos adicionais | —                       |
| Sem Tratamento + no Limite: Completo vira Parcial                  | —                        | —                       |
| Fora do mundo de origem: Completo vira Parcial, Parcial sem efeito | —                        | —                       |

---

## 17. Segmentos de Jogo (SRD confirmado)

| Segmento            | Descrição                                                                        |
| ------------------- | -------------------------------------------------------------------------------- |
| **Aula**            | Momento académico; Narrador pode usar para exposição narrativa dentro da diegese |
| **Extracurricular** | Clubes, esportes, oficinas — interpretação da vida escolar                       |
| **Tempo Livre**     | Livre; geralmente onde a história se desenrola                                   |

- Recomendação: 4 a 3 Segmentos por jogo, com 1 ou mais de Tempo Livre.
- Participar de Aula **ou** Extracurricular: +1 Dado de Empenho.
- Dados de Empenho: acumulam no dia; perdem-se no início do próximo dia fictício.
- Gasto: re-rola **1 dado** em qualquer Teste já feito e escolhe o melhor resultado.

---

## 18. Tabelas para Implementação no VTT

### Tabela A — Complexidade × Estresse × Requisito

| Complexidade | Req. Mente | Estresse | Dano max.     |
| ------------ | ---------- | -------- | ------------- |
| Trivial      | —          | 0        | Negligível    |
| Regular      | —          | 1        | Superficial   |
| Difícil      | > 2        | 2        | Potenc. letal |
| Complexa     | > 4        | 4        | Letal         |
| Milagre      | = 6        | 7        | Cataclísmico  |

### Tabela B — Ferimentos × Limite de Corpo

| Corpo | Limite de Ferimentos |
| ----- | -------------------- |
| 1     | 4                    |
| 2     | 5                    |
| 3     | 5                    |
| 4     | 6                    |
| 5     | 6                    |
| 6     | 7                    |

### Tabela C — Estresse × Limite de Alma

| Alma | Limite de Estresse |
| ---- | ------------------ |
| 1    | 5                  |
| 2    | 6                  |
| 3    | 7                  |
| 4    | 8                  |
| 5    | 9                  |
| 6    | 10                 |

### Tabela D — Fadiga

| Estado   | Condição         | Penalidade                                                            |
| -------- | ---------------- | --------------------------------------------------------------------- |
| Normal   | Abaixo do Limite | —                                                                     |
| Cansado  | 1–5 acima        | +1 a todo Ferimento recebido                                          |
| Exausto  | 6–8 acima        | Magia não Trivial: 2d6; se > Corpo+4 → magia falha; +1 Ferimento      |
| Esgotado | 9+ acima         | Magia não Trivial: 2d6; se > Corpo+3 → morre após magia; +1 Ferimento |

### Tabela E — Progressão de Nível

| Nível | Marcos necessários | Opção Física                          | Opção Mental | Opção Emocional                 |
| ----- | ------------------ | ------------------------------------- | ------------ | ------------------------------- |
| 1→2   | 5+5+5              | +1 Objeto +1 Característica           | +1 Atributo  | +1 Hab. Prática                 |
| 2→3   | 5+5+5              | +1 Função                             | +1 Atributo  | +1 Hab. Teórica                 |
| 3→4   | 5+5+5              | +1 Objeto +1 Característica           | +1 Atributo  | +1 Hab. Prática                 |
| 4→5   | 5+5+5              | +1 Função                             | +1 Atributo  | +1 Hab. Teórica                 |
| 5→6   | 5+5+5              | +1 Função +1 Objeto +1 Característica | +1 Atributo  | +1 Hab. Teórica +1 Hab. Prática |

---

## 19. Implicações para o VTT — Estrutura Sugerida (Atualizada)

### 19.1 O que precisa de automação

| Funcionalidade                                   | Prioridade | Notas                                                                      |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------------------- |
| Rolagem 2d6 + Atributo / Habilidade              | Alta       | Base de todo o sistema                                                     |
| Cálculo automático de Limite de Ferimentos       | Alta       | 4 + floor(Corpo/2)                                                         |
| Cálculo automático de Limite de Estresse         | Alta       | 4 + Alma                                                                   |
| Tracker de Ferimentos Acumulados                 | Alta       | Alerta ao atingir Limite (inconsciente) e Limite+4 (morte)                 |
| Tracker de Estresse Acumulado                    | Alta       | Transição automática de estados de Fadiga (1–5/6–8/9+)                     |
| Estado de Fadiga + penalidades                   | Alta       | Aplicação automática; rolar 2d6 quando Exausto/Esgotado conjura            |
| Verificação de Complexidade Máxima               | Alta       | Mente > 2 → Difícil; > 4 → Complexa; = 6 → Milagre                         |
| Construtor de Frase Mágica                       | Alta       | Interface: 1 Função + 1+ Objeto + N Características + N Complementos       |
| Grimório com checkboxes (81 partículas)          | Alta       | Cada Partícula: palavra, tipo, nível                                       |
| Teste Contestado (duas rolagens + desempate)     | Média      | Desempate: Jogadores vencem NPCs; empate entre Jogadores → Corpo mais alto |
| Tracker de Dados de Empenho                      | Média      | Acumulam no dia; re-rola 1d6, escolhe melhor                               |
| Descanso (Parcial/Completo × Tratamento × Mundo) | Média      | 3 variáveis: tipo, tratamento, mundo de origem                             |
| Reação (flag por rodada)                         | Média      | 1 por rodada; reset no próprio turno; Agilidade Mental = 2                 |
| Iniciativa (Teste de Corpo)                      | Média      | 2d6 + Corpo; Jogadores vencem empate vs. NPC                               |
| Marcos de Crescimento (trilha 5×3)               | Média      | Trigger de Bônus de Progressão ao completar cada categoria                 |
| Encantamento de Itens (PP)                       | Baixa      | Sistema complexo de pontos; implementar como ferramenta de Narrador        |
| Fichas de Antagonistas (Fichas Base + Aptidões)  | Média      | 3 tipos base + sistema de Aptidões livres                                  |
| Totem/Santuário (bloqueio de magia no Mundano)   | Alta       | Flag no Actor: tem Totem? Rank do Totem (0–5) → +Estresse extra            |

### 19.2 Decisão sobre lacunas restantes

Conforme decisão do usuário: lacunas sem regra explícita no SRD serão tratadas como **"arbitragem do Narrador na mesa"** — o VTT oferece controles manuais (campos editáveis, modificadores livres) e não automatiza o que não tem regra definida.

---

## 20. Personagens Pré-Gerados — Atributos (Quickstart)

| Personagem               | Tipo              | Idade | Corpo | Alma | Mente |
| ------------------------ | ----------------- | ----- | ----- | ---- | ----- |
| Mandla Ngobo             | Humana, Mali      | 15    | 2     | 2    | 2     |
| Dayana Muñoz             | Humana, Peru      | 15    | 4     | 1    | 2     |
| Angélica Aguilar         | Fantástico (Iara) | 15    | 1     | 4    | 1     |
| Marcela Souza de Almeida | Humana, Brasil    | 14    | 0\*   | 4    | 2     |

> \*Marcela com Corpo 0 é inconsistente com a regra do SRD (atributos de 1 a 6). Provável valor mínimo = 1 ou erro de impressão no Quickstart. **No VTT, o mínimo será 1.**

**Grimórios Nível 1 por Personagem:**

| Personagem | Funções | Objetos       | Características            |
| ---------- | ------- | ------------- | -------------------------- |
| Mandla     | Al, Ev  | Ali, Eli, Ora | Quan, Phys, Triz, Lum      |
| Dayana     | Em, Am  | Eli, Exa, Ivi | Impe, Phys, Ig, Ast        |
| Angélica   | Et, It  | Ala, Azi, Imu | Bhas-, Mag, Tum, Mul, Ocul |
| Marcela    | In, An  | Ani, Ivi, Ora | Phys, Bhas-, Hem, Tox      |

---

## 21. Dúvidas — Status Atualizado

| ID      | Dúvida                                                         | Status                                                                                                                                                                                               |
| ------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | Como se distribuem os pontos de Atributo na criação?           | **RESOLVIDA** — SRD: 6 Pontos de Atributo, máximo 4 por Atributo                                                                                                                                     |
| **D2**  | Lista completa de Origens e Habilidades                        | **PARCIALMENTE RESOLVIDA** — SRD fornece lista canônica de exemplos (5 Origens, ~10 Habilidades); pode existir lista maior no livro base. Lacunas → arbitragem do Narrador                           |
| **D3**  | Fórmula exata de Iniciativa                                    | **RESOLVIDA** — SRD: Teste de Corpo (2d6 + Corpo); Jogadores vencem empates vs. NPCs                                                                                                                 |
| **D4**  | "Pontos de Importância" têm efeito mecânico?                   | **ABERTA** — não mencionada no SRD. Campo narrativo da ficha. Lacuna → controle manual no VTT                                                                                                        |
| **D5**  | Como funcionam os Marcos de Crescimento?                       | **RESOLVIDA** — SRD: trilha de 5 caixas por categoria (Físico/Mental/Emocional); completar 5 = 1 Bônus de Progressão; 3 opções por bônus (ver Tabela E); categorias reiniciam ao subir de nível      |
| **D6**  | Regras completas de totens, poções e itens mágicos             | **RESOLVIDA** — SRD: Totens/Santuários (seção 13) + Encantamento de Itens com sistema de Pontos de Preparo (seção 14)                                                                                |
| **D7**  | Como o Nível do personagem avança?                             | **RESOLVIDA** — SRD: por Marcos de Crescimento (5+5+5 por nível); 3 Bônus de Progressão por nível (1 por categoria); recompensas detalhadas na Tabela E                                              |
| **D8**  | Valores de Atributo dos pré-gerados eram legíveis com certeza? | **RESOLVIDA** — confirmados pelo Quickstart; Marcela Corpo 0 provavelmente erro; no VTT: mínimo 1                                                                                                    |
| **D9**  | Quantas Partículas no Grimório de Nível 1?                     | **RESOLVIDA** — SRD: 2 Funções + 3 Objetos + 4 Características (Complementos de nível 1 disponíveis por padrão)                                                                                      |
| **D10** | Existência do livro completo além do Quickstart                | **PARCIALMENTE RESOLVIDA** — o SRD é o documento de referência oficial, complementando o Quickstart. Um livro base completo pode existir com listas maiores de Origens e Habilidades                 |
| **D11** | Função "Mat" (Matar) é canônica?                               | **RESOLVIDA** — NÃO consta no SRD nem na ficha oficial. Excluída do canônico                                                                                                                         |
| **D12** | Símbolos rúnicos das Partículas como assets visuais            | **ABERTA** — o PDF `particulas-v3.pdf` contém os símbolos ilustrados de cada Partícula. O OCR não captura os glifos (são rasterizados). Necessário extrair como imagens ou pedir vetoriais à editora |

---

_Fim do documento. Gerado a partir de leitura integral do `SRD-ETMOS-1.1.pdf` (17 páginas), `Ficha-final.pdf` (2 páginas), `ocr_particulas.txt`, `ocr_ficha.txt`, e das fontes secundárias do Quickstart. Atualizado em 2026-06-11._
