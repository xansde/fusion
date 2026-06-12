# 13 — Áudio e Playlists

- **Título:** Áudio e Playlists
- **Status:** draft v0.1
- **Data:** 2026-06-11
- **Baseada em:**
  - `docs/research/09-foundry-funcionalidades-mesa.md` (seções 4.1–4.8: arquitetura de playlists, modos de reprodução, canais de volume, fade, loop, ambient sounds, scene-linked audio; seção 10.5: módulos de áudio)
  - `docs/research/90-asset-media-management.md` (seção 3.3: formatos de áudio suportados e recomendados; seção 9: implicações arquiteturais)

---

## Objetivo

Especificar o subsistema de áudio do Fusion: modelo de dados de playlists e faixas, modos de reprodução (sequential, shuffle, simultaneous, soundboard), comportamento de fade/crossfade/loop, canais de volume com controle por cliente, protocolo de sincronização de estado de playback pelo servidor autoritativo, sons ambientes no canvas com raio e falloff, streaming HTTP range para arquivos grandes, formatos de áudio suportados e política de desbloqueio de autoplay de browser. Esta spec define **como o áudio é modelado, controlado e sincronizado**. Ela NÃO define o upload e o armazenamento físico de assets (ver `20-assets-e-midia.md`), nem o canal de transporte socket.io (ver `04-rede-e-sincronizacao.md`), nem a renderização do canvas e sua camada de objetos (ver `06-canvas-e-renderizacao.md`).

---

## Escopo

### O que inclui

- Documento `Playlist` e subdocumento embedded `PlaylistSound` com seus campos canônicos.
- Quatro modos de reprodução: `sequential`, `shuffle`, `simultaneous`, `soundboard`.
- Fade in/out por playlist e por faixa (durações configuráveis em ms); crossfade entre faixas em modos sequencial/shuffle.
- Loop por faixa com crossfade interno para eliminar lacuna audível.
- Três canais de volume (`music`, `environment`, `interface`) com slider master por cliente; persistência local no browser.
- Protocolo de sincronização: estado de playback autoritativo no servidor; catch-up de clientes que entram tarde; limite de precisão de posição temporal aceitável.
- `AmbientSound` como placeable no canvas (`SoundsLayer`): raio em unidades de grid, falloff linear/logarítmico, ativação por nível de escuridão.
- Oclusão por paredes (`constrained by walls`) — [V2].
- Spatial audio via panning Howler.js baseado na posição do token do jogador em relação ao emissor.
- Cena com playlist vinculada (autoplay ao ativar a cena).
- Formatos suportados: `mp3`, `ogg`, `webm`, `opus`, `flac`, `wav`.
- Streaming via HTTP range requests para arquivos grandes.
- Upload de assets de áudio — delega ao sistema de assets (ver `20-assets-e-midia.md`).
- Política de desbloqueio de autoplay de browser (AudioContext resumption na primeira interação do usuário).

### O que NÃO inclui

- Upload e organização de arquivos de áudio no filesystem — ver `20-assets-e-midia.md`.
- Protocolo de transporte socket.io das mensagens de controle de playback — ver `04-rede-e-sincronizacao.md`.
- Renderização do canvas e geometria do `SoundsLayer` — ver `06-canvas-e-renderizacao.md`.
- Oclusão de som por paredes (raycast acústico) — [V2].
- Sons embutidos nas macros (ex.: `game.audio.play()` chamado de macro) — ver `14-macros-e-automacao.md`.
- Sons de dados 3D (`@3d-dice/dice-box`) — ver `08-motor-de-rolagens.md`.
- Suporte a dispositivos de áudio Bluetooth externos — [V2].
- MIDI playback — fora do escopo.

---

## Conceitos e terminologia

- **Playlist:** documento de primeiro nível que agrupa uma ou mais faixas (`PlaylistSound`) e define o modo de reprodução, volume master e configurações de fade.
- **PlaylistSound:** subdocumento embedded em `Playlist`; representa uma faixa individual com seu path de asset, volume relativo, configuração de loop, fade e estado de reprodução.
- **Modo de reprodução:** estratégia que define quais faixas tocam e em que ordem: `sequential`, `shuffle`, `simultaneous`, `soundboard`.
- **Canal de volume:** agrupamento lógico de fontes de áudio com volume master independente, controlado localmente por cada cliente: `music` (playlists), `environment` (ambient sounds), `interface` (UI/rolagens/chat).
- **Volume master de canal:** multiplicador floating-point `[0.0, 1.0]` armazenado no `localStorage` do browser do usuário; nunca enviado ao servidor.
- **Volume relativo de faixa:** multiplicador `[0.0, 1.0]` armazenado no documento `PlaylistSound`; define o volume no servidor e é igual para todos os clientes. O volume final ouvido é `volumeMaster * volumeFaixa`.
- **Estado de playback:** objeto de snapshot (`PlaybackState`) gerenciado pelo servidor com os campos: `trackId`, `positionMs` (posição aproximada em ms), `playing` (bool), `volume`, `updatedAt`. É o que clientes recém-conectados usam para catch-up.
- **Fade duration:** duração em milissegundos do fade in/out; pode ser definido na `Playlist` (aplicado entre playlists) e no `PlaylistSound` (aplicado na faixa). Os dois valores são somados quando ambos estão configurados.
- **Crossfade:** sobreposição de fade out da faixa atual com fade in da próxima, eliminando silêncio entre transições em modos sequential/shuffle.
- **Loop seamless:** crossfade interno de uma faixa com ela mesma para eliminar a lacuna audível no ponto de loop nativo do `<audio>`.
- **AmbientSound:** placeable no canvas que representa um emissor de som com raio, volume, falloff e condições de ativação (escuridão).
- **Falloff:** atenuação de volume com a distância entre o token do jogador e o ponto central do `AmbientSound`; pode ser `linear` (volume = 1 - d/radius) ou `logarithmic` (volume = 1 - log(1 + d) / log(1 + radius), perceptivamente mais natural).
- **Scene-linked playlist:** campo `linkedPlaylistId` em uma cena; ao ativar a cena, o servidor inicia automaticamente a playlist vinculada.
- **Soundboard:** modo de reprodução em que faixas da playlist só tocam individualmente sob comando explícito do GM; não há progresso automático.
- **AudioContext:** API Web Audio padrão; deve estar no estado `running` para reproduzir áudio. Browsers exigem interação do usuário para criar/retomar o contexto — política de autoplay.
- **HTTP range request:** requisição `Range: bytes=start-end` que permite streaming progressivo de arquivos de áudio grandes sem baixar o arquivo inteiro antes de iniciar a reprodução.

