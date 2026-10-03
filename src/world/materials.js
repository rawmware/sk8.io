// PBR material library. UVs are in meters everywhere; texture.repeat converts to tiles.
import * as THREE from 'three';

// Adds world-space large-scale tint variation (breaks texture repetition) to a standard material.
function addMacro(mat, macroTex, amount = 0.22, scale = 0.012) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.macroMap = { value: macroTex };
    shader.uniforms.macroAmt = { value: amount };
    shader.uniforms.macroScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvMacroPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vMacroPos;\nuniform sampler2D macroMap;\nuniform float macroAmt;\nuniform float macroScale;'
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 mpXZ = vMacroPos.xz + vMacroPos.y * 0.37;
        float mA = texture2D(macroMap, mpXZ * macroScale).r;
        float mB = texture2D(macroMap, mpXZ * macroScale * 5.3 + 0.31).g;
        float mV = mA * 0.65 + mB * 0.35;
        diffuseColor.rgb *= 1.0 + (mV - 0.5) * 2.0 * macroAmt;`
      );
  };
  mat.customProgramCacheKey = () => 'macro' + amount.toFixed(3) + scale.toFixed(4);
  return mat;
}

export function createMaterials(tex) {
  const M = {};
  const std = (o) => new THREE.MeshStandardMaterial(o);

  M.concrete = addMacro(
    std({
      name: 'concrete',
      color: 0xffffff,
      map: tex.concrete.map,
      normalMap: tex.concrete.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: tex.concrete.roughnessMap,
      roughness: 1,
      metalness: 0,
    }),
    tex.macro,
    0.2
  );
  // cast concrete for ledges/blocks/stairs: smooth maps with warmer tint
  M.castConcrete = addMacro(
    std({
      name: 'castConcrete',
      color: 0xc4bfb4,
      map: tex.smooth.map,
      normalMap: tex.smooth.normalMap,
      roughnessMap: tex.smooth.roughnessMap,
      roughness: 1.08,
      metalness: 0,
    }),
    tex.macro,
    0.18,
    0.05
  );
  M.smoothConcrete = addMacro(
    std({
      name: 'smoothConcrete',
      color: 0xd6d2ca,
      map: tex.smooth.map,
      normalMap: tex.smooth.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: tex.smooth.roughnessMap,
      roughness: 0.95,
      metalness: 0,
    }),
    tex.macro,
    0.16,
    0.03
  );
  M.darkConcrete = addMacro(
    std({
      name: 'darkConcrete',
      color: 0x9a968e,
      map: tex.smooth.map,
      normalMap: tex.smooth.normalMap,
      roughnessMap: tex.smooth.roughnessMap,
      roughness: 1.1,
    }),
    tex.macro,
    0.2,
    0.05
  );
  M.asphalt = addMacro(
    std({
      name: 'asphalt',
      color: 0xffffff,
      map: tex.asphalt.map,
      normalMap: tex.asphalt.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: tex.asphalt.roughnessMap,
      roughness: 1,
    }),
    tex.macro,
    0.25,
    0.02
  );
  M.skatelite = std({
    name: 'skatelite',
    color: 0xd8d0c8,
    map: tex.skatelite.map,
    normalMap: tex.skatelite.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: tex.skatelite.roughnessMap,
    roughness: 1.45,
    metalnessMap: tex.skatelite.roughnessMap,
    metalness: 0.6,
  });
  M.skateliteFlat = M.skatelite.clone();
  M.skateliteFlat.polygonOffset = true;
  M.skateliteFlat.polygonOffsetFactor = -2;
  M.skateliteFlat.polygonOffsetUnits = -2;
  M.plywood = std({ name: 'plywood', color: 0xffffff, map: tex.plywood.map, roughness: 0.75 });
  M.paintedWood = std({ name: 'paintedWood', color: 0x7b8e9c, map: tex.plywood.map, roughness: 0.6 });
  M.benchWood = std({ name: 'benchWood', color: 0xb08c66, map: tex.plywood.map, roughness: 0.6 });

  const metalDetail = (o) =>
    std({ roughnessMap: tex.metal.roughnessMap, normalMap: tex.metal.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), ...o });
  M.steel = metalDetail({ name: 'steel', color: 0xc9ccd0, metalness: 1, roughness: 0.55 });
  M.coping = metalDetail({ name: 'coping', color: 0xd8dade, metalness: 1, roughness: 0.42 });
  M.galvanized = std({
    name: 'galvanized',
    color: 0xc4c8cc,
    map: tex.metal.galvMap,
    roughnessMap: tex.metal.roughnessMap,
    metalness: 0.9,
    roughness: 0.8,
  });
  M.darkSteel = metalDetail({ name: 'darkSteel', color: 0x2a2c30, metalness: 0.7, roughness: 0.6 });
  M.paintRed = metalDetail({ name: 'paintRed', color: 0xb3261e, metalness: 0.1, roughness: 0.9 });
  M.paintYellow = metalDetail({ name: 'paintYellow', color: 0xe8b51f, metalness: 0.1, roughness: 0.9 });
  M.paintBlue = metalDetail({ name: 'paintBlue', color: 0x1d5fa8, metalness: 0.1, roughness: 0.9 });
  M.paintGreen = metalDetail({ name: 'paintGreen', color: 0x1f6b47, metalness: 0.1, roughness: 0.95 });
  M.paintBlack = metalDetail({ name: 'paintBlack', color: 0x18191b, metalness: 0.2, roughness: 0.9 });
  M.paintWhite = metalDetail({ name: 'paintWhite', color: 0xe9e7e1, metalness: 0.05, roughness: 1 });
  M.poolCoping = metalDetail({ name: 'poolCoping', color: 0x1b6fd1, metalness: 0.15, roughness: 0.65 });
  M.poolTile = std({
    name: 'poolTile',
    color: 0xffffff,
    map: tex.tile.map,
    normalMap: tex.tile.normalMap,
    roughness: 0.18,
  });
  M.brick = addMacro(
    std({ name: 'brick', color: 0xffffff, map: tex.brick.map, normalMap: tex.brick.normalMap, roughness: 0.92 }),
    tex.macro,
    0.25,
    0.05
  );
  M.paver = std({
    name: 'paver',
    color: 0xb8a89a,
    map: tex.brick.map,
    normalMap: tex.brick.normalMap,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  M.asphaltDecal = M.asphalt.clone();
  M.grass = addMacro(
    std({
      name: 'grass',
      color: 0xffffff,
      map: tex.grass.map,
      normalMap: tex.grass.normalMap,
      roughness: 0.95,
    }),
    tex.macro,
    0.35,
    0.01
  );
  M.dirt = std({ name: 'dirt', color: 0x5a4632, map: tex.smooth.map, roughness: 1 });
  M.bark = std({ name: 'bark', color: 0xffffff, map: tex.bark.map, normalMap: tex.bark.normalMap, roughness: 0.95 });
  M.leaves = std({
    name: 'leaves',
    color: 0xd8e6c0,
    map: tex.leaves,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
  M.bush = std({
    name: 'bush',
    color: 0xa8c090,
    map: tex.leaves,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  M.chainLink = std({
    name: 'chainLink',
    color: 0xd0d4d8,
    map: tex.chain.map,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.01,
    side: THREE.DoubleSide,
    metalness: 0.7,
    roughness: 0.5,
  });
  M.corrugated = std({
    name: 'corrugated',
    color: 0x8a9aa6,
    map: tex.corrugated.map,
    normalMap: tex.corrugated.normalMap,
    metalness: 0.55,
    roughness: 0.5,
  });
  M.corrugatedRust = std({
    name: 'corrugatedRust',
    color: 0x9c5a3c,
    map: tex.corrugated.map,
    normalMap: tex.corrugated.normalMap,
    metalness: 0.3,
    roughness: 0.75,
  });
  M.corrugatedCream = std({
    name: 'corrugatedCream',
    color: 0xd9cfb4,
    map: tex.corrugated.map,
    normalMap: tex.corrugated.normalMap,
    metalness: 0.2,
    roughness: 0.6,
  });
  M.roof = std({ name: 'roof', color: 0x3a3d42, map: tex.smooth.map, roughness: 0.85, metalness: 0.2 });
  M.glass = std({ name: 'glass', color: 0x1d2a33, metalness: 0.2, roughness: 0.08 });
  M.windowFrame = std({ name: 'windowFrame', color: 0x2b2e33, roughness: 0.6, metalness: 0.4 });
  M.rubber = std({ name: 'rubber', color: 0x1a1a1a, roughness: 0.95 });
  M.roadPaint = std({
    name: 'roadPaint',
    color: 0xe9e4d8,
    roughness: 0.75,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  M.roadPaintYellow = M.roadPaint.clone();
  M.roadPaintYellow.color.set(0xe3b023);
  M.curbRed = addMacro(
    std({ name: 'curbRed', color: 0xc0392b, map: tex.smooth.map, roughness: 0.85 }),
    tex.macro,
    0.25,
    0.1
  );
  M.curbYellow = addMacro(
    std({ name: 'curbYellow', color: 0xe8b51f, map: tex.smooth.map, roughness: 0.85 }),
    tex.macro,
    0.25,
    0.1
  );
  M.lampGlow = new THREE.MeshStandardMaterial({
    name: 'lampGlow',
    color: 0xfff4dd,
    emissive: 0xfff1d0,
    emissiveIntensity: 0.6,
    roughness: 0.3,
  });
  M.sign = std({ name: 'sign', map: tex.sign, roughness: 0.5 });
  M.murals = tex.murals.map((m, i) =>
    std({
      name: 'mural' + i,
      map: m,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
  );
  M.vertexColor = std({ name: 'vertexColor', vertexColors: true, roughness: 0.6 });
  M.distant = new THREE.MeshStandardMaterial({ name: 'distant', vertexColors: true, roughness: 1, metalness: 0 });
  M.collider = new THREE.MeshBasicMaterial({ name: 'collider', visible: false, side: THREE.DoubleSide });
  for (const k in M) {
    const m = M[k];
    if (Array.isArray(m)) continue;
    if (m.isMaterial && !m.name) m.name = k;
  }
  return M;
}
