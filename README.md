# RE-VOLT CV — Hand-Gesture RC Car Racing

An open-source 3D miniature radio-controlled car racing game inspired by **Re-Volt (RVGL)**, built with **Three.js**, **cannon-es** (`RaycastVehicle`), **Web Audio**, and **MediaPipe Hands** computer vision steering.

## Features

- **Real-Time Computer Vision Hand-Wheel (`src/cv/HandWheelController.ts`)**
  - **2-Hand Virtual Steering Wheel**: Hold both hands up to your webcam and tilt left/right to steer proportionally.
  - **1-Hand RC Stick Mode**: Automatically adapts if a single hand is visible.
  - **Gestures**:
    - **Open Palms**: Throttle (accelerate)
    - **Closed Fists**: Brake & Reverse
    - **Thumb + Index Pinch**: Fire held Re-Volt lightning pickup
  - **100% Local WASM + Model Assets**: MediaPipe Vision WASM and `hand_landmarker.task` are bundled locally under `public/mediapipe/`.
  - **CV Simulator & Keyboard Fallback**: Interactive wheel simulator in the CV dock plus simultaneous `WASD` / `Arrow Keys`, `Space` (fire), `C` (camera view), and `R` (right car).
- **4 Selectable 1:10 Electric RC Cars (`src/physics/RCVehicle.ts`)**
  - **RC Bandit** (Balanced 4WD Buggy), **Toyeca GT** (Pro Brushless Speedster), **Sprinter XL** (Stadium Truck), and **Volken CV-1** (Stereo-Camera Lab Prototype) — each with distinct speed, acceleration, grip, suspension stiffness, and a spring-physics wire antenna.
- **Classic Re-Volt Lightning Pickups (`src/game/PickupManager.ts`)**
  - **Bottle Rocket** (homing blast), **LiPo Overvolt** (14.8V speed burst), **EMP Pulse** (area shockwave), and **Grease Slick** (spinout hazard).
- **Modular Toy-Scale Circuits & Laboratory Photo Integration (`src/game/TrackBuilder.ts`)**
  - **Toy Room Mayhem**: Hardwood playroom planks, giant wooden alphabet blocks, physics-reactive traffic cones, and storybook jump ramps.
  - **CV & Robotics Lab**: Epoxy laboratory floor, 80/20 aluminum camera calibration gates, workbenches, and live **Add Photos** support to texture lab walls and calibration portals with your own laboratory images.

## Development

```bash
npm install
npm run dev
```
