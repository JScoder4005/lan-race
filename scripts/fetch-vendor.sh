#!/usr/bin/env bash
# Downloads three.js r160 + the CC-BY Ferrari 458 model into static/vendor (run once; game then works offline).
set -euo pipefail
cd "$(dirname "$0")/.."
NPM="https://cdn.jsdelivr.net/npm/three@0.160.0"
GH="https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160"
OUT="static/vendor/three"
files=(
  build/three.module.js
  examples/jsm/loaders/GLTFLoader.js
  examples/jsm/loaders/DRACOLoader.js
  examples/jsm/utils/BufferGeometryUtils.js
  examples/jsm/postprocessing/EffectComposer.js
  examples/jsm/postprocessing/RenderPass.js
  examples/jsm/postprocessing/ShaderPass.js
  examples/jsm/postprocessing/MaskPass.js
  examples/jsm/postprocessing/Pass.js
  examples/jsm/postprocessing/UnrealBloomPass.js
  examples/jsm/postprocessing/OutputPass.js
  examples/jsm/shaders/CopyShader.js
  examples/jsm/shaders/LuminosityHighPassShader.js
  examples/jsm/shaders/OutputShader.js
  examples/jsm/libs/draco/gltf/draco_decoder.js
  examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js
  examples/jsm/libs/draco/gltf/draco_decoder.wasm
)
for f in "${files[@]}"; do
  mkdir -p "$OUT/$(dirname "$f")"
  curl -sfL "$NPM/$f" -o "$OUT/$f"
done
mkdir -p static/models
curl -sfL "$GH/examples/models/gltf/ferrari.glb" -o static/models/ferrari.glb
curl -sfL "$GH/examples/models/gltf/ferrari_ao.png" -o static/models/ferrari_ao.png
# Concept car (CC-BY 4.0, Eric Chadwick / Darmstadt Graphics Group, Khronos glTF sample assets)
curl -sfL "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/CarConcept/glTF-Binary/CarConcept.glb" -o static/models/carconcept.glb
# Traffic vehicles: Kenney Car Kit (CC0)
tmp=$(mktemp -d)
curl -sfL "https://opengameart.org/sites/default/files/kenney_car-kit_3.1.zip" -o "$tmp/kit.zip"
unzip -q "$tmp/kit.zip" -d "$tmp/kit"
mkdir -p static/models/kenney/Textures
for n in sedan taxi suv suv-luxury van truck delivery garbage-truck ambulance sedan-sports hatchback-sports firetruck; do
  cp "$tmp/kit/Models/GLB format/$n.glb" static/models/kenney/
done
cp "$tmp/kit/Models/GLB format/Textures/colormap.png" static/models/kenney/Textures/
rm -rf "$tmp"
echo "vendor ok"
