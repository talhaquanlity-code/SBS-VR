/**
 * VR Passthrough SBS Engine
 * Ultra-low-latency WebGL Stereoscopic Splitter with Lens Distortion, IPD, and Edge Masking.
 */

(() => {
  'use strict';

  // --- Configuration & Default State ---
  const DEFAULTS = {
    distance: 0.00,        // IPD separation (-0.25 to 0.25)
    curve: 0.32,           // Lens Curvature / Distortion (-0.80 to 0.90)
    edgeRadius: 1.15,      // Lens Aperture Mask (0.50 to 1.80)
    edgeSoftness: 0.18,    // Edge Falloff / Vignette (0.01 to 0.50)
    zoom: 1.10,            // Scale / FOV (0.60 to 2.20)
    vertOffset: 0.00,      // Vertical alignment (-0.20 to 0.20)
    dividerWidth: 4,       // Central divider bar width in px (0 to 40)
    brightness: 0.05,      // Brightness boost (-0.20 to 0.30)
    showGuides: true,      // Optical alignment crosshairs
    rotation: 0,           // 0, 90, 180, 270 degrees
    mirror: false          // Horizontal flip
  };

  const PRESETS = {
    cardboard: {
      distance: 0.00,
      curve: 0.32,
      edgeRadius: 1.15,
      edgeSoftness: 0.18,
      zoom: 1.10,
      vertOffset: 0.00,
      dividerWidth: 4
    },
    vrbox: {
      distance: 0.04,
      curve: 0.55,
      edgeRadius: 0.95,
      edgeSoftness: 0.22,
      zoom: 1.25,
      vertOffset: 0.00,
      dividerWidth: 8
    },
    flat: {
      distance: 0.00,
      curve: 0.00,
      edgeRadius: 1.80,
      edgeSoftness: 0.02,
      zoom: 1.00,
      vertOffset: 0.00,
      dividerWidth: 2
    },
    wide: {
      distance: 0.02,
      curve: 0.20,
      edgeRadius: 1.40,
      edgeSoftness: 0.25,
      zoom: 1.35,
      vertOffset: 0.00,
      dividerWidth: 6
    }
  };

  // State object
  const state = { ...DEFAULTS };

  // Load saved state from LocalStorage if available
  try {
    const saved = localStorage.getItem('vr_passthrough_config');
    if (saved) {
      Object.assign(state, JSON.parse(saved));
    }
  } catch (e) {
    console.warn('LocalStorage not available', e);
  }

  // DOM Elements
  const canvas = document.getElementById('glCanvas');
  const video = document.getElementById('cameraVideo');
  const hudOverlay = document.getElementById('hudOverlay');
  const vrFloatingTrigger = document.getElementById('vrFloatingTrigger');
  const centerDividerLine = document.getElementById('centerDividerLine');
  const camStatusBadge = document.getElementById('camStatusBadge');
  const toastEl = document.getElementById('toastNotification');
  const modalNotice = document.getElementById('modalNotice');
  const cameraSelect = document.getElementById('cameraSelect');

  // Sliders and value labels
  const sliders = {
    distance: document.getElementById('sliderDistance'),
    curve: document.getElementById('sliderCurve'),
    edgeRadius: document.getElementById('sliderEdgeRadius'),
    edgeSoftness: document.getElementById('sliderEdgeSoftness'),
    zoom: document.getElementById('sliderZoom'),
    vertOffset: document.getElementById('sliderVertOffset'),
    dividerWidth: document.getElementById('sliderDividerWidth'),
    brightness: document.getElementById('sliderBrightness')
  };

  const valLabels = {
    distance: document.getElementById('valDistance'),
    curve: document.getElementById('valCurve'),
    edgeRadius: document.getElementById('valEdgeRadius'),
    edgeSoftness: document.getElementById('valEdgeSoftness'),
    zoom: document.getElementById('valZoom'),
    vertOffset: document.getElementById('valVertOffset'),
    dividerWidth: document.getElementById('valDividerWidth'),
    brightness: document.getElementById('valBrightness')
  };

  // Buttons
  const btnFullscreen = document.getElementById('btnFullscreen');
  const btnCloseHud = document.getElementById('btnCloseHud');
  const btnFlipCam = document.getElementById('btnFlipCam');
  const btnRotate = document.getElementById('btnRotate');
  const rotateLabel = document.getElementById('rotateLabel');
  const btnMirror = document.getElementById('btnMirror');
  const btnTorch = document.getElementById('btnTorch');
  const btnGuides = document.getElementById('btnGuides');
  const btnResetAll = document.getElementById('btnResetAll');
  const btnGrantCam = document.getElementById('btnGrantCam');
  const btnTestPattern = document.getElementById('btnTestPattern');

  // Runtime references
  let gl = null;
  let shaderProgram = null;
  let videoTexture = null;
  let testPatternCanvas = null;
  let testPatternCtx = null;
  let isUsingTestPattern = false;
  let currentStream = null;
  let currentVideoTrack = null;
  let torchActive = false;
  let currentFacingMode = 'environment';
  let wakeLock = null;
  let toastTimer = null;
  let lastTapTime = 0;

  // --- WebGL Shaders ---
  const vsSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      // Map [-1, 1] clip space to [0, 1] UV space
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fsSource = `
    precision highp float;

    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform vec2 u_videoSize;
    uniform float u_rotation;      // Radians: 0, 90, 180, 270 deg
    uniform float u_mirror;        // 1.0 = mirrored, 0.0 = normal
    uniform float u_ipd;           // Distance offset
    uniform float u_curve;         // Curvature (Brown-Conrady polynomial)
    uniform float u_edgeRadius;    // Lens circular border radius
    uniform float u_edgeSoftness;  // Feathering
    uniform float u_zoom;          // FOV / scale
    uniform float u_vertOffset;    // Vertical lens shift
    uniform float u_dividerWidth;  // Divider gap (normalized)
    uniform float u_brightness;    // Color tuning
    uniform float u_showGuides;    // Optical center reticles

    // Constants
    const float PI = 3.14159265359;

    void main() {
      // Central divider bar
      float distFromCenter = abs(v_uv.x - 0.5);
      if (distFromCenter < (u_dividerWidth * 0.5)) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // Determine Left Eye vs Right Eye
      bool isLeft = v_uv.x < 0.5;
      
      // Normalized [0, 1] coordinate inside the specific eye's viewport
      float eyeU = isLeft ? (v_uv.x / 0.5) : ((v_uv.x - 0.5) / 0.5);
      float eyeV = v_uv.y;

      // Eye Aspect Ratio: (Screen Width / 2) / Screen Height
      float eyeAspect = (u_resolution.x * 0.5) / max(u_resolution.y, 1.0);

      // Coordinate centered at (0, 0) in eye space [-1.0, 1.0]
      vec2 eyeCoord = vec2((eyeU * 2.0 - 1.0) * eyeAspect, eyeV * 2.0 - 1.0);

      // Apply IPD (Distance) and Vertical Offset to optical center
      // Left eye shifts outwards/inwards symmetrically to right eye
      vec2 opticalCenter = vec2(isLeft ? -u_ipd : u_ipd, u_vertOffset);
      vec2 p = eyeCoord - opticalCenter;

      // Distance from optical center
      float r = length(p);

      // --- Lens Edge Mask & Vignette (Edges Slider) ---
      // Smooth circular aperture to eliminate rectangular screen borders
      float edgeMask = 1.0 - smoothstep(max(u_edgeRadius - u_edgeSoftness, 0.0), u_edgeRadius, r);
      if (edgeMask <= 0.001) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // --- Radial Lens Curvature Distortion (Curve Slider) ---
      // Brown-Conrady Polynomial: r' = r * (1 + k1*r^2 + k2*r^4)
      float r2 = r * r;
      float r4 = r2 * r2;
      float k1 = u_curve;
      float k2 = u_curve * 0.45;
      float distortionFactor = 1.0 + (k1 * r2) + (k2 * r4);

      vec2 distortedP = p * distortionFactor;

      // Apply Zoom / Scale
      distortedP /= max(u_zoom, 0.1);

      // --- Map to Video Camera Aspect Ratio ---
      float vidAspect = max(u_videoSize.x, 1.0) / max(u_videoSize.y, 1.0);
      
      // If rotated 90 or 270 deg, aspect ratio is inverted
      if (abs(sin(u_rotation)) > 0.5) {
        vidAspect = max(u_videoSize.y, 1.0) / max(u_videoSize.x, 1.0);
      }

      // Keep proper aspect ratio without stretching
      vec2 sampleCoord = distortedP;
      sampleCoord.x /= vidAspect;

      // Apply orientation rotation (0, 90, 180, 270)
      float cosR = cos(u_rotation);
      float sinR = sin(u_rotation);
      mat2 rotMat = mat2(cosR, -sinR, sinR, cosR);
      sampleCoord = rotMat * sampleCoord;

      // Mirror horizontally if requested
      if (u_mirror > 0.5) {
        sampleCoord.x = -sampleCoord.x;
      }

      // Map from centered [-1, 1] to UV texture coordinates [0, 1]
      vec2 finalUV = sampleCoord * 0.5 + vec2(0.5, 0.5);

      // Invert Y for correct camera texture orientation
      finalUV.y = 1.0 - finalUV.y;

      vec4 texColor;
      if (finalUV.x < 0.0 || finalUV.x > 1.0 || finalUV.y < 0.0 || finalUV.y > 1.0) {
        // Outside camera view bounds
        texColor = vec4(0.0, 0.0, 0.0, 1.0);
      } else {
        texColor = texture2D(u_texture, finalUV);
      }

      // Brightness & Contrast adjustment
      vec3 finalRGB = texColor.rgb;
      finalRGB = (finalRGB - 0.5) * 1.1 + 0.5 + u_brightness;
      finalRGB = clamp(finalRGB, 0.0, 1.0);

      // Apply soft edge mask
      finalRGB *= edgeMask;

      // --- Optical Alignment Crosshairs & Guides ---
      if (u_showGuides > 0.5) {
        // Center crosshair
        float lineDistX = abs(p.x);
        float lineDistY = abs(p.y);
        
        // Reticle crosshair inside 0.3 radius
        if (r < 0.28) {
          if ((lineDistX < 0.003 && r > 0.02) || (lineDistY < 0.003 && r > 0.02)) {
            finalRGB = mix(finalRGB, vec3(0.0, 0.95, 1.0), 0.85); // Neon Cyan reticle
          }
        }

        // Concentric alignment ring
        float ringDist = abs(r - 0.25);
        if (ringDist < 0.003) {
          finalRGB = mix(finalRGB, vec3(0.9, 0.2, 0.9), 0.7); // Magenta guide ring
        }

        // Center dot
        if (r < 0.007) {
          finalRGB = vec3(0.0, 1.0, 0.6); // Green center point
        }
      }

      gl_FragColor = vec4(finalRGB, 1.0);
    }
  `;

  // --- Initialize WebGL ---
  function initWebGL() {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false }) ||
         canvas.getContext('experimental-webgl');

    if (!gl) {
      showToast('WebGL not supported on this browser/device');
      return false;
    }

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);

    shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vs);
    gl.attachShader(shaderProgram, fs);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      console.error('Shader Link Error:', gl.getProgramInfoLog(shaderProgram));
      return false;
    }

    gl.useProgram(shaderProgram);

    // Fullscreen quad buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const vertices = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(shaderProgram, 'a_position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    // Texture setup
    videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Initial 1x1 black pixel
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    window.addEventListener('resize', handleResize);
    handleResize();

    return true;
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader Compile Error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function handleResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = Math.round(window.innerWidth * dpr);
    const displayHeight = Math.round(window.innerHeight * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }

  // --- Render Loop ---
  function render() {
    if (!gl || !shaderProgram) return;

    // Update texture from camera or animated test pattern
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);

    let vidWidth = 1920;
    let vidHeight = 1080;

    if (!isUsingTestPattern && video.readyState >= video.HAVE_CURRENT_DATA) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      vidWidth = video.videoWidth || 1920;
      vidHeight = video.videoHeight || 1080;
    } else {
      updateTestPattern();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, testPatternCanvas);
      vidWidth = testPatternCanvas.width;
      vidHeight = testPatternCanvas.height;
    }

    gl.useProgram(shaderProgram);

    // Uniform locations
    gl.uniform2f(gl.getUniformLocation(shaderProgram, 'u_resolution'), canvas.width, canvas.height);
    gl.uniform2f(gl.getUniformLocation(shaderProgram, 'u_videoSize'), vidWidth, vidHeight);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_rotation'), (state.rotation * Math.PI) / 180.0);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_mirror'), state.mirror ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_ipd'), state.distance);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_curve'), state.curve);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_edgeRadius'), state.edgeRadius);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_edgeSoftness'), state.edgeSoftness);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_zoom'), state.zoom);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_vertOffset'), state.vertOffset);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_dividerWidth'), (state.dividerWidth / window.innerWidth));
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_brightness'), state.brightness);
    gl.uniform1f(gl.getUniformLocation(shaderProgram, 'u_showGuides'), state.showGuides ? 1.0 : 0.0);

    // Texture Unit 0
    gl.uniform1i(gl.getUniformLocation(shaderProgram, 'u_texture'), 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
  }

  // --- Virtual Test Pattern Scene (Fallback / Preview without camera) ---
  function initTestPattern() {
    testPatternCanvas = document.createElement('canvas');
    testPatternCanvas.width = 1280;
    testPatternCanvas.height = 720;
    testPatternCtx = testPatternCanvas.getContext('2d');
  }

  function updateTestPattern() {
    if (!testPatternCtx) initTestPattern();
    const ctx = testPatternCtx;
    const w = testPatternCanvas.width;
    const h = testPatternCanvas.height;
    const t = performance.now() * 0.0015;

    // Dark cyber gradient background
    const bgGrad = ctx.createRadialGradient(w/2, h/2, 50, w/2, h/2, w*0.7);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 3D Perspective Grid
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.25)';
    ctx.lineWidth = 1.5;
    const step = 40;
    const offset = (t * 50) % step;

    for (let x = offset; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = offset; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Moving target reticles / concentric rings
    ctx.save();
    ctx.translate(w / 2, h / 2);

    // Rotating outer ring
    ctx.rotate(t * 0.3);
    ctx.strokeStyle = '#f72585';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 180, 0, Math.PI * 1.5);
    ctx.stroke();

    // Inner pulsating ring
    const pulse = Math.sin(t * 3) * 10;
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 100 + pulse, 0, Math.PI * 2);
    ctx.stroke();

    // Target cross
    ctx.strokeStyle = '#00f59b';
    ctx.beginPath();
    ctx.moveTo(-140, 0); ctx.lineTo(140, 0);
    ctx.moveTo(0, -140); ctx.lineTo(0, 140);
    ctx.stroke();

    ctx.restore();

    // Center text banner
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VR PASSTHROUGH TEST SCENE', w / 2, h / 2 - 20);

    ctx.fillStyle = '#8b9bb4';
    ctx.font = '20px "JetBrains Mono", monospace';
    ctx.fillText('Adjust Distance, Curve & Edges in real-time', w / 2, h / 2 + 25);
  }

  // --- Camera Streaming ---
  async function startCamera(deviceId = null) {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }

    const constraints = {
      audio: false,
      video: {
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        frameRate: { ideal: 60, min: 30 }
      }
    };

    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
    } else {
      constraints.video.facingMode = { ideal: currentFacingMode };
    }

    try {
      camStatusBadge.textContent = 'Connecting...';
      camStatusBadge.className = 'status-badge warn';

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API (getUserMedia) not supported or requires HTTPS.');
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentStream = stream;
      video.srcObject = stream;
      await video.play();

      currentVideoTrack = stream.getVideoTracks()[0];
      isUsingTestPattern = false;
      modalNotice.classList.add('hidden');

      const settings = currentVideoTrack.getSettings ? currentVideoTrack.getSettings() : {};
      const resText = (video.videoWidth && video.videoHeight) 
        ? `${video.videoWidth}x${video.videoHeight}` 
        : 'Active';

      camStatusBadge.textContent = `${resText} (Live)`;
      camStatusBadge.className = 'status-badge live';

      showToast(`Camera connected: ${resText}`);
      enumerateCameras();
      checkTorchSupport();

    } catch (err) {
      console.warn('Camera stream failed:', err);
      camStatusBadge.textContent = 'Virtual Test';
      camStatusBadge.className = 'status-badge warn';
      isUsingTestPattern = true;

      // Show modal explanation
      showCameraErrorModal(err);
    }
  }

  async function enumerateCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');

      cameraSelect.innerHTML = '';
      videoDevices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Camera ${index + 1} (${device.deviceId.slice(0, 5)}...)`;
        if (currentVideoTrack && currentVideoTrack.getSettings().deviceId === device.deviceId) {
          option.selected = true;
        }
        cameraSelect.appendChild(option);
      });
    } catch (e) {
      console.log('Error enumerating cameras:', e);
    }
  }

  function showCameraErrorModal(err) {
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');

    modalTitle.textContent = 'Camera Not Available';
    modalMessage.textContent = `${err.message || 'Permission denied or insecure origin.'} You can use the Virtual 3D Test Scene to adjust all headset sliders, or run with HTTPS.`;
    modalNotice.classList.remove('hidden');
  }

  async function checkTorchSupport() {
    btnTorch.style.display = 'none';
    if (!currentVideoTrack) return;
    try {
      const capabilities = currentVideoTrack.getCapabilities ? currentVideoTrack.getCapabilities() : {};
      if (capabilities.torch) {
        btnTorch.style.display = 'inline-flex';
      }
    } catch (e) {}
  }

  async function toggleTorch() {
    if (!currentVideoTrack) return;
    try {
      torchActive = !torchActive;
      await currentVideoTrack.applyConstraints({
        advanced: [{ torch: torchActive }]
      });
      btnTorch.classList.toggle('active', torchActive);
      showToast(torchActive ? 'Torch / Flashlight ON' : 'Torch OFF');
    } catch (e) {
      showToast('Flashlight not supported on this lens');
    }
  }

  // --- Fullscreen & Screen Wake Lock ---
  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
          await document.documentElement.webkitRequestFullscreen();
        }

        // Try locking orientation to landscape for mobile VR
        if (screen.orientation && screen.orientation.lock) {
          try {
            await screen.orientation.lock('landscape');
          } catch (e) {}
        }

        // Request Screen Wake Lock so phone doesn't sleep in headset
        requestWakeLock();
        btnFullscreen.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
          </svg>
          <span>Exit VR</span>
        `;
        showToast('VR Fullscreen Mode active. Screen lock prevented.');
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
        btnFullscreen.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
          </svg>
          <span>Enter VR</span>
        `;
        releaseWakeLock();
      }
    } catch (err) {
      showToast('Fullscreen toggle: ' + err.message);
    }
  }

  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().then(() => { wakeLock = null; });
    }
  }

  // --- HUD Visibility & Touch Interaction ---
  function toggleHUD(show) {
    const isHidden = typeof show === 'boolean' ? !show : !hudOverlay.classList.contains('hidden');
    if (isHidden) {
      hudOverlay.classList.add('hidden');
      document.body.classList.add('hud-hidden');
    } else {
      hudOverlay.classList.remove('hidden');
      document.body.classList.remove('hud-hidden');
    }
  }

  function setupTouchEvents() {
    // Single tap on canvas toggles HUD
    canvas.addEventListener('click', (e) => {
      // Avoid triggering when tapping inside HUD controls
      if (hudOverlay.contains(e.target) && !hudOverlay.classList.contains('hidden')) return;

      const now = performance.now();
      if (now - lastTapTime < 350) {
        // Double tap: toggle optical reticles / guides
        state.showGuides = !state.showGuides;
        btnGuides.classList.toggle('active', state.showGuides);
        showToast(state.showGuides ? 'Alignment Guides: ON' : 'Alignment Guides: OFF');
      } else {
        // Single tap: toggle HUD
        toggleHUD();
      }
      lastTapTime = now;
    });

    vrFloatingTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHUD(true);
    });

    btnCloseHud.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHUD(false);
      showToast('HUD hidden. Tap anywhere to reopen.');
    });
  }

  // --- Sliders & Value Sync ---
  function updateSliderDisplay(key) {
    const val = state[key];
    const slider = sliders[key];
    const label = valLabels[key];

    if (slider) slider.value = val;
    if (label) {
      if (key === 'distance' || key === 'vertOffset') {
        label.textContent = (val >= 0 ? '+' : '') + Number(val).toFixed(3);
      } else if (key === 'curve') {
        label.textContent = (val >= 0 ? '+' : '') + Number(val).toFixed(2);
      } else if (key === 'zoom') {
        label.textContent = Number(val).toFixed(2) + 'x';
      } else if (key === 'dividerWidth') {
        label.textContent = Math.round(val) + 'px';
      } else {
        label.textContent = Number(val).toFixed(2);
      }
    }

    if (key === 'dividerWidth') {
      centerDividerLine.style.width = Math.max(val, 0) + 'px';
    }
  }

  function syncAllSliders() {
    Object.keys(sliders).forEach(key => updateSliderDisplay(key));
    btnGuides.classList.toggle('active', state.showGuides);
    if (btnMirror) btnMirror.classList.toggle('active', !!state.mirror);
    rotateLabel.textContent = `${state.rotation}°`;
  }

  function saveState() {
    try {
      localStorage.setItem('vr_passthrough_config', JSON.stringify(state));
    } catch (e) {}
  }

  function bindControls() {
    // Sliders input
    Object.keys(sliders).forEach(key => {
      const slider = sliders[key];
      if (!slider) return;

      slider.addEventListener('input', (e) => {
        state[key] = parseFloat(e.target.value);
        updateSliderDisplay(key);
        saveState();
      });
    });

    // Mini Reset buttons per slider
    document.querySelectorAll('.btn-mini-reset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-reset');
        if (key && DEFAULTS[key] !== undefined) {
          state[key] = DEFAULTS[key];
          updateSliderDisplay(key);
          saveState();
          showToast(`Reset ${key} to default`);
        }
      });
    });

    // Reset All button
    btnResetAll.addEventListener('click', () => {
      Object.assign(state, DEFAULTS);
      syncAllSliders();
      saveState();
      showToast('All settings reset to default');
    });

    // Presets
    document.querySelectorAll('.preset-chip[data-preset]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const presetKey = chip.getAttribute('data-preset');
        if (PRESETS[presetKey]) {
          Object.assign(state, PRESETS[presetKey]);
          syncAllSliders();
          saveState();
          showToast(`Loaded Preset: ${chip.textContent.trim()}`);
        }
      });
    });

    // Flip camera (back <-> front)
    btnFlipCam.addEventListener('click', () => {
      currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
      startCamera();
      showToast(`Switched to ${currentFacingMode === 'environment' ? 'Rear' : 'Front'} Camera`);
    });

    // Rotate stream (0, 90, 180, 270)
    btnRotate.addEventListener('click', () => {
      state.rotation = (state.rotation + 90) % 360;
      rotateLabel.textContent = `${state.rotation}°`;
      saveState();
      showToast(`Rotated stream: ${state.rotation}°`);
    });

    // Mirror stream
    if (btnMirror) {
      btnMirror.addEventListener('click', () => {
        state.mirror = !state.mirror;
        btnMirror.classList.toggle('active', state.mirror);
        saveState();
        showToast(state.mirror ? 'Mirror Mode ON' : 'Mirror Mode OFF');
      });
    }

    // Flashlight / Torch
    btnTorch.addEventListener('click', toggleTorch);

    // Optical Alignment Guides
    btnGuides.addEventListener('click', () => {
      state.showGuides = !state.showGuides;
      btnGuides.classList.toggle('active', state.showGuides);
      saveState();
      showToast(state.showGuides ? 'Alignment Guides Visible' : 'Alignment Guides Hidden');
    });

    // Fullscreen
    btnFullscreen.addEventListener('click', toggleFullscreen);

    // Camera Selector Dropdown
    cameraSelect.addEventListener('change', (e) => {
      startCamera(e.target.value);
    });

    // Modal buttons
    btnGrantCam.addEventListener('click', () => {
      startCamera();
    });
    btnTestPattern.addEventListener('click', () => {
      modalNotice.classList.add('hidden');
      isUsingTestPattern = true;
      showToast('Using Virtual 3D Test Scene');
    });
  }

  // --- Toast Notifications ---
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2400);
  }

  // --- Initialization ---
  async function init() {
    initTestPattern();
    const glOk = initWebGL();
    if (!glOk) return;

    syncAllSliders();
    bindControls();
    setupTouchEvents();

    // Start render loop immediately
    requestAnimationFrame(render);

    // Request camera feed
    await startCamera();
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
