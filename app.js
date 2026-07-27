import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const sceneHost = document.querySelector("#waveScene");
const canvas = document.querySelector("#waveCanvas");
const waveAudio = document.querySelector("#waveAudio");
const audioPlayButton = document.querySelector("#audioPlayButton");
const audioProgress = document.querySelector("#audioProgress");
const audioTime = document.querySelector("#audioTime");
const playIcon = document.querySelector("#playIcon");
const pauseIcon = document.querySelector("#pauseIcon");
const wavelengthSlider = document.querySelector("#wavelengthSlider");
const spectrumRegion = document.querySelector("#spectrumRegion");
const spectrumTicks = document.querySelector("#spectrumTicks");
const contentPanel = document.querySelector(".contentPanel");
const visibleSpectrumZoom = document.querySelector("#visibleSpectrumZoom");
const visibleSpectrumDetail = document.querySelector("#visibleSpectrumDetail");
const spectrumZoomLines = document.querySelector("#spectrumZoomLines");
const spectrumZoomLineStart = document.querySelector("#spectrumZoomLineStart");
const spectrumZoomLineEnd = document.querySelector("#spectrumZoomLineEnd");
let isSeekingAudio = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07111f, 0.025);

/* ========================================================================== 
   ΡΥΘΜΙΣΕΙΣ ΕΜΦΑΝΙΣΗΣ ΚΑΜΠΥΛΩΝ

   Αναζήτησε στο αρχείο τη φράση "WAVE_LINE_STYLE" για να βρεις γρήγορα
   αυτό το σημείο και να αλλάξεις με το χέρι τα χρώματα ή το glow.

   - electricColor / magneticColor: χρώματα σε δεκαεξαδική μορφή Three.js.
   - coreWidth: πάχος της καθαρής κεντρικής γραμμής σε pixels.
   - innerGlowWidth / outerGlowWidth: πόσο απλώνεται το glow σε pixels.
   - innerGlowOpacity / outerGlowOpacity: ένταση glow από 0 (αόρατο) έως 1.

   Για πιο απαλό glow μειώνεις τα opacity.
   Για πιο απλωμένο glow αυξάνεις τα Width.
   ========================================================================== */
const WAVE_LINE_STYLE = {
  electricColor: 0xff5f66,
  magneticColor: 0x6e9dff,
  coreWidth: 2,
  innerGlowWidth: 0,
  innerGlowOpacity: 0.02,
  outerGlowWidth: 6,
  outerGlowOpacity: 0.02,
};

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(9.8, 6.4, 11.5);

let renderer;

