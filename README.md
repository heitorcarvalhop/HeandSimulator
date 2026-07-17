# Holo Voxel Hands

Aplicação de realidade aumentada executada inteiramente no navegador: a imagem da sua
webcam vira o fundo da cena, suas mãos são rastreadas em tempo real com **MediaPipe Hand
Landmarker**, e você usa gestos (pinça, punho, indicador, mão aberta) para criar, mover,
selecionar, separar, rotacionar e redimensionar estruturas de blocos holográficos
renderizadas com **Three.js**. Não é uma animação pré-programada — cada gesto é
reconhecido a partir dos landmarks reais da câmera e controla diretamente o estado dos
voxels na cena.

## Objetivo

Reproduzir, com implementação própria, o comportamento visto em vídeos de referência de
"hand-tracking + hologramas": esqueleto holográfico ciano sobre as mãos, cubos
holográficos que nascem de um gesto de pinça, uma letra "R" construída com o mesmo
sistema de voxels editáveis, e manipulação completa (mover, girar, escalar, separar
segmentos) usando apenas as mãos — com fallback total por mouse/teclado para ambientes
sem webcam.

## Tecnologias

- **TypeScript** (strict mode)
- **Vite** — dev server e bundler
- **Three.js** — cena 3D, `InstancedMesh`, post-processing (`EffectComposer` +
  `UnrealBloomPass`)
- **@mediapipe/tasks-vision** (`HandLandmarker`) — rastreamento de até 2 mãos, 21
  landmarks cada
- **Vitest** — testes unitários (jsdom)
- **ESLint + Prettier**
- **LocalStorage** — persistência da cena

Sem React/Angular, sem backend. Tudo roda client-side.

## Instalação e execução

```bash
npm install
npm run dev       # http://localhost:5173
```

Outros scripts:

```bash
npm run build      # type-check (tsc) + build de produção (vite build)
npm run preview     # serve o build de produção localmente
npm run test        # roda a suíte Vitest uma vez
npm run test:watch  # Vitest em modo watch
npm run lint         # ESLint
npm run lint:fix
npm run format       # Prettier
```

O `HandLandmarker` carrega o runtime WASM e o modelo `.task` de um CDN (jsDelivr /
Google Cloud Storage) na primeira execução — é necessária conexão com a internet na
primeira carga da página (o navegador cacheia os assets depois).

## Permissão de webcam

Ao abrir a aplicação, uma tela inicial pede para "Ativar câmera". O navegador então
solicita a permissão nativa de câmera. Se a permissão for negada, a câmera não existir,
já estiver em uso por outro app, ou o `HandLandmarker` falhar ao carregar, uma tela de
erro explica o motivo e oferece **"Continuar sem câmera (mouse)"** — a aplicação
continua 100% funcional apenas com mouse e teclado (ver seção de controles alternativos).

## Gestos disponíveis

| Gesto | Ação |
|---|---|
| Pinça em espaço vazio | Cria uma sequência de cubos (arraste para estender a linha) |
| Pinça sobre um cubo | Seleciona e move aquele cubo |
| Pinça mantida > 500 ms sobre um cubo | Passa a mover todo o componente conectado (grupo) |
| Indicador apontado | Realça/seleciona o cubo sob o cursor (hover) |
| Punho fechado (~180 ms) perto do modelo | Move a estrutura inteira (modo automático/construção/edição) ou gira o modelo (modo transformação) |
| Punho fechado numa mão + mão aberta na outra | A mão aberta move e gira o **modelo inteiro** livremente, 1:1 com a mão; o punho é só a chave liga/desliga |
| Punho fechado numa mão + pinça sobre um cubo na outra | Agarra a **peça** (componente conectado) pela ponta, com posição e orientação livres — como segurar um objeto de verdade. Peças não conectadas ao cubo pinçado não se movem |
| Duas mãos em pinça simultânea | Rotaciona (torção) e redimensiona o modelo, ancorado no ponto médio entre as mãos |
| Mão aberta | Solta/confirma a ação atual, gesto instantâneo (sem atraso de debounce) |

O modo **automático** (padrão) decide a ação a partir do contexto, exatamente como a
tabela acima. Os modos **construção**, **edição** e **transformação** (seletor no canto
superior direito) restringem o comportamento: construção só cria voxels, edição só
seleciona/move voxels existentes, transformação faz o punho girar o modelo em vez de
arrastá-lo.

### Segurar uma peça pela ponta (punho + pinça)