---

## Decisões

### D1 — Howler.js como biblioteca de áudio cliente; sem Web Audio raw

**Decisão:** usar Howler.js (MIT) como única abstração de áudio no cliente. Não usar Web Audio API diretamente para reprodução de faixas de playlist e ambient sounds.

**Racional:** Howler.js resolve as principais dificuldades cross-browser: gestão de `AudioContext` (resume em interação), fallback automático para HTML5 Audio quando Web Audio não está disponível, suporte a sprite de áudio (útil para soundboard), spatial audio via `pannerAttr` e `pos()`, e loop sem lacuna via Web Audio native looping (diferente do `<audio>` element que tem gap). Elimina código de compatibilidade que seria necessário com Web Audio puro. A licença MIT é compatível com o projeto.

**Alternativas rejeitadas:**

- **Web Audio API diretamente:** máximo controle mas alto custo de implementação; compatibilidade cross-browser inconsistente para spatial audio; loop gap precisa de solução manual.
- **Tone.js:** mais voltado para síntese e music production; overhead desnecessário para VTT.
- **Buzz.js:** biblioteca abandonada, não mantida.

### D2 — Servidor como fonte de verdade do estado de playback; volume é sempre client-side

**Decisão:** o servidor mantém um `PlaybackState` autoritativo para cada playlist ativa. Comandos de controle (play, pause, stop, skip, volume da faixa) são emitidos pelo GM via socket e o servidor propaga para todos os clientes. Volume master dos canais é armazenado exclusivamente no `localStorage` do browser de cada usuário e nunca é enviado ao servidor.

**Racional:** o servidor autoritativo garante que todos os clientes ouçam a mesma trilha ao mesmo tempo (com margem de tolerância de posição). Isso é essencial para imersão e para o uso de "música dramática no clímax". O volume local é sempre pessoal — um jogador com deficiência auditiva pode precisar de volume mais alto sem afetar os outros. Essa separação de responsabilidades evita conflitos de preferência e mantém o banco de dados livre de dados de preferência por usuário.

**Alternativas rejeitadas:**

- **Volume da faixa local:** causaria dessincronização de experiência e conflitos entre usuários.
- **Estado de playback no cliente (peer-to-peer):** sem servidor autoritativo, o catch-up de jogadores que entram tarde seria não-determinístico e dependente de qual cliente está "na frente".

### D3 — Posição temporal: aproximação, não sincronia perfeita

**Decisão:** o `PlaybackState.positionMs` é registrado no servidor no momento do comando `play` e estimado nos clientes como `positionMs + (Date.now() - updatedAt)`. Não há mecanismo de sincronização de sample-accurate. A tolerância aceitável é de ±2 segundos.

**Racional:** sincronização perfeita de áudio em rede (sample-accurate) exigiria NTP-like clock sync e buffering adicional — complexidade desproporcional para trilha sonora de RPG. Diferenças de ±2 segundos em músicas de fundo não são perceptíveis em sessões normais. O único caso problemático seria sincronização de efeito sonoro dramático com evento visual — coberto por [V2] com Web Audio `AudioContext.currentTime` scheduling.

**Alternativas rejeitadas:**

