# VR Passthrough SBS (Side-by-Side Dual Display)

An ultra-low-latency WebGL stereoscopic passthrough web application designed for mobile phones inside affordable VR headsets (Google Cardboard, VR Box, BoboVR, Shinecon, etc.).

## 🥽 Features

- **Side-by-Side (SBS) Dual Split**: Simulates identical camera view in left & right eye viewports in real-time.
- **Eye Distance (IPD) Slider**: Adjust horizontal separation between optical centers to match your pupillary distance and headset lens positions.
- **Lens Curvature (Distortion) Slider**: Brown-Conrady radial barrel/pincushion distortion to counteract the magnification distortion of cheap convex VR lenses.
- **Edge Aperture & Softness Sliders**: Circular lens boundary masking to eliminate distracting square phone corners and blend softly into dark headset rims.
- **Scale & Zoom (FOV) Slider**: Calibrate real-world scale and depth perception.
- **Vertical Alignment**: Shift eye centers up or down to align with phone tray placement.
- **Center Divider Bar**: Prevents cross-eye light leakage inside the headset.
- **Camera Tools**:
  - Flip between rear environment camera and front selfie camera.
  - Multi-camera lens picker (ultra-wide, standard, telephoto).
  - 90° rotation button to fix mobile portrait/landscape orientation mismatches.
  - Horizontal Mirror mode.
  - Flashlight / Torch toggle for low-light or night passthrough.
  - Optical alignment reticles & concentric rings for headset calibration.
- **VR Experience Helpers**:
  - Screen WakeLock API prevents the phone display from sleeping while strapped into the headset.
  - Fullscreen VR mode with landscape orientation locking.
  - Single tap anywhere to show/hide the HUD menu.
  - Built-in 3D Virtual Test Scene for testing without camera permissions or on desktop.
  - LocalStorage persistence saves all calibrations automatically.

## 🚀 How to Run & Connect to Your Phone

1. In the project directory, start the local server:
   ```bash
   python serve.py
   ```
2. The terminal will print your local network URL (e.g. `http://192.168.x.x:8080`).
3. On your phone (connected to the same Wi-Fi), open Chrome or Safari and visit that URL.
4. Tap **Enter VR** for fullscreen mode, adjust the sliders for your headset, tap once to hide the HUD, and slide the phone into your VR headset!

> **Note on Mobile Browsers & Camera:**
> Modern mobile browsers restrict camera access over plain HTTP on LAN.
> - On Android Chrome: Visit `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, enter `http://<your-pc-ip>:8080`, enable it, and restart Chrome.
> - Or use the built-in **Virtual Test Scene** which lets you calibrate all lens shaders without needing a camera.