Ao soltar a peça, o botão **"Encaixe: 90°/Livre"** na barra de ferramentas decide o que
acontece com ela:

- **Encaixe 90°** (padrão): a orientação arredonda pro múltiplo de 90° mais próximo em
  cada eixo e a peça volta a fazer parte da grade compartilhada — outros blocos continuam
  encaixando nela normalmente, e undo/redo funciona como qualquer outro movimento.
- **Encaixe livre**: a peça fica exatamente na posição/ângulo em que foi solta, sem voltar
  a se alinhar à grade — útil para composições soltas, mas outros blocos não encaixam mais
  nela de forma limpa depois disso.

Enquanto a peça está sendo segurada, ela é desenhada separada do restante do modelo,
acompanhando a mão suavemente; no modo de encaixe 90° um contorno tracejado mostra em
tempo real onde ela encaixaria se fosse solta naquele instante.

### Seleção de segmento

O botão **"Seleção de segmento"** ativa um modo onde a primeira pinça sobre um cubo marca
o início de um segmento e a segunda pinça (sobre outro cubo da mesma estrutura) marca o
fim — todos os voxels conectados entre os dois (calculado por BFS) são selecionados
(contorno amarelo) e podem então ser arrastados juntos, separados do restante da coluna e
reencaixados em outra posição.

### Demonstração da letra R

O botão **"DEMONSTRAÇÃO R"** (ou a tecla `R`) constrói uma letra "R" a partir da mesma
matriz de bits usada por qualquer criação manual de voxels — não é um modelo especial:
os voxels resultantes podem ser selecionados, movidos, separados e apagados normalmente.

## Controles alternativos (mouse/teclado)

A aplicação é totalmente utilizável sem webcam:

| Controle | Ação |
|---|---|
| Clique esquerdo + arraste (espaço vazio) | Cria uma linha de voxels |
| Clique esquerdo + arraste (sobre um cubo) | Move aquele cubo |
| Shift + clique | Seleciona múltiplos cubos (alterna seleção) |
| Botão direito + arraste | Rotaciona o modelo (X/Y) |
| Scroll | Ajusta a profundidade do plano de criação/movimentação |
| `Delete` / `Backspace` | Apaga a seleção atual |
| `Ctrl+Z` | Desfazer |
| `Ctrl+Y` | Refazer |
| `R` | Cria a demonstração da letra R |
| `C` | Limpa toda a cena |
| `D` | Liga/desliga o overlay de debug |

## Arquitetura

```
src/
  main.ts                    Ponto de entrada
  app/
    App.ts                   Orquestrador: liga câmera, tracking, cena, UI e loop principal
    AppState.ts               Estado mutável compartilhado (transform do modelo, settings)
  camera/
    CameraManager.ts          getUserMedia, ciclo de vida do <video>, erros de câmera
  hand-tracking/
    HandTracker.ts            Wrapper do MediaPipe HandLandmarker (correção de espelhamento)
    HandTypes.ts               Tipos, enum de landmarks, GestureType
    LandmarkSmoother.ts         Suavização por landmark/mão (One Euro Filter + deadzone + clamp de velocidade)
    GestureRecognizer.ts        Classificação de pose (pinça com histerese, punho, mão aberta, apontar)
    GestureStateMachine.ts      Debounce de gesto estável por mão + upgrade PUNHO -> GRAB
  interaction/
    InteractionController.ts    Motor de estados (InteractionState) — única fonte de verdade
    CursorController.ts          Cursor holográfico (posição/estado visual por mão)
    SelectionController.ts       Raycasting, hover, seleção simples/múltipla, seleção de segmento
    TransformController.ts       Matemática pura de arraste (voxel/grupo/modelo/duas mãos)
  voxels/
    Voxel.ts / VoxelGrid.ts      Estrutura de dados (Map por chave de grade) + operações
    VoxelBuilder.ts               DDA 3D, eixo dominante, geração da letra R
    VoxelRenderer.ts               InstancedMesh + edges em batch (2 draw calls, independente da contagem)
    ConnectedComponents.ts         BFS: componente conectado, caminho de segmento, checagem de flutuação
    VoxelSerializer.ts             Serialização/validação com versionamento
  rendering/
    SceneManager.ts                Renderer, câmera, luzes, qualidade gráfica
    HologramMaterial.ts             Material holográfico (fresnel, scanline, pulso) via onBeforeCompile
    PostProcessing.ts                EffectComposer + UnrealBloomPass preservando alpha
    CoordinateMapper.ts              screenToWorld / worldToScreen / landmarkToWorld / worldToGrid / gridToWorld
    OverlayRenderer.ts               Canvas 2D: esqueleto da mão, cursores, hover
  history/
    Command.ts / HistoryManager.ts  Command pattern genérico (undo/redo)
    VoxelCommands.ts                 Comandos concretos (add/remove/mover/rotacionar/escalar/limpar)
  ui/
    Hud.ts                           Painel HUD (FPS, câmera, mãos, gestos, modo, voxels...)
    Controls.ts                      Barra de ferramentas recolhível
    MouseFallbackController.ts       Fallback completo por mouse/teclado
  storage/
    StorageService.ts                LocalStorage + import/export JSON
  utils/
    MathUtils.ts / OneEuroFilter.ts
  tests/                             Suíte Vitest (ver "Testes")
```

