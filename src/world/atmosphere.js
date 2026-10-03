// Sky, sun, image-based lighting and fog.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export const SUN_ELEVATION = 30; // degrees above horizon (late afternoon)
export const SUN_AZIMUTH = 232; // degrees, measured from +Z toward +X (sun in the south-west-ish)

export function createAtmosphere(renderer, scene) {
  const sunDir = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
  sunDir.setFromSphericalCoords(1, phi, theta);

  // --- sky dome ---
  const sky = new Sky();
  sky.name = 'sky';
  sky.scale.setScalar(4000);
  sky.frustumCulled = false;
  const U = sky.material.uniforms;
  U.turbidity.value = 3.2;
  U.rayleigh.value = 1.6;
  U.mieCoefficient.value = 0.0045;
  U.mieDirectionalG.value = 0.82;
  U.sunPosition.value.copy(sunDir);
  U.cloudCoverage.value = 0.32;
  U.cloudDensity.value = 0.45;
  U.cloudScale.value = 0.00022;
  U.cloudElevation.value = 0.55;
  U.cloudSpeed.value = 0.000015;
  // brightness gain so the sky sits well with the scene exposure
  U.skyGain = { value: 0.62 };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform float time;', 'uniform float time;\nuniform float skyGain;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyGain, 1.0 );');
  sky.material.needsUpdate = true;
  scene.add(sky);

  // --- environment (PMREM from the sky, without the sun disc and clouds for stability) ---
  let envRT = null;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(4000);
    envSky.material.uniforms = sky.material.uniforms; // share
    envSky.material.fragmentShader = sky.material.fragmentShader;
    envScene.add(envSky);
    // ground bounce: a warm grey disc under the sky so the lower hemisphere isn't black
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(3000, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.11, 0.1, 0.085) })
    );
    ground.position.y = -5;
    envScene.add(ground);
    const prevSun = U.showSunDisc.value;
    const prevCloud = U.cloudCoverage.value;
    U.showSunDisc.value = 0;
    const prevGain = U.skyGain.value;
    U.skyGain.value = 1.0;
    envRT = pmrem.fromScene(envScene, 0.02, 0.1, 5000);
    U.showSunDisc.value = prevSun;
    U.cloudCoverage.value = prevCloud;
    U.skyGain.value = prevGain;
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.24;
    pmrem.dispose();
    envSky.geometry.dispose();
  }

  // --- lights ---
  const hemi = new THREE.HemisphereLight(0xc4d6f5, 0x7a6248, 0.12);
  hemi.name = 'hemi';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color().setHSL(0.08, 0.85, 0.78), 3.7);
  sun.name = 'sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const S = 24;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.5;
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  // --- fog matched to the horizon ---
  const fogColor = new THREE.Color().setRGB(0.74, 0.76, 0.8, THREE.SRGBColorSpace);
  scene.fog = new THREE.Fog(fogColor, 180, 1700);
  scene.background = null;

  // try to sample the real horizon color from the rendered sky (post tone-mapping)
  function calibrateFog() {
    if (!renderer) return;
    try {
      const gl = renderer.getContext();
      const cam = new THREE.PerspectiveCamera(30, 1, 1, 10000);
      const s2 = new THREE.Scene();
      const tmp = new THREE.Mesh(sky.geometry, sky.material);
      tmp.scale.copy(sky.scale);
      tmp.frustumCulled = false;
      s2.add(tmp);
      const prev = renderer.getRenderTarget();
      const size = new THREE.Vector2();
      renderer.getDrawingBufferSize(size);
      if (size.x < 8 || size.y < 8) return;
      const prevCov = U.cloudCoverage.value;
      U.cloudCoverage.value = 0;
      const samples = [];
      const prevAuto = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setRenderTarget(null);
      for (const az of [SUN_AZIMUTH + 90, SUN_AZIMUTH - 90, SUN_AZIMUTH + 180, SUN_AZIMUTH + 135, SUN_AZIMUTH - 135]) {
        const a = THREE.MathUtils.degToRad(az);
        cam.position.set(0, 2, 0);
        cam.lookAt(Math.sin(a) * 100, 2 + 100 * Math.tan(THREE.MathUtils.degToRad(1.2)), Math.cos(a) * 100);
        cam.updateMatrixWorld();
        renderer.render(s2, cam);
        const px = new Uint8Array(4);
        gl.readPixels(Math.floor(size.x / 2), Math.floor(size.y / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        samples.push(px);
      }
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(prev);
      U.cloudCoverage.value = prevCov;
      const avg = [0, 0, 0];
      for (const p of samples) for (let k = 0; k < 3; k++) avg[k] += p[k] / samples.length;
      if (avg[0] + avg[1] + avg[2] > 30) {
        scene.fog.color.setRGB(avg[0] / 255, avg[1] / 255, avg[2] / 255, THREE.SRGBColorSpace);
      }
    } catch (e) {
      // keep default
    }
  }

  return { sky, sun, hemi, sunDir, envRT, calibrateFog };
}
