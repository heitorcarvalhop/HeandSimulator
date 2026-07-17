import * as THREE from 'three';
import {
  createEdgeMaterial,
  createHologramMaterial,
  createPreviewLineMaterial,
  type HologramMaterialHandle,
} from '../rendering/HologramMaterial';
import {
  PREVIEW_COLLISION_COLOR,
  PREVIEW_VALID_COLOR,
  SELECTED_VOXEL_COLOR,
  type FreeTransform,
  type GridCoord,
  type Voxel,
} from './Voxel';

export interface HeldPieceEntry {
  id: string;
  /** Offset inteiro fixo em relação à célula-âncora (mesma unidade de `PieceDragTarget.localOffset`). */
  localOffset: GridCoord;
  color: string;
}

const CAPACITY_GROWTH = 256;
const CUBE_FILL = 0.9;

/** Renderiza todo o modelo com dois draw calls (cubos instanciados + arestas em lote), independente da quantidade. */
export class VoxelRenderer {
  readonly group = new THREE.Group();

  private readonly hologram: HologramMaterialHandle;
  private readonly edgeMaterial: THREE.LineBasicMaterial;
  private readonly boxGeometry = new THREE.BoxGeometry(CUBE_FILL, CUBE_FILL, CUBE_FILL);
  private readonly edgeLocalPositions: Float32Array;

  private solidMesh: THREE.InstancedMesh;
  private edgesLines: THREE.LineSegments;
  private capacity = CAPACITY_GROWTH;
  private voxelSize: number;
  private lastVersion = -1;
  private orderedIds: string[] = [];

  private readonly previewGroup = new THREE.Group();
  private readonly previewMaterialValid: THREE.LineBasicMaterial;
  private readonly previewMaterialInvalid: THREE.LineBasicMaterial;
  private readonly previewGeometry: THREE.EdgesGeometry;

  /** Peça "na mão": excluída do batch principal e desenhada à parte, seguindo a mão livremente. */
  private readonly heldPieceGroup = new THREE.Group();
  private heldMesh: THREE.InstancedMesh | null = null;
  private heldVoxelIds: Set<string> | null = null;

  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpColor = new THREE.Color();
  private readonly tmpPosition = new THREE.Vector3();
  private readonly tmpQuaternion = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3(1, 1, 1);
  private readonly tmpEdgeVertex = new THREE.Vector3();
  private readonly tmpOffsetFromAnchor = new THREE.Vector3();

  constructor(voxelSize: number) {
    this.voxelSize = voxelSize;
    this.hologram = createHologramMaterial();
    this.edgeMaterial = createEdgeMaterial();

    const edgesGeom = new THREE.EdgesGeometry(this.boxGeometry);
    this.edgeLocalPositions = edgesGeom.getAttribute('position').array as Float32Array;
    edgesGeom.dispose();

    this.solidMesh = this.createInstancedMesh(this.capacity);
    this.edgesLines = new THREE.LineSegments(new THREE.BufferGeometry(), this.edgeMaterial);
    this.edgesLines.frustumCulled = false;

    this.previewGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.previewMaterialValid = createPreviewLineMaterial(new THREE.Color(PREVIEW_VALID_COLOR));
    this.previewMaterialInvalid = createPreviewLineMaterial(new THREE.Color(PREVIEW_COLLISION_COLOR));

    this.group.add(this.solidMesh, this.edgesLines, this.previewGroup, this.heldPieceGroup);
  }