## Sistema de coordenadas

Existem quatro espaços de coordenadas e o `CoordinateMapper` é a única fonte de conversão
entre eles:

1. **Landmark space** — saída do MediaPipe, normalizada `[0,1]`, relativa ao frame de
   vídeo bruto (não espelhado). O `HandTracker` espelha `x` (`1 - x`) e inverte o rótulo
   `Left`/`Right` antes de qualquer outro código ver o dado, porque o modelo roda sobre o
   frame cru enquanto o `<video>` é exibido espelhado via CSS (`scaleX(-1)`).
2. **Viewport pixel space** — pixels CSS da tela. Como o vídeo usa `object-fit: cover`,
   `videoNormalizedToViewportNormalized()` compensa o corte para que um dedo em um pixel
   da tela corresponda exatamente ao mesmo pixel que um clique de mouse usaria.
3. **World space (Three.js)** — `landmarkToWorld()` lança um raio da câmera através do
   ponto NDC correspondente e o intersecta com o plano `z = profundidade`, onde a
   profundidade vem do `landmark.z` do MediaPipe (suavizado, multiplicado por um fator
   configurável e limitado a `[minZ, maxZ]`).
4. **Grid space (voxels inteiros)** — `worldToGrid()`/`gridToWorld()` arredondam para a
   célula mais próxima dado o tamanho do voxel.

Um objeto permanece exatamente sob o ponto da tela onde foi solto porque a mesma função
`screenToWorld`/`landmarkToWorld` é usada tanto para o cursor quanto para o raycasting de
seleção — não há dois caminhos de conversão divergentes.

## Como funciona a pinça

A distância pinça é normalizada pelo tamanho da palma (`computePalmSize`, média entre a
largura MCP-a-MCP e o comprimento pulso-ao-MCP médio), então funciona igual com a mão
perto ou longe da câmera. `GestureRecognizer` mantém, por mão, um estado de **histerese**:

- inicia a pinça quando `distância_normalizada < startThreshold` (0.38)
- só termina quando `distância_normalizada > endThreshold` (0.55)
- um **debounce** (60 ms) impede alternância rápida perto da fronteira
- a pinça só é "confirmada" (dispara ações) após `minActivationMs` (40 ms) contínuos
- a intensidade (`pinchStrength`, 0–1) é reportada a cada frame para animar o cursor

Acima disso, a `GestureStateMachine` filtra o ruído de classificação: um gesto bruto só
vira o "gesto estável" da mão depois de ~70 ms contínuos — **exceto** PINÇA, NENHUM e MÃO
ABERTA, que promovem instantaneamente porque são, respectivamente, já filtrados por
histerese própria, o estado neutro, e o gesto universal de "soltar/cancelar" (que precisa
ser imediato para nunca prender um arraste por engano).

## Sistema de voxels

Os voxels vivem em `VoxelGrid`, um `Map<string, Voxel>` indexado por `"x:y:z"` para
lookup e checagem de colisão O(1). Toda escrita estrutural passa por essa classe; nada
mais guarda uma segunda cópia do estado. Operações de alto nível:

- **Criação em linha**: ao iniciar uma pinça em espaço vazio, o eixo dominante do
  arraste (X, Y ou Z) é detectado e um algoritmo **DDA 3D** (`dda3D`, em
  `utils/MathUtils.ts`) preenche o caminho célula-a-célula entre o início e a posição
  atual — sempre em wireframe (prévia) até soltar a pinça.
- **Componentes conectados** (`ConnectedComponents.ts`): BFS por adjacência de face,
  usado tanto para "mover grupo" (pinça longa) quanto para checar se uma remoção deixaria
  algum voxel flutuando.