- **NTP-like clock sync (ex.: Cristian's Algorithm):** complexidade alta; necessário apenas para apps de música compartilhada ao vivo (DJ software), não para VTT.
- **Recomeçar a faixa no catch-up:** simples de implementar, mas ruim para UX — um jogador que reconecta não quer que a música reinicie do zero.

### D4 — Loop seamless via Howler.js native loop com crossfade nos pontos de loop

**Decisão:** faixas configuradas com `loop: true` usam o modo `loop` nativo do Howler.js (que usa Web Audio native looping, sem gap). Para faixas que ainda apresentem gap perceptível (especialmente em formato MP3 com cabeçalho LAME), aplicar crossfade interno configurável de 50–500ms entre o fim e o início da faixa.

**Racional:** o Foundry VTT documentadamente tem lacuna audível em loops — seu módulo de terceiros _The Sound of Silence_ resolve com crossfade. O Fusion deve resolver isso nativamente. O loop nativo do Howler.js via Web Audio elimina o gap em OGG/OPUS/WebM; para MP3, o crossfade é necessário. O intervalo 50–500ms é configurável por faixa.

**Alternativas rejeitadas:**

- **Dois `Howl` objects alternados (ping-pong):** funciona mas dobra o uso de memória por faixa; complexidade adicional de scheduling.
- **Ignorar o gap:** experiência degradada notada pela maioria dos usuários em loops de ambient music.

### D5 — Fade e crossfade implementados com Howler.js `fade()` method

**Decisão:** todos os fades (in/out por playlist, in/out por faixa, crossfade entre faixas, loop crossfade) são implementados com `Howl.fade(from, to, duration)` do Howler.js, que usa Web Audio `GainNode.linearRampToValueAtTime` internamente. Curva de fade: equal-power para crossfade entre faixas; linear para fade in/out isolado.

**Racional:** `Howl.fade()` integra com o sistema de volume do Howler (não briga com o volume master), é não-bloqueante e cancela corretamente ao receber novos comandos. A curva equal-power em crossfade evita o "dip" de volume perceptível no ponto de troca que curvas lineares produzem.

**Alternativas rejeitadas:**

- **CSS animations / Web Animations API:** não aplicável a áudio.
- **`setInterval` manual com volume steps:** frágil, impreciso, desperdiça CPU.

### D6 — Spatial audio de AmbientSounds via Howler.js `pos()` + `pannerAttr()`

**Decisão:** `AmbientSound` placeables usam Howler.js spatial audio (`pannerAttr: { panningModel: 'HRTF' }` com `pos(x, y, 0)` em coordenadas normalizadas). O volume do emissor é calculado no cliente como função da distância entre a posição do token do jogador (obtida via estado do canvas) e o ponto central do `AmbientSound`, aplicando a curva de falloff configurada (linear ou logarítmico).

**Racional:** Howler.js encapsula a `PannerNode` do Web Audio, incluindo o modelo HRTF (Head Related Transfer Function) que produz spatial audio convincente mesmo em speakers estéreo. O volume por distância é calculado no cliente (e não no servidor) porque a posição do token é informação já disponível localmente e a atualização precisa ser responsiva (sem round-trip de rede a cada movimento).

**Alternativas rejeitadas:**

- **Panning com `StereoPannerNode` (apenas L/R):** som menos convincente, sem modelo de distância integrado.
- **Cálculo de volume no servidor:** latência inaceitável para updates de posição contínuos; servidor não deve processar posição de câmera de cada cliente.

### D7 — Formatos suportados: OGG como recomendado; MP3 como fallback universal; FLAC apenas para masters

**Decisão:** suportar OGG (recomendado), MP3, WEBM, OPUS, FLAC e WAV para upload. O cliente usa Howler.js com array de sources em ordem de preferência: `['.ogg', '.webm', '.opus', '.mp3']`. FLAC e WAV são aceitos no upload mas o sistema sugere conversão. Safari não suporta OGG/WEBM — para esse browser o fallback automático do Howler.js resolve via MP3.

**Racional:** OGG produz loop limpo e tamanho menor; MP3 tem compatibilidade universal. Howler.js suporta array de sources nativamente (`src: ['sound.ogg', 'sound.mp3']`), selecionando o primeiro que o browser suportar. O Foundry usa exatamente o mesmo conjunto de formatos (`.flac`, `.mp3`, `.wav`, `.ogg`, `.webm`, `.opus`).

**Alternativas rejeitadas:**

- **Apenas MP3:** loop com gap perceptível; qualidade inferior por bitrate.
- **Converter automaticamente no servidor:** FLAC→OGG no upload é desejável mas depende de `ffmpeg` instalado — tornar opcional, não obrigatório (ver `20-assets-e-midia.md`).

### D8 — Streaming via HTTP range requests para arquivos > 5MB

**Decisão:** o servidor Fastify serve assets de áudio com suporte nativo a `Range` headers (`Content-Range`, `Accept-Ranges: bytes`). O Howler.js usa `<audio>` element HTML5 (não XHR/fetch) para faixas acima de 5MB, que triggera automaticamente range requests progressivos no browser. Abaixo de 5MB, o `WebAudio` mode do Howler.js (que carrega o arquivo completo via XHR para melhor loop accuracy) é preferido.

**Racional:** arquivos grandes de áudio (trilha lossless FLAC, ambient music de 30 min) não devem ser baixados completamente antes de tocar. O Fastify tem plugin `@fastify/static` com suporte a range requests built-in. O threshold de 5MB é baseado nas recomendações de bitrate (128–192kbps): arquivos até ~3 minutos ficam abaixo de 5MB em MP3/OGG e se beneficiam do Web Audio mode para loop perfeito.

**Alternativas rejeitadas:**

- **Sempre usar HTML5 audio:** loop gap em alguns formatos; sem controle fino via Web Audio API.
- **Threshold fixo por formato:** complexidade desnecessária; o tamanho é melhor proxy que o formato.

### D9 — Política de autoplay: bloqueio até primeira interação; UI de desbloqueio explícita

**Decisão:** ao conectar, o cliente tenta `audioContext.resume()`. Se bloqueado (estado `suspended`), exibe um overlay/badge de "Clique para ativar áudio" que ao ser clicado chama `audioContext.resume()` e dispara o catch-up de estado. Após desbloqueio, o cliente recebe o `PlaybackState` atual do servidor e inicia a reprodução no ponto correto.

**Racional:** browsers modernos (Chrome 66+, Firefox 74+, Safari 11+) bloqueiam `AudioContext` antes de interação do usuário — não há contorno técnico. A UI de desbloqueio é o padrão adotado por Foundry VTT e pela maioria dos VTTs web. O overlay deve ser mínimo e não-intrusivo (badge no canto, não modal bloqueante).

**Alternativas rejeitadas:**

- **Silenciosamente ignorar e tentar novamente:** cria confusão — o usuário não sabe por que não há áudio.
- **Modal bloqueante:** interrompe o fluxo de entrada na sessão para jogadores.

---

## Requisitos funcionais

### Gestão de playlists

- **REQ-AUD-001** [MVP] O sistema DEVE permitir ao GM criar, renomear e excluir documentos `Playlist` no mundo ativo.
- **REQ-AUD-002** [MVP] O sistema DEVE permitir ao GM adicionar, reordenar e remover faixas (`PlaylistSound`) de uma playlist.
- **REQ-AUD-003** [MVP] Cada faixa DEVE armazenar: `name`, `path` (asset path), `volume` (0.0–1.0), `repeat` (bool), `fadeDuration` (ms, 0 = sem fade), `playing` (bool), `pausedAt` (ms ou null).
- **REQ-AUD-004** [MVP] Cada playlist DEVE armazenar: `name`, `mode` (enum), `playing` (bool), `fade` (ms), `volume` (0.0–1.0), `sounds[]` (embedded `PlaylistSound`), `channel` (enum: `music` | `environment` | `interface`).

### Modos de reprodução

- **REQ-AUD-005** [MVP] O modo `sequential` DEVE reproduzir faixas uma após a outra em ordem de lista; ao terminar a última, recomeçar da primeira se a playlist estiver em loop, ou parar.
- **REQ-AUD-006** [MVP] O modo `shuffle` DEVE reproduzir faixas em ordem aleatória sem repetir a mesma faixa até que todas tenham tocado (Fisher-Yates shuffle na lista); após completar o ciclo, embaralhar novamente.
- **REQ-AUD-007** [MVP] O modo `simultaneous` DEVE iniciar todas as faixas da playlist ao mesmo tempo; cada faixa com seu próprio volume, loop e fade configurados individualmente.
- **REQ-AUD-008** [MVP] O modo `soundboard` DEVE impedir a reprodução automática da playlist como um todo; cada faixa DEVE ser disparada individualmente por clique do GM; múltiplas faixas PODEM tocar simultaneamente no modo soundboard.
- **REQ-AUD-009** [MVP] A playlist DEVE exibir controles de play/pause/stop/skip-next/skip-previous para os modos sequential e shuffle; play/stop para simultaneous; apenas lista de botões por faixa para soundboard.

### Fade e crossfade

- **REQ-AUD-010** [MVP] O sistema DEVE aplicar fade in ao iniciar qualquer faixa e fade out ao encerrá-la, usando a duração configurada em `PlaylistSound.fadeDuration` (0 = corte direto).
- **REQ-AUD-011** [MVP] O sistema DEVE aplicar adicionalmente o fade da playlist (`Playlist.fade`) ao iniciar ou parar a playlist inteira, somado ao fade da faixa.
- **REQ-AUD-012** [MVP] Nos modos sequential e shuffle, o sistema DEVE aplicar crossfade entre faixas consecutivas: iniciar o fade in da próxima `fadeDuration` ms antes do fim da atual, sobrepostos.
- **REQ-AUD-013** [MVP] O crossfade DEVE usar curva equal-power (`GainNode.linearRampToValueAtTime` com compensação de amplitude: `Math.sqrt(t)` para in, `Math.sqrt(1-t)` para out) para evitar dip de volume perceptível na transição.
- **REQ-AUD-014** [MVP] Faixas com `repeat: true` DEVEM usar loop seamless: ao aproximar-se do fim (50–500ms configurável), iniciar crossfade do fim para o começo da mesma faixa para eliminar gap audível em MP3.

### Canais de volume

- **REQ-AUD-015** [MVP] O sistema DEVE manter três canais de volume: `music`, `environment` e `interface`, cada um com slider de 0% a 100% na sidebar de áudio.
- **REQ-AUD-016** [MVP] O volume de cada canal DEVE ser armazenado exclusivamente no `localStorage` do browser do cliente (`fusion.audio.volume.music`, etc.) e NUNCA ser enviado ao servidor.
- **REQ-AUD-017** [MVP] O volume final ouvido por um cliente DEVE ser o produto: `canal.volume × playlist.volume × faixa.volume`.
- **REQ-AUD-018** [MVP] O GM DEVE poder ajustar `playlist.volume` e `faixa.volume` via UI; essa mudança DEVE ser propagada a todos os clientes via socket e persistida no documento.
- **REQ-AUD-019** [MVP] Cada cliente DEVE poder ajustar o volume de cada canal via slider local sem afetar outros usuários.
- **REQ-AUD-020** [MVP] O canal `interface` DEVE controlar sons de UI: notificações de chat, sons de dados 3D (`@3d-dice/dice-box`), sons de abertura de janelas.

### Sincronização de playback

- **REQ-AUD-021** [MVP] O servidor DEVE manter um `PlaybackState` por playlist ativa com: `playlistId`, `currentSoundId` (null em simultaneous/soundboard), `positionMs` (timestamp do início da faixa em ms relativos ao início da faixa), `playing`, `volume`, `updatedAt` (epoch ms do servidor).
- **REQ-AUD-022** [MVP] Ao conectar ou reconectar, o cliente DEVE solicitar o `PlaybackState` de todas as playlists ativas e iniciar a reprodução estimando a posição como `positionMs + (Date.now() - updatedAt)`, clamped ao duration da faixa.
- **REQ-AUD-023** [MVP] A margem de imprecisão de posição temporal aceitável é de ±2 segundos; nenhum mecanismo adicional de sincronização de clock é necessário no MVP.
- **REQ-AUD-024** [MVP] Ao executar `play`, `pause`, `stop` ou `skip`, o servidor DEVE atualizar o `PlaybackState` e emitir evento `audio:playback-state` para todos os clientes conectados via socket.io.
- **REQ-AUD-025** [MVP] O servidor DEVE rejeitar comandos de controle de playlist enviados por clientes sem role de GM (ver `05-usuarios-e-permissoes.md`); apenas o GM pode iniciar, pausar, parar ou pular faixas.
- **REQ-AUD-026** [MVP] Clientes DEVEM poder pausar/retomar o áudio localmente (mute rápido) sem afetar o estado do servidor; ao des-mutar, sincronizar com o estado atual do servidor.

### Sons ambientes no canvas

- **REQ-AUD-027** [MVP] O sistema DEVE suportar placeables `AmbientSound` no canvas com: `path` (asset), `radius` (unidades de grid), `volume` (0.0–1.0), `easing` (enum: `linear` | `logarithmic`), `loop` (bool, default true), `darknessActivation` (objeto `{ min: 0.0, max: 1.0 }` — intervalo de nível de escuridão que ativa o som).
- **REQ-AUD-028** [MVP] O volume de um `AmbientSound` ouvido por um cliente DEVE ser calculado localmente com base na distância entre o token controlado pelo jogador e o centro do emissor, aplicando a curva de `easing` configurada, chegando a zero na borda do raio.
- **REQ-AUD-029** [MVP] Quando o nível de escuridão da cena estiver fora do intervalo `darknessActivation`, o `AmbientSound` DEVE ser silenciado (volume zero); quando entrar no intervalo, DEVE fazer fade in gradual.
- **REQ-AUD-030** [MVP] Múltiplos `AmbientSounds` DEVEM poder se sobrepor; o volume de cada um é calculado independentemente e somado no mixer (clamped a 1.0).
- **REQ-AUD-031** [MVP] Ambient sounds DEVEM usar o canal `environment` para aplicação do volume master do cliente.
- **REQ-AUD-032** [MVP] O GM DEVE poder pré-ouvir um `AmbientSound` durante a edição, tratando a posição do cursor como posição do token para cálculo de volume.
- **REQ-AUD-033** [V2] O sistema DEVE suportar oclusão de `AmbientSound` por paredes (raycasting acústico): sons bloqueados por parede sólida DEVEM ter volume atenuado proporcionalmente à espessura da oclusão.

### Spatial audio

- **REQ-AUD-034** [MVP] O sistema DEVE usar Howler.js `pannerAttr` com `panningModel: 'HRTF'` e `pos(x, y, 0)` para posicionamento espacial de `AmbientSounds`, onde `(x, y)` são coordenadas normalizadas em relação ao viewport do canvas (centro = 0,0).
- **REQ-AUD-035** [MVP] A posição do "ouvinte" (câmera Howler/Web Audio `Listener`) DEVE ser atualizada ao mover o token controlado pelo jogador, com throttle de 50ms para evitar overhead.

### Playlist vinculada à cena

- **REQ-AUD-036** [MVP] Cenas DEVEM ter um campo opcional `linkedPlaylistId`; ao ativar a cena, o servidor DEVE iniciar automaticamente a playlist vinculada (se não estiver já tocando) e fazer fade out das playlists do canal `music` que estavam tocando antes.
- **REQ-AUD-037** [MVP] O fade out das playlists anteriores e o fade in da nova DEVEM ser executados concorrentemente, usando as durações de fade configuradas nas respectivas playlists.

### Formatos e streaming

- **REQ-AUD-038** [MVP] O servidor DEVE suportar os seguintes formatos de áudio para upload e serving: `mp3`, `ogg`, `webm`, `opus`, `flac`, `wav`. Extensões reconhecidas: `.mp3`, `.ogg`, `.oga`, `.webm`, `.opus`, `.flac`, `.wav`.
- **REQ-AUD-039** [MVP] O servidor Fastify DEVE responder corretamente a requisições com header `Range: bytes=N-M` para assets de áudio, retornando `206 Partial Content` com os headers `Content-Range`, `Accept-Ranges: bytes` e `Content-Length` corretos.
- **REQ-AUD-040** [MVP] O cliente DEVE usar o modo `html5: true` do Howler.js para faixas cujo tamanho de arquivo seja superior a 5MB, ativando streaming progressivo via `<audio>` element (que usa range requests automaticamente).
- **REQ-AUD-041** [MVP] O cliente DEVE usar o modo `WebAudio` (padrão do Howler.js, XHR completo) para faixas com tamanho ≤ 5MB, para obter loop accuracy superior.
- **REQ-AUD-042** [MVP] O sistema DEVE exibir aviso na UI de configuração de faixas quando um arquivo `.wav` ou `.flac` for selecionado, sugerindo conversão para OGG ou MP3 para melhor desempenho.

### Desbloqueio de autoplay

- **REQ-AUD-043** [MVP] Ao conectar, o cliente DEVE tentar `audioContext.state === 'running'`; se o estado for `suspended`, DEVE exibir um badge não-intrusivo no canto inferior da UI com texto "Clique para ativar áudio".
- **REQ-AUD-044** [MVP] Ao clicar em qualquer elemento interativo da UI do Fusion (não apenas no badge), o cliente DEVE chamar `audioContext.resume()` e remover o badge ao receber o evento `statechange` com valor `running`.
- **REQ-AUD-045** [MVP] Após desbloqueio do `AudioContext`, o cliente DEVE imediatamente solicitar o `PlaybackState` do servidor e iniciar o catch-up de áudio (ver REQ-AUD-022).
- **REQ-AUD-046** [MVP] O badge de desbloqueio DEVE ser visível apenas quando necessário (estado `suspended`) e NUNCA deve bloquear interação com o canvas.

### Controles do GM na sidebar

- **REQ-AUD-047** [MVP] A sidebar de Playlists DEVE listar todas as playlists do mundo com indicador de reprodução (ícone animado na faixa ativa).
- **REQ-AUD-048** [MVP] O GM DEVE poder clicar em qualquer faixa para disparar reprodução imediata, mesmo fora da ordem da playlist (override de posição).
- **REQ-AUD-049** [MVP] O GM DEVE poder ajustar o volume de uma faixa individual via slider; a mudança DEVE ser propagada ao servidor e a todos os clientes.
- **REQ-AUD-050** [MVP] O GM DEVE poder parar toda a reprodução de áudio com um botão "Stop All" na sidebar, fazendo fade out de todas as playlists e ambient sounds ativos simultaneamente.

---

## Requisitos não-funcionais

- **REQ-AUD-NF-001** [MVP] O sistema de áudio DEVE funcionar sem degradação perceptível de framerate do canvas; o processamento de áudio DEVE ocorrer em `AudioWorklet` quando disponível, ou no main thread com throttle, sem janks acima de 16ms.
- **REQ-AUD-NF-002** [MVP] O catch-up de estado de áudio ao conectar DEVE completar em menos de 1 segundo em condição de rede LAN.
- **REQ-AUD-NF-003** [MVP] O estado `PlaybackState` de todas as playlists ativas DEVE ser persistido no banco `world.db` a cada mudança de faixa, de forma que um reinício do servidor retome o estado correto.
- **REQ-AUD-NF-004** [MVP] O sistema DEVE suportar até 10 playlists ativas simultaneamente (em modo simultaneous) sem degradação de performance de rede.
- **REQ-AUD-NF-005** [MVP] O sistema DEVE suportar até 20 `AmbientSounds` ativos em uma cena sem degradação de framerate perceptível no canvas (medido em hardware de referência: Intel i5 de 8a geração).
- **REQ-AUD-NF-006** [MVP] Assets de áudio DEVEM ser servidos com `Cache-Control: public, max-age=3600` para permitir caching no browser dos jogadores sem stale prolongado.
- **REQ-AUD-NF-007** [V2] Ambient sounds com oclusão de paredes NÃO DEVEM aumentar o tempo de frame em mais de 2ms em cenas com até 100 paredes e 10 emissores simultâneos.

---

## Modelo de dados

```typescript
// packages/shared/src/documents/playlist.ts

export type PlaylistMode = "sequential" | "shuffle" | "simultaneous" | "soundboard";

export type AudioChannel = "music" | "environment" | "interface";

export type FalloffCurve = "linear" | "logarithmic";

/** Subdocumento embedded em Playlist */
export interface PlaylistSoundData {
  _id: string;
  name: string;
  /** Path relativo ao storage (ex.: "assets/audio/theme.ogg") */
  path: string;
  /** Volume relativo [0.0, 1.0]; multiplicado pelo volume da playlist e do canal */
  volume: number;
  /** Loop contínuo com crossfade seamless */
  repeat: boolean;
  /** Duração do fade in/out em ms; 0 = sem fade */
  fadeDuration: number;
  /** Duração do crossfade interno de loop em ms (para MP3 com gap); 0 = loop nativo */
  loopCrossfadeMs: number;
  /** Estado gerenciado pelo servidor — não deve ser editado diretamente pelo cliente */
  playing: boolean;
  /** Posição de pause em ms, null se não pausado */
  pausedAt: number | null;
}

/** Documento de primeiro nível */
export interface PlaylistData {
  _id: string;
  name: string;
  mode: PlaylistMode;
  /** Canal de volume ao qual esta playlist pertence */
  channel: AudioChannel;
  /** Volume master da playlist [0.0, 1.0]; multiplicado pelo volume do canal */
  volume: number;
  /** Fade aplicado ao iniciar/parar a playlist inteira, em ms */
  fade: number;
  /** Estado gerenciado pelo servidor */
  playing: boolean;
  /** Faixas embedded */
  sounds: PlaylistSoundData[];
  /** Permissões por usuário */
  ownership: Record<string, number>;
}

/** Estado de playback autoritativo mantido pelo servidor */
export interface PlaybackState {
  playlistId: string;
  /** null em modo simultaneous e soundboard */
  currentSoundId: string | null;
  /** Posição estimada em ms desde o início da faixa atual */
  positionMs: number;
  playing: boolean;
  /** Volume atual da playlist (pode ter sido alterado em tempo real) */
  volume: number;
  /** epoch ms do servidor no momento da última atualização */
  updatedAt: number;
}

/** Placeable no canvas */
export interface AmbientSoundData {
  _id: string;
  /** Coordenadas do centro do emissor em pixels de canvas */
  x: number;
  y: number;
  /** Raio de alcance em unidades de grid */
  radius: number;
  /** Path relativo ao storage */
  path: string;
  /** Volume base [0.0, 1.0] no centro do emissor */
  volume: number;
  /** Curva de atenuação com a distância */
  easing: FalloffCurve;
  /** Loop contínuo (padrão: true para ambient sounds) */
  repeat: boolean;
  /** Intervalo de nível de escuridão que ativa o som [0.0, 1.0] */
  darknessActivation: {
    min: number; // default 0.0
    max: number; // default 1.0
  };
  /** Oculto dos jogadores no canvas (apenas GM vê o ícone) */
  hidden: boolean;
}

/** Evento socket emitido pelo servidor para atualizar clientes */
export interface AudioPlaybackEvent {
  type: "audio:playback-state";
  payload: PlaybackState;
}

/** Evento emitido quando o GM para toda a reprodução */
export interface AudioStopAllEvent {
  type: "audio:stop-all";
  /** Duração do fade out em ms */
  fadeMs: number;
}

/** Preferências de volume armazenadas no localStorage do cliente (nunca no servidor) */
export interface ClientAudioPreferences {
  "fusion.audio.volume.music": number; // default 0.8
  "fusion.audio.volume.environment": number; // default 0.6
  "fusion.audio.volume.interface": number; // default 0.5
  "fusion.audio.unlocked": boolean; // true após primeiro audioContext.resume()
}
```

---

## API e eventos

### Eventos socket.io (servidor → clientes)

| Evento                 | Payload                   | Descrição                                                           |
| ---------------------- | ------------------------- | ------------------------------------------------------------------- |
| `audio:playback-state` | `PlaybackState`           | Estado atualizado de uma playlist (play, pause, stop, skip, volume) |
| `audio:stop-all`       | `{ fadeMs: number }`      | Parar toda a reprodução com fade out                                |
| `audio:ambient-update` | `AmbientSoundData[]`      | Lista de ambient sounds atualizada na cena ativa                    |
| `audio:scene-linked`   | `{ sceneId, playlistId }` | Cena ativada com playlist vinculada                                 |

### Mensagens socket.io (cliente GM → servidor)

| Mensagem              | Payload                                       | Validação no servidor                                  |
| --------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `audio:play`          | `{ playlistId, soundId? }`                    | Role ≥ GM; playlist existe no mundo                    |
| `audio:pause`         | `{ playlistId }`                              | Role ≥ GM                                              |
| `audio:stop`          | `{ playlistId, fadeMs? }`                     | Role ≥ GM                                              |
| `audio:skip`          | `{ playlistId, direction: 'next' \| 'prev' }` | Role ≥ GM; modo não é simultaneous/soundboard          |
| `audio:set-volume`    | `{ playlistId, soundId?, volume: number }`    | Role ≥ GM; volume ∈ [0.0, 1.0]                         |
| `audio:stop-all`      | `{ fadeMs?: number }`                         | Role ≥ GM                                              |
| `audio:request-state` | `{}`                                          | Qualquer role; retorna array de `PlaybackState` ativos |

### REST endpoints (Fastify)

| Método   | Rota                                 | Descrição                                                              |
| -------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `GET`    | `/api/worlds/:worldId/playlists`     | Lista playlists do mundo                                               |
| `POST`   | `/api/worlds/:worldId/playlists`     | Cria playlist (body: `Partial<PlaylistData>`)                          |
| `PATCH`  | `/api/worlds/:worldId/playlists/:id` | Atualiza playlist (metadados, não estado de playback)                  |
| `DELETE` | `/api/worlds/:worldId/playlists/:id` | Remove playlist                                                        |
| `GET`    | `/assets/*`                          | Serving estático com suporte a `Range` headers (via `@fastify/static`) |

### API interna do cliente (Svelte store + módulos)

```typescript
// packages/client/src/audio/AudioManager.ts (interface pública)

interface AudioManager {
  /** Inicia reprodução de uma playlist */
  play(playlistId: string, soundId?: string): Promise<void>;

  /** Pausa reprodução */
  pause(playlistId: string): Promise<void>;

  /** Para reprodução com fade out opcional */
  stop(playlistId: string, fadeMs?: number): Promise<void>;

  /** Para toda a reprodução (Stop All) */
  stopAll(fadeMs?: number): Promise<void>;

  /** Aplica catch-up de estado recebido do servidor */
  applyPlaybackState(state: PlaybackState): void;

  /** Retorna o volume final calculado para uma faixa (canal * playlist * faixa) */
  getEffectiveVolume(playlistId: string, soundId: string): number;

  /** Resolve o AudioContext e remove o badge de desbloqueio */
  unlock(): Promise<void>;

  /** Atualiza a posição do ouvinte para spatial audio (throttled 50ms) */
  setListenerPosition(x: number, y: number): void;

  /** Registra/atualiza um AmbientSound no canvas */
  registerAmbientSound(data: AmbientSoundData): void;

  /** Remove um AmbientSound do canvas */
  unregisterAmbientSound(id: string): void;
}
```

---

## Dependências

- `04-rede-e-sincronizacao.md` — protocolo socket.io de broadcast de eventos de playback; formato de mensagem de erro quando GM tenta controlar áudio sem permissão.
- `05-usuarios-e-permissoes.md` — roles: apenas GM pode emitir comandos de controle; qualquer role pode solicitar estado atual e ajustar volume de canal local.
- `06-canvas-e-renderizacao.md` — `SoundsLayer` como layer do canvas que renderiza ícones dos `AmbientSound` placeables; acesso às coordenadas do token para cálculo de distância.
- `07-visao-iluminacao-fog.md` — nível de escuridão da cena usado em `AmbientSoundData.darknessActivation`; paredes usadas em oclusão acústica [V2].
- `20-assets-e-midia.md` — upload, armazenamento físico, paths e serving de arquivos de áudio; thumbnails e metadados de assets.
- `03-persistencia-e-mundos.md` — persistência do `PlaybackState` no `world.db` entre reinícios do servidor; tabela/coleção de playlists.
- `11-ui-framework-e-fichas.md` — sidebar de Playlists como componente Svelte 5; badge de desbloqueio de autoplay.

---

## Critérios de aceitação

1. O GM consegue criar uma playlist, adicionar três faixas OGG, configurar modo sequential e iniciá-la; todos os clientes conectados passam a ouvir a mesma faixa dentro de ±2 segundos.
2. Um jogador que conecta 30 segundos após o início da playlist recebe o estado correto e começa a ouvir a partir da posição estimada (sem reiniciar do início).
3. O GM para toda a reprodução com "Stop All"; todos os clientes silenciam em fade out de 2 segundos.
4. Uma faixa em modo loop com arquivo MP3 não apresenta gap audível perceptível após 5 ciclos de loop (crossfade seamless funcionando).
5. Um `AmbientSound` colocado a 10 unidades de grid do token do jogador toca a 100% do volume base; a 5 unidades da borda do raio toca a ~50% (linear) ou ~70% (logarítmico); fora do raio silencia completamente.
6. Com slider `music` do cliente em 50%, a faixa toca a 50% do volume configurado na playlist, sem afetar outros clientes.
7. Com a aba do browser recém-aberta (AudioContext suspended), o badge de desbloqueio aparece; ao clicar em qualquer botão da UI, o áudio inicia corretamente.
8. Um arquivo de áudio de 50MB é servido com range requests; o áudio inicia em menos de 3 segundos sem aguardar o download completo.
9. Uma cena com `linkedPlaylistId` configurado, ao ser ativada pelo GM, faz fade out da playlist anterior e fade in da nova automaticamente.
10. No modo soundboard, nenhuma faixa toca automaticamente; ao clicar em uma faixa individual, apenas ela toca; clicar em outra a inicia simultaneamente sem parar a primeira.

---

## Questões em aberto

1. **Múltiplos tokens por jogador:** quando um jogador controla mais de um token, qual posição usar para cálculo de distância dos `AmbientSounds`? Usar o token "focado" (último selecionado), a média das posições, ou o token mais próximo de cada emissor?
2. **Persistência do `PlaybackState` entre reinícios:** ao reiniciar o servidor, deve-se retomar a playlist exatamente onde parou (posição em ms) ou apenas reiniciar a faixa do começo? Retomar por posição pode causar estranheza se o servidor ficou offline por horas.
3. **Limite de `AmbientSounds` por cena:** o REQ-AUD-NF-005 define 20 como limite de performance. Deve haver um hard limit (servidor rejeita mais de 20) ou apenas um aviso? Se hard limit, GMs com mapas complexos podem precisar de mais.
4. **Sincronização de posição em modo simultaneous:** em modo simultaneous com faixas de durações diferentes, como garantir que todas as faixas estejam sincronizadas entre clientes? A posição individual de cada faixa precisa de `PlaybackState` separado por `soundId`?
5. **Volume de canal no GM vs. jogadores:** o GM deve poder configurar um "volume sugerido" que serve de default inicial para novos jogadores? Ou cada jogador sempre começa em 80%?
6. **Fade ao trocar de cena sem playlist vinculada:** ao navegar para uma cena sem `linkedPlaylistId`, as playlists existentes continuam tocando ou fazem fade out? Qual deve ser o comportamento padrão configurável?
7. **Preloading de faixas:** o Foundry suporta preloading de áudio para garantir starts sincronizados. O Fusion deve implementar um mecanismo de `audio:preload` que envia o buffer ao cliente antes do play? Necessário para efeitos sonoros dramáticos de combate.
8. **Soundboard com volume individual:** no modo soundboard, múltiplas faixas tocam simultaneamente; deve haver um controle de volume por instância ativa (não apenas por faixa configurada) para fade independente de cada som disparado?

---

## Referências

- `docs/research/09-foundry-funcionalidades-mesa.md` — seções 4 (Playlists e Áudio) e 10.5 (Módulos de Áudio)
- `docs/research/90-asset-media-management.md` — seção 3.3 (Formatos de Áudio) e seção 9 (Implicações para o Fusion)
- [Howler.js — GitHub (goldfire/howler.js)](https://github.com/goldfire/howler.js) — MIT License
- [Web Audio API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [AudioContext.resume() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume)
- [HTTP Range Requests — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests)
- [Playlists — Foundry VTT Knowledge Base](https://foundryvtt.com/article/playlists/) (referência de comportamento, clean-room)
- [Ambient Sound — Foundry VTT Knowledge Base](https://foundryvtt.com/article/ambient-sound/) (referência de comportamento, clean-room)
- [The Sound of Silence — GitHub (GnollStack)](https://github.com/GnollStack/The-Sound-of-Silence) (referência de crossfade e fade curves)
- [Equal-Power Crossfade — Web Audio API Book](https://webaudioapi.com/book/Web_Audio_API_Boris_Smus_html/ch02.html)
- [@fastify/static — npm](https://www.npmjs.com/package/@fastify/static) (range request support)
- `specs/04-rede-e-sincronizacao.md`
- `specs/05-usuarios-e-permissoes.md`
- `specs/06-canvas-e-renderizacao.md`
- `specs/07-visao-iluminacao-fog.md`
- `specs/20-assets-e-midia.md`