try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
} catch (error) {
  document.querySelector("#webglError").hidden = false;
  throw error;
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = false;
controls.minDistance = 8;
controls.maxDistance = 25;
controls.maxPolarAngle = Math.PI * 0.88;
controls.update();

scene.add(new THREE.HemisphereLight(0xa9e9ff, 0x07111f, 2.1));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
keyLight.position.set(2, 7, 8);
scene.add(keyLight);

const waveSystem = new THREE.Group();
scene.add(waveSystem);

// The wave begins on the source cylinder's emitting circular face and ends on the receiver plane.
const waveStart = -5.325;
const waveEnd = 6.15;
// Equal to the source cylinder's radius, so neither field extends beyond its bounds.
const amplitude = 0.825;
const MIN_WAVE_CYCLES = 1.5;
const MAX_WAVE_CYCLES = 32;
const WAVELENGTH_VISUAL_CURVE = 4;
// Keep even the shortest wavelength smooth instead of drawing each cycle
// with only a handful of straight line segments.
const MIN_SAMPLES_PER_CYCLE = 48;
const samples = MAX_WAVE_CYCLES * MIN_SAMPLES_PER_CYCLE + 1;
// World-space units travelled per second. This remains independent of wavelength.
const WAVE_PROPAGATION_SPEED = 0.875;
let cycles = MAX_WAVE_CYCLES;
const MIN_WAVELENGTH = 3e-12;
const MAX_WAVELENGTH = 3e5;
const SPECTRUM_BANDS = [
  { name: "Ακτίνες γ", min: 3e-12, max: 1e-11 },
  { name: "Ακτίνες Χ", min: 1e-11, max: 1e-8 },
  { name: "Υπεριώδης ακτινοβολία", min: 1e-8, max: 4e-7 },
  { name: "Ορατό φως", min: 4e-7, max: 7.5e-7 },
  { name: "Υπέρυθρη ακτινοβολία", min: 7.5e-7, max: 1e-3 },
  { name: "Μικροκύματα", min: 1e-3, max: 1 },
  { name: "Ραδιοκύματα", min: 1, max: 3e5 },
];

function wavelengthToPercent(wavelength) {
  const minExponent = Math.log10(MIN_WAVELENGTH);
  const maxExponent = Math.log10(MAX_WAVELENGTH);
  return (
    ((Math.log10(wavelength) - minExponent) / (maxExponent - minExponent)) *
    100
  );
}

function getSelectedWavelength() {
  const ratio =
    Number(wavelengthSlider.value) / Number(wavelengthSlider.max);
  const minExponent = Math.log10(MIN_WAVELENGTH);
  const maxExponent = Math.log10(MAX_WAVELENGTH);
  return 10 ** THREE.MathUtils.lerp(minExponent, maxExponent, ratio);
}

function getSpectrumRegion(wavelength) {
  const band = SPECTRUM_BANDS.find(
    ({ min, max }) => wavelength >= min && wavelength < max,
  );
  return band?.name ?? SPECTRUM_BANDS.at(-1).name;
}

function renderSpectrumTicks() {
  const boundaries = SPECTRUM_BANDS.slice(1).map(({ min }) => min);
  const visibleBand = SPECTRUM_BANDS.find(
    ({ name }) => name === "Ορατό φως",
  );
  const visibleStart = wavelengthToPercent(visibleBand.min);
  const visibleEnd = wavelengthToPercent(visibleBand.max);
  const visibleSpectrumImage = `
    <img
      class="visibleSpectrumImage"
      src="images/spectrum.png"
      alt=""
      style="left: ${visibleStart}%; width: ${visibleEnd - visibleStart}%;"
    >
  `;
  const ticks = boundaries
    .map(
      (wavelength) =>
        `<span class="spectrumTick" style="left: ${wavelengthToPercent(wavelength)}%;"></span>`,
    )
    .join("");

  spectrumTicks.innerHTML = visibleSpectrumImage + ticks;
  requestAnimationFrame(updateSpectrumZoomLines);
}

function updateSpectrumZoomLines() {
  const smallSpectrum = spectrumTicks.querySelector(".visibleSpectrumImage");
  if (
    !smallSpectrum ||
    !visibleSpectrumDetail.complete ||
    visibleSpectrumZoom.hidden
  ) return;

  const panelBounds = contentPanel.getBoundingClientRect();
  const smallBounds = smallSpectrum.getBoundingClientRect();
  const smallCenter = smallBounds.left + smallBounds.width / 2;

  visibleSpectrumZoom.style.left = `${smallCenter - panelBounds.left}px`;

  const detailBounds = visibleSpectrumDetail.getBoundingClientRect();
  const detailBottom = detailBounds.bottom - panelBounds.top;
  const smallTop = smallBounds.top - panelBounds.top;

  spectrumZoomLines.setAttribute("viewBox", `0 0 ${panelBounds.width} ${panelBounds.height}`);

  spectrumZoomLineStart.setAttribute("x1", detailBounds.left - panelBounds.left);
  spectrumZoomLineStart.setAttribute("y1", detailBottom);
  spectrumZoomLineStart.setAttribute("x2", smallBounds.left - panelBounds.left);
  spectrumZoomLineStart.setAttribute("y2", smallTop);

  spectrumZoomLineEnd.setAttribute("x1", detailBounds.right - panelBounds.left);
  spectrumZoomLineEnd.setAttribute("y1", detailBottom);
  spectrumZoomLineEnd.setAttribute("x2", smallBounds.right - panelBounds.left);
  spectrumZoomLineEnd.setAttribute("y2", smallTop);
}

function updateWavelengthControl() {
  const ratio =
    Number(wavelengthSlider.value) / Number(wavelengthSlider.max);
  const region = getSpectrumRegion(getSelectedWavelength());
  const shortWavelengthInfluence = (1 - ratio) ** WAVELENGTH_VISUAL_CURVE;
  cycles = THREE.MathUtils.lerp(
    MIN_WAVE_CYCLES,
    MAX_WAVE_CYCLES,
    shortWavelengthInfluence,
  );
  spectrumRegion.value = region;
  const isVisibleSpectrum = region === "Ορατό φως";
  visibleSpectrumZoom.hidden = !isVisibleSpectrum;
  spectrumZoomLines.toggleAttribute("hidden", !isVisibleSpectrum);
  if (isVisibleSpectrum) requestAnimationFrame(updateSpectrumZoomLines);
  wavelengthSlider.setAttribute("aria-valuetext", region);
}

wavelengthSlider.addEventListener("input", updateWavelengthControl);
visibleSpectrumDetail.addEventListener("load", updateSpectrumZoomLines);
new ResizeObserver(updateSpectrumZoomLines).observe(contentPanel);
renderSpectrumTicks();
updateWavelengthControl();

function makeWaveSurface(color, orientation) {
  const positions = new Float32Array(samples * 2 * 3);
  const indices = [];

  for (let index = 0; index < samples - 1; index += 1) {
    const point = index * 2;
    indices.push(point, point + 1, point + 2, point + 1, point + 3, point + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);

  const surface = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  surface.userData.orientation = orientation;
  waveSystem.add(surface);
  return surface;
}

const waveLineMaterials = [];

function makeWaveLine(color, orientation, lineWidth, opacity, isGlow = false) {
  const positions = new Float32Array(samples * 3);
  const geometry = new LineGeometry();
  geometry.setPositions(positions);

  const material = new LineMaterial({
    color,
    linewidth: lineWidth,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: isGlow ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  waveLineMaterials.push(material);

  const line = new Line2(geometry, material);
  line.userData.orientation = orientation;
  line.userData.wavePositions = positions;
  line.userData.isWaveLine = true;
  line.renderOrder = isGlow ? 2 : 3;
  waveSystem.add(line);
  return line;
}

function makeGlowingWave(color, orientation) {
  return [
    makeWaveLine(
      color,
      orientation,
      WAVE_LINE_STYLE.outerGlowWidth,
      WAVE_LINE_STYLE.outerGlowOpacity,
      true,
    ),
    makeWaveLine(
      color,
      orientation,
      WAVE_LINE_STYLE.innerGlowWidth,
      WAVE_LINE_STYLE.innerGlowOpacity,
      true,
    ),
    makeWaveLine(color, orientation, WAVE_LINE_STYLE.coreWidth, 1),
  ];
}

const electricSurface = makeWaveSurface(0xc83b46, "electric");
const magneticSurface = makeWaveSurface(0x365bc8, "magnetic");
const electricLines = makeGlowingWave(WAVE_LINE_STYLE.electricColor, "electric");
const magneticLines = makeGlowingWave(WAVE_LINE_STYLE.magneticColor, "magnetic");

function updateWave(object, phase) {
  const isSurface = !object.userData.isWaveLine;
  const positions = isSurface
    ? object.geometry.attributes.position.array
    : object.userData.wavePositions;
  const orientation = object.userData.orientation;

  for (let index = 0; index < samples; index += 1) {
    const progress = index / (samples - 1);
    const x = THREE.MathUtils.lerp(waveStart, waveEnd, progress);
    const value = Math.sin(progress * Math.PI * 2 * cycles - phase) * amplitude;

    if (isSurface) {
      const base = index * 6;
      positions[base] = x;
      positions[base + 1] = 0;
      positions[base + 2] = 0;
      positions[base + 3] = x;
      positions[base + 4] = orientation === "electric" ? value : 0;
      positions[base + 5] = orientation === "magnetic" ? value : 0;
    } else {
      const base = index * 3;
      positions[base] = x;
      positions[base + 1] = orientation === "electric" ? value : 0;
      positions[base + 2] = orientation === "magnetic" ? value : 0;
    }
  }

  if (isSurface) {
    object.geometry.attributes.position.needsUpdate = true;
  } else {
    object.geometry.setPositions(positions);
  }
  object.geometry.computeBoundingSphere();
}

function makeLabel(text, color) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 128;
  const context = labelCanvas.getContext("2d");
  context.font = "700 46px Segoe UI";
  context.textAlign = "center";
  context.fillStyle = color;
  context.fillText(text, 256, 76);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

const source = new THREE.Group();
source.position.x = -6.15;
scene.add(source);

// Cylindrical source: Three.js cylinders are created along Y, so the geometry
// is rotated 90° to point its circular emitting face toward the receiver (+X).
const sourceGeometry = new THREE.CylinderGeometry(0.825, 0.825, 1.65, 64);
sourceGeometry.rotateZ(Math.PI / 2);

const sourceCylinder = new THREE.Mesh(
  sourceGeometry,
  new THREE.MeshStandardMaterial({
    color: 0x123652,
    emissive: 0x0c6380,
    emissiveIntensity: 1.3,
    roughness: 0.28,
    metalness: 0.48,
  }),
);
source.add(sourceCylinder);

source.add(
  new THREE.LineSegments(
    new THREE.EdgesGeometry(sourceGeometry, 18),
    new THREE.LineBasicMaterial({ color: 0x9bf6ff }),
  ),
);

// The luminous circular face is the actual radiation-emitting surface.
const emittingFace = new THREE.Mesh(
  new THREE.CircleGeometry(0.78, 64),
  new THREE.MeshBasicMaterial({
    color: 0x61dafb,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
emittingFace.rotation.y = Math.PI / 2;
emittingFace.position.x = 0.831;
source.add(emittingFace);

const emittingRing = new THREE.Mesh(
  new THREE.RingGeometry(0.75, 0.825, 64),
  new THREE.MeshBasicMaterial({
    color: 0x9bf6ff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
emittingRing.rotation.y = Math.PI / 2;
emittingRing.position.x = 0.836;
source.add(emittingRing);

const sourceLight = new THREE.PointLight(0x61dafb, 8, 8);
source.add(sourceLight);

const sourceLabel = makeLabel("ΠΗΓΗ", "#9bf6ff");
sourceLabel.position.set(0, -1.5, 0);
source.add(sourceLabel);

const receiver = new THREE.Group();
receiver.position.x = 6.15;
scene.add(receiver);

const receiverPanel = new THREE.Mesh(
  new THREE.PlaneGeometry(3.5, 3.5),
  new THREE.MeshStandardMaterial({
    color: 0x284c6e,
    emissive: 0x0b3855,
    emissiveIntensity: 0.65,
    transparent: true,
    opacity: 0.68,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.5,
  }),
);
receiverPanel.rotation.y = Math.PI / 2;
receiver.add(receiverPanel);

const receiverEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(receiverPanel.geometry),
  new THREE.LineBasicMaterial({ color: 0xb6e9ff }),
);
receiverEdges.rotation.y = Math.PI / 2;
receiver.add(receiverEdges);

const receiverLabel = makeLabel("ΔΕΚΤΗΣ", "#d9f3ff");
receiverLabel.position.set(0, -2.25, 0);
receiver.add(receiverLabel);

const propagationArrow = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(waveStart, -2.75, 0),
  waveEnd - waveStart,
  0x9bf6ff,
  0.34,
  0.18,
);
waveSystem.add(propagationArrow);

const directionLabel = makeLabel("ΔΙΕΥΘΥΝΣΗ ΔΙΑΔΟΣΗΣ", "#97aed0");
directionLabel.position.set(0, -3.2, 0);
directionLabel.scale.set(4.6, 1.15, 1);
waveSystem.add(directionLabel);

function resizeRenderer() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  waveLineMaterials.forEach((material) => material.resolution.set(width, height));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

new ResizeObserver(resizeRenderer).observe(sceneHost);
resizeRenderer();

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function updateAudioInterface() {
  const duration = Number.isFinite(waveAudio.duration) ? waveAudio.duration : 0;
  audioProgress.max = duration;
  if (!isSeekingAudio) {
    audioProgress.value = Math.min(waveAudio.currentTime, duration);
  }
  audioTime.value = `${formatAudioTime(waveAudio.currentTime)} / ${formatAudioTime(duration)}`;

  const isPlaying = !waveAudio.paused && !waveAudio.ended;
  // SVGElement does not reliably support the .hidden property in all browsers.
  playIcon.toggleAttribute("hidden", isPlaying);
  pauseIcon.toggleAttribute("hidden", !isPlaying);
  audioPlayButton.setAttribute(
    "aria-label",
    isPlaying ? "Παύση ήχου" : "Αναπαραγωγή ήχου",
  );
  audioPlayButton.title = isPlaying ? "Παύση" : "Αναπαραγωγή";
}

audioPlayButton.addEventListener("click", async () => {
  if (waveAudio.paused) {
    try {
      if (waveAudio.ended) waveAudio.currentTime = 0;
      await waveAudio.play();
    } catch (error) {
      console.error("Η αναπαραγωγή του audio track απέτυχε:", error);
    }
  } else {
    waveAudio.pause();
  }
  updateAudioInterface();
});

audioProgress.addEventListener("pointerdown", () => {
  isSeekingAudio = true;
});

audioProgress.addEventListener("input", () => {
  // While dragging, only preview the selected time. Seeking on every pixel
  // can make the browser report the old time and snap the slider back to zero.
  isSeekingAudio = true;
  const selectedTime = Number(audioProgress.value);
  const duration = Number.isFinite(waveAudio.duration) ? waveAudio.duration : 0;
  audioTime.value = `${formatAudioTime(selectedTime)} / ${formatAudioTime(duration)}`;
});

function finishAudioSeek() {
  const selectedTime = Number(audioProgress.value);
  waveAudio.currentTime = selectedTime;
  // Keep the slider locked at the requested position until the browser
  // confirms the seek through the "seeked" event.
  audioProgress.value = selectedTime;
}

audioProgress.addEventListener("change", finishAudioSeek);
audioProgress.addEventListener("pointercancel", () => {
  isSeekingAudio = false;
  updateAudioInterface();
});

waveAudio.addEventListener("loadedmetadata", updateAudioInterface);
waveAudio.addEventListener("durationchange", updateAudioInterface);
waveAudio.addEventListener("timeupdate", updateAudioInterface);
waveAudio.addEventListener("play", updateAudioInterface);
waveAudio.addEventListener("pause", updateAudioInterface);
waveAudio.addEventListener("ended", updateAudioInterface);
waveAudio.addEventListener("seeked", () => {
  isSeekingAudio = false;
  updateAudioInterface();
});
updateAudioInterface();

const clock = new THREE.Clock();
let previousFrameTime = 0;
let wavePhase = 0;

function render() {
  const elapsed = clock.getElapsedTime();
  const frameDelta = Math.min(elapsed - previousFrameTime, 0.1);
  previousFrameTime = elapsed;
  const waveNumber =
    (Math.PI * 2 * cycles) / (waveEnd - waveStart);
  // Integrating phase frame by frame keeps it continuous when wavelength
  // changes. The source remains the fixed reference point while the spacing
  // between crests expands or contracts toward the receiver.
  wavePhase += frameDelta * WAVE_PROPAGATION_SPEED * waveNumber;
  const phase = wavePhase;

  updateWave(electricSurface, phase);
  updateWave(magneticSurface, phase);
  electricLines.forEach((line) => updateWave(line, phase));
  magneticLines.forEach((line) => updateWave(line, phase));
  // The source oscillates with the same temporal frequency as the emitted wave.
  // Since propagation speed is constant, shorter wavelengths produce a faster pulse.
  const sourceOscillation = Math.sin(phase);
  const pulse = 1 + sourceOscillation * 0.035;
  sourceCylinder.scale.setScalar(pulse);
  emittingFace.material.opacity = 0.24 + sourceOscillation * 0.07;
  sourceLight.intensity = 7 + sourceOscillation * 2;

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

render();
