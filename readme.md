# Stylised Worlds 🌲🌾

A high-performance, procedural, stylized open-world environment built with **Three.js** and **WebXR (Meta Quest VR)**.

Designed for buttery-smooth 72/90 FPS in standalone VR and desktop browsers with zero CPU bottlenecking.

---

## 🌟 Key Features

- **100% GPU-Driven Procedural Grass**:
  - Up to **180,000 instanced grass blades** with dynamic radius and density controls.
  - Placement, toroidal grid wrapping, heightmap sampling, terrain color matching, biome culling, and wind sway run **100% on the GPU vertex shader**.
  - **Zero CPU overhead per frame** (1.10 µs per frame, no array re-computations or GPU buffer transfers).
  - Inclined resting lean and dual-octave scrolling Simplex/Perlin noise wind waves.
- **Streamed Terrain Heightmap & Ground Blending**:
  - Continuous 512×512 32-bit floating-point DataTexture heightmap sampled with hardware bilinear interpolation (`THREE.LinearFilter`).
  - Grass blades sit exactly on the terrain mesh with **zero vertical offset**.
  - Dynamic ground-contact color and normal blending for trees, rocks, and mountains.
- **Atmospheric Environment & Lighting**:
  - Procedural atmospheric sky dome shader with sun disk and horizon gradients.
  - Cascaded directional sunlight with frozen PCF soft shadows optimized for Quest.
  - Multi-directional wave-displaced water surface with shoreline depth fade and reflection cubemap.
  - 3,600 animated fireflies with organic bobbing.
- **WebXR & Desktop Controls**:
  - **VR Mode**: Discrete 45° snap-turning on the right thumbstick, head-relative movement on the left thumbstick, wrist-mounted live FPS & triangle tracker.
  - **Desktop Walk Mode (`V`)**: First-person WASD locomotion with ground height snapping and gravity jump.
  - **Desktop Orbit Mode**: Smooth orbiting and WASD camera panning with post-processing bloom toggle (`P`).

---

## 🚀 Quick Start

### Serve Locally
```bash
npx serve -l 8000 .
# or
python -m http.server 8000
```
Open **`http://localhost:8000/forest.html`** in your desktop browser or Meta Quest Browser.

### Meta Quest Launch via ADB
```bash
node launch_quest.js
```

---

## 📁 Project Architecture

```
├── forest.html          # Main HTML entry point with real-time UI controls
├── launch_quest.js      # ADB automation to forward ports & launch Quest Browser
├── src/
│   ├── main.js          # Core loop, scene orchestration, and animation loop
│   ├── grass.js         # GPU vertex-shader instanced grass system
│   ├── terrain.js       # Heightfield generation & 32-bit float heightmap texture
│   ├── groundBlend.js   # Contact color & normal softening shader hooks
│   ├── trees.js         # Instanced conifer & broadleaf trees with foliage gradients
│   ├── rocks.js         # Instanced mossy boulders along the forest path
│   ├── water.js         # Ocean plane with analytic gerstner/simplex waves
│   ├── mountain.js      # Craggy background mountain peak
│   ├── fireflies.js     # Additive floating bioluminescent particles
│   ├── environment.js   # Dynamic sky dome & directional sunlight
│   ├── controls.js      # OrbitControls & first-person walk mode
│   ├── vr.js            # WebXR session manager, locomotion & wrist HUD
│   ├── stats.js         # Real-time triangle breakdown & stats tracker
│   ├── postfx.js        # UnrealBloomPass & ACES tone mapping
│   └── wind.js          # Global wind time uniform
```

---

## 📜 License
MIT License