- **Seleção de segmento**: BFS de caminho mais curto entre dois voxels-âncora.
- **Colisão/snapping**: todo arraste é só uma prévia (`TransformController`) até a pinça
  soltar — a grade real (`VoxelGrid`) nunca é tocada durante o arraste, então cancelar é
  sempre grátis e uma posição inválida simplesmente devolve o voxel à origem.

### Renderização

`VoxelRenderer` desenha **qualquer quantidade** de voxels com dois draw calls: um
`THREE.InstancedMesh` para os cubos sólidos (cor por instância via `instanceColor`) e um
único `LineSegments` com geometria de arestas *batchada* manualmente (sem
`EdgesGeometry` por cubo). O material holográfico (`HologramMaterial.ts`) estende
`MeshStandardMaterial` via `onBeforeCompile` para adicionar brilho de borda (fresnel),
scanline animada, grade interna e pulso — mantendo suporte nativo a instancing e
transparência em vez de reescrever um shader do zero.

## Desempenho

- Renderização alvo: 60 FPS (`requestAnimationFrame`)
- Rastreamento de mãos: acompanha o frame rate real da câmera (~30 FPS); uma flag
  `busy` no `HandTracker` impede chamadas concorrentes ao `detectForVideo`
- Redução automática de qualidade: se o FPS médio ficar abaixo de 38 por mais de 4s,
  o bloom é desligado e o pixel ratio é limitado automaticamente
- A aba pausa o loop de renderização e o vídeo quando fica oculta (`visibilitychange`)
- Geometrias/materiais são reutilizados; nenhuma alocação de geometria por frame

## Testes

```bash
npm run test
```

A suíte (Vitest + jsdom) cobre, com dados sintéticos de landmarks (sem precisar de
câmera real, ver `src/tests/fixtures/handPoses.ts`):

- distância de pinça normalizada e sua invariância à escala da mão
- reconhecimento de mão aberta, punho fechado e indicador apontado
- histerese, debounce e confirmação por tempo mínimo da pinça
- a máquina de estados de gestos (debounce + upgrade para GRAB) e o motor de interação
  (`InteractionController`) fazendo uma pinça real criar voxels reais, e um punho/pinça
  real mover um voxel real — incluindo desfazer/refazer do resultado
- conversão de coordenadas (`CoordinateMapper`) e snapping de grade
- algoritmo DDA 3D e eixo dominante
- colisões, componentes conectados, caminho de segmento e detecção de voxels flutuantes
- comandos de undo/redo (adicionar, remover, mover grupo, limpar, composto)
- serialização, validação e recuperação de JSON corrompido
- persistência em LocalStorage (salvar/carregar/exportar/importar)

## Solução de problemas

- **"WebGL indisponível"**: o navegador ou driver de vídeo não suporta WebGL2. Tente
  outro navegador ou atualize os drivers gráficos.
- **Permissão de câmera negada**: clique em "Tentar novamente" após liberar a permissão
  nas configurações do site, ou use "Continuar sem câmera" para o modo mouse.
- **Câmera em uso por outro app** (`NotReadableError` / "Could not start video source"):
  feche outros aplicativos que estejam usando a webcam (Zoom, Teams, OBS, etc.) e tente
  novamente. No `.exe` (Electron), o próprio app já reinicia os serviços **FrameServer**
  e **FrameServerMonitor** (que travam e passam a bloquear qualquer programa) toda vez
  que é aberto — pedindo elevação (UAC) automaticamente antes de abrir a janela
  (`electron/main.cjs`, `resetCameraServices`). No navegador (`npm run dev`), esse reset
  automático não existe: se o erro persistir mesmo sem nenhum outro app usando a câmera,
  dê duplo-clique em `scripts/fix-camera.bat` (mesmo fix, manual) ou reinicie o PC. Se
  persistir depois disso, verifique antivírus com "proteção de webcam" (Kaspersky,
  Norton, ESET, etc.) e o driver da câmera no Gerenciador de Dispositivos.
- **Mãos não aparecem**: verifique iluminação; o MediaPipe precisa de contraste razoável
  entre a mão e o fundo. O HUD mostra "Mãos: 0" quando nada é detectado.
- **FPS baixo**: desligue o bloom no botão "Bloom On/Off" ou aguarde a redução automática
  de qualidade (ativa após ~4s sustentados abaixo de 38 FPS).
- **Gestos "grudando"**: aumente a sensibilidade no controle deslizante; isso ajusta o
  multiplicador de profundidade usado no mapeamento de landmarks para o mundo 3D.
