// Слияние геометрий с вершинными цветами.
// Заменяет BufferGeometryUtils из examples/, которые мы не вендорим:
// нам нужен ровно один сценарий — склеить кучу примитивов в одну геометрию,
// чтобы дерево или домик рисовались одним вызовом отрисовки.
import * as THREE from 'three';

/**
 * @param {Array<{geo: THREE.BufferGeometry, matrix?: THREE.Matrix4,
 *   color: THREE.ColorRepresentation, uvScale?: number}>} parts
 * @returns {THREE.BufferGeometry} индексированная геометрия с атрибутом color
 */
export function mergeParts(parts) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  let vertexOffset = 0;
  const col = new THREE.Color();

  for (const part of parts) {
    const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    if (part.matrix) geo.applyMatrix4(part.matrix);
    geo.computeVertexNormals();

    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    col.set(part.color);
    // Развёртка примитивов всегда 0..1 на грань, поэтому крупные стены
    // получают повторение текстуры пропорционально своему размеру.
    const us = part.uvScale ?? 1;

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      uvs.push(uv ? uv.getX(i) * us : 0, uv ? uv.getY(i) * us : 0);
      colors.push(col.r, col.g, col.b);
      indices.push(vertexOffset + i);
    }
    vertexOffset += pos.count;
    geo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Короткая запись матрицы преобразования для деталей постройки. */
export function trs(px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(px, py, pz);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_v, _q, _s);
}

/** Коробка со смещённым центром: удобно строить стены «от пола». */
export function boxPart(w, h, d, x, y, z, color, ry = 0) {
  return { geo: new THREE.BoxGeometry(w, h, d), matrix: trs(x, y, z, 0, ry, 0), color };
}

export function cylPart(rTop, rBot, h, seg, x, y, z, color, rot = null) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  const matrix = rot ? trs(x, y, z, rot[0], rot[1], rot[2]) : trs(x, y, z);
  return { geo, matrix, color };
}

export function conePart(r, h, seg, x, y, z, color) {
  return { geo: new THREE.ConeGeometry(r, h, seg), matrix: trs(x, y, z), color };
}

export function spherePart(r, x, y, z, color, wSeg = 8, hSeg = 6) {
  return { geo: new THREE.SphereGeometry(r, wSeg, hSeg), matrix: trs(x, y, z), color };
}

/** Материал по умолчанию для всей процедурной геометрии с вершинными цветами. */
export function vertexColorMaterial(opts = {}) {
  return new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
}