  private createInstancedMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.boxGeometry, this.hologram.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;

    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < capacity; i++) mesh.setColorAt(i, white);
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    return mesh;
  }

  setVoxelSize(size: number): void {
    if (size === this.voxelSize) return;
    this.voxelSize = size;
    this.lastVersion = -1;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    while (this.capacity < required) this.capacity += CAPACITY_GROWTH;

    this.group.remove(this.solidMesh);
    this.solidMesh.dispose();
    this.solidMesh = this.createInstancedMesh(this.capacity);
    this.group.add(this.solidMesh);
    this.group.remove(this.edgesLines);
    this.group.add(this.edgesLines);
  }

  /**
   * Aplica um transform livre (modo de encaixe "livre") em cima da posição de grade normal:
   * gira o offset (em relação à célula-âncora original) e soma o deslocamento contínuo — muta
   * `this.tmpPosition`/`this.tmpQuaternion` in place.
   */
  private applyFreeTransform(freeTransform: FreeTransform): void {
    const anchorBaseX = freeTransform.anchorCell.x * this.voxelSize;
    const anchorBaseY = freeTransform.anchorCell.y * this.voxelSize;
    const anchorBaseZ = freeTransform.anchorCell.z * this.voxelSize;

    this.tmpQuaternion.set(
      freeTransform.quaternion.x,
      freeTransform.quaternion.y,
      freeTransform.quaternion.z,
      freeTransform.quaternion.w,
    );

    this.tmpOffsetFromAnchor
      .set(this.tmpPosition.x - anchorBaseX, this.tmpPosition.y - anchorBaseY, this.tmpPosition.z - anchorBaseZ)
      .applyQuaternion(this.tmpQuaternion);

    this.tmpPosition.set(
      anchorBaseX + freeTransform.offset.x + this.tmpOffsetFromAnchor.x,
      anchorBaseY + freeTransform.offset.y + this.tmpOffsetFromAnchor.y,
      anchorBaseZ + freeTransform.offset.z + this.tmpOffsetFromAnchor.z,
    );
  }

  /**
   * Reconstrói as transformações/cores das instâncias e a geometria das arestas a partir dos
   * voxels atuais. Voxels atualmente "na mão" (`setHeldPiece`) são excluídos daqui — são
   * desenhados à parte, em `heldPieceGroup`. `freeTransforms` (opcional) aplica a orientação
   * contínua das peças soltas no modo de encaixe livre.
   */
  update(voxels: Voxel[], version: number, freeTransforms?: ReadonlyMap<string, FreeTransform>): void {
    if (version === this.lastVersion) return;
    this.lastVersion = version;

    const visibleVoxels = this.heldVoxelIds ? voxels.filter((v) => !this.heldVoxelIds!.has(v.id)) : voxels;

    this.ensureCapacity(visibleVoxels.length);
    this.orderedIds = visibleVoxels.map((v) => v.id);

    const edgePositions = new Float32Array(visibleVoxels.length * this.edgeLocalPositions.length);
    const edgeColors = new Float32Array(visibleVoxels.length * this.edgeLocalPositions.length);
    const vertsPerVoxel = this.edgeLocalPositions.length / 3;

    for (let i = 0; i < visibleVoxels.length; i++) {
      const voxel = visibleVoxels[i];
      this.tmpPosition.set(voxel.gridX * this.voxelSize, voxel.gridY * this.voxelSize, voxel.gridZ * this.voxelSize);
      this.tmpQuaternion.identity();

      const freeTransform = freeTransforms?.get(voxel.groupId);
      if (freeTransform) this.applyFreeTransform(freeTransform);

      this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale.set(this.voxelSize, this.voxelSize, this.voxelSize));
      this.solidMesh.setMatrixAt(i, this.tmpMatrix);

      const colorHex = voxel.selected ? SELECTED_VOXEL_COLOR : voxel.color;
      this.tmpColor.set(colorHex);
      this.solidMesh.setColorAt(i, this.tmpColor);

      const edgeOffset = i * this.edgeLocalPositions.length;
      for (let v = 0; v < vertsPerVoxel; v++) {
        const srcIdx = v * 3;
        const dstIdx = edgeOffset + srcIdx;
        this.tmpEdgeVertex
          .set(this.edgeLocalPositions[srcIdx], this.edgeLocalPositions[srcIdx + 1], this.edgeLocalPositions[srcIdx + 2])
          .applyQuaternion(this.tmpQuaternion);
        edgePositions[dstIdx] = this.tmpEdgeVertex.x * this.voxelSize + this.tmpPosition.x;
        edgePositions[dstIdx + 1] = this.tmpEdgeVertex.y * this.voxelSize + this.tmpPosition.y;
        edgePositions[dstIdx + 2] = this.tmpEdgeVertex.z * this.voxelSize + this.tmpPosition.z;
        edgeColors[dstIdx] = this.tmpColor.r;
        edgeColors[dstIdx + 1] = this.tmpColor.g;
        edgeColors[dstIdx + 2] = this.tmpColor.b;
      }
    }

    this.solidMesh.count = visibleVoxels.length;
    this.solidMesh.instanceMatrix.needsUpdate = true;
    if (this.solidMesh.instanceColor) this.solidMesh.instanceColor.needsUpdate = true;

    this.edgesLines.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3));
    this.edgesLines.geometry = geometry;
  }

  /** Substitui a prévia em wireframe exibida durante o arraste de criação/movimentação. */
  setPreview(cells: GridCoord[], collidingKeys: Set<string>): void {
    this.clearPreview();

    for (const cell of cells) {
      const key = `${cell.x}:${cell.y}:${cell.z}`;
      const material = collidingKeys.has(key) ? this.previewMaterialInvalid : this.previewMaterialValid;
      const line = new THREE.LineSegments(this.previewGeometry, material);
      line.position.set(cell.x * this.voxelSize, cell.y * this.voxelSize, cell.z * this.voxelSize);
      line.scale.setScalar(this.voxelSize);
      line.frustumCulled = false;
      this.previewGroup.add(line);
    }
  }

  clearPreview(): void {
    for (const child of [...this.previewGroup.children]) {
      this.previewGroup.remove(child);
    }
  }

  /**
   * Define a peça "na mão": os `entries.id` somem do batch principal (`update()`) e passam a
   * ser desenhados em `heldPieceGroup`, nos offsets locais fixos em relação à âncora — depois
   * disso, `updateHeldPieceTransform` só move o grupo inteiro (barato, sem reconstruir nada).
   * Passar `null`/lista vazia solta a peça de volta pro batch principal.
   */
  setHeldPiece(entries: HeldPieceEntry[] | null): void {
    if (this.heldMesh) {
      this.heldPieceGroup.remove(this.heldMesh);
      this.heldMesh.dispose();
      this.heldMesh = null;
    }
    this.heldPieceGroup.position.set(0, 0, 0);
    this.heldPieceGroup.quaternion.identity();

    if (!entries || entries.length === 0) {
      this.heldVoxelIds = null;
      this.lastVersion = -1;
      return;
    }

    this.heldVoxelIds = new Set(entries.map((e) => e.id));

    const mesh = new THREE.InstancedMesh(this.boxGeometry, this.hologram.material, entries.length);
    mesh.frustumCulled = false;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      this.tmpPosition.set(entry.localOffset.x * this.voxelSize, entry.localOffset.y * this.voxelSize, entry.localOffset.z * this.voxelSize);
      this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion.identity(), this.tmpScale.set(this.voxelSize, this.voxelSize, this.voxelSize));
      mesh.setMatrixAt(i, this.tmpMatrix);
      this.tmpColor.set(entry.color);
      mesh.setColorAt(i, this.tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.heldMesh = mesh;
    this.heldPieceGroup.add(mesh);
    this.lastVersion = -1;
  }

  /** Chamado a cada frame enquanto a peça está segurada — só move o grupo, nada é reconstruído. */
  updateHeldPieceTransform(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.heldPieceGroup.position.copy(position);
    this.heldPieceGroup.quaternion.copy(quaternion);
  }

  updateTime(seconds: number): void {
    this.hologram.uniforms.uTime.value = seconds;
  }

  getSolidMesh(): THREE.InstancedMesh {
    return this.solidMesh;
  }

  getVoxelIdAtInstance(instanceId: number): string | undefined {
    return this.orderedIds[instanceId];
  }

  /** Caixa delimitadora (em espaço local do modelo) do conjunto atual de voxels. */
  computeLocalBounds(voxels: Voxel[]): THREE.Box3 | null {
    if (voxels.length === 0) return null;
    const box = new THREE.Box3();
    for (const voxel of voxels) {
      this.tmpPosition.set(voxel.gridX * this.voxelSize, voxel.gridY * this.voxelSize, voxel.gridZ * this.voxelSize);
      box.expandByPoint(this.tmpPosition);
    }
    box.expandByScalar(this.voxelSize);
    return box;
  }

  invalidate(): void {
    this.lastVersion = -1;
  }

  dispose(): void {
    this.solidMesh.dispose();
    this.heldMesh?.dispose();
    this.edgesLines.geometry.dispose();
    this.previewGeometry.dispose();
    this.boxGeometry.dispose();
    this.hologram.material.dispose();
    this.edgeMaterial.dispose();
    this.previewMaterialValid.dispose();
    this.previewMaterialInvalid.dispose();
    this.clearPreview();
  }
}
