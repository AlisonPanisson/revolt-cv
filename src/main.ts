import './style.css';
import { CAR_CATALOG, PICKUP_META, TRACK_CATALOG } from './data/catalog';
import type { CarId, PickupType, RacerProgress, TrackId } from './types';
import { SoundEngine } from './audio/SoundEngine';
import { HandWheelController } from './cv/HandWheelController';
import { KeyboardController } from './input/KeyboardController';
import { RaceEngine } from './game/RaceEngine';

const ALL_PICKUP_KEYS: PickupType[] = ['rocket', 'turbo', 'shockwave', 'oil'];

function formatTime(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '--:--.--';
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  const whole = Math.floor(rem);
  const hundredths = Math.floor((rem - whole) * 100);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(
    hundredths
  ).padStart(2, '0')}`;
}

function ordinalSuffix(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function mountApp(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app container');

  app.innerHTML = `
    <canvas id="scene-canvas" aria-label="3D Re-Volt RC Racing Viewport"></canvas>

    <!-- Top Navigation & Utility Bar -->
    <header class="topbar">
      <div class="brand-mark">
        <div class="brand-bolt" aria-hidden="true">⚡</div>
        <div>
          <h1 class="brand-title">RE-VOLT <span class="brand-sub">CV EDITION</span></h1>
        </div>
      </div>

      <div class="topbar-actions">
        <button id="btn-cam-mode" class="btn btn-sm" type="button" title="Cycle Camera View (C)">
          Cam: Chase
        </button>
        <button id="btn-mute" class="btn btn-sm" type="button" title="Toggle RC Audio">
          Audio: On
        </button>
        <button id="btn-back-lobby" class="btn btn-sm" type="button" style="display: none;">
          Garage
        </button>
      </div>
    </header>

    <!-- Pre-Race Garage & Track Lobby -->
    <section id="lobby-overlay" class="lobby-overlay" aria-label="RC Garage and Track Selection">
      <!-- Left Column: RC Car Selection & Stats -->
      <div class="lobby-column">
        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">Select RC Chassis</h2>
            <span class="panel-meta">1:10 Electric</span>
          </div>
          <div id="car-list" class="car-list"></div>
          <div id="car-stats" class="stats-list"></div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">Control Reference</h2>
            <span class="panel-meta">CV + Keyboard</span>
          </div>
          <div class="gesture-guide">
            <div class="gesture-item">
              <span>Steer Left / Right</span>
              <span class="gesture-key">Tilt Hands / A-D</span>
            </div>
            <div class="gesture-item">
              <span>Accelerate (Gas)</span>
              <span class="gesture-key">Open Palms / W</span>
            </div>
            <div class="gesture-item">
              <span>Brake &amp; Reverse</span>
              <span class="gesture-key">Closed Fists / S</span>
            </div>
            <div class="gesture-item">
              <span>Fire Lightning Pickup</span>
              <span class="gesture-key">Pinch / Space</span>
            </div>
            <div class="gesture-item">
              <span>Right Flipped Car</span>
              <span class="gesture-key">Press R</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Center Column: Live 3D Turntable & Launch CTA -->
      <div class="lobby-center">
        <div class="lobby-center-cta">
          <p id="turntable-caption" class="turntable-caption">
            Test your hand-wheel steering live on the front tires, then launch the heat!
          </p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">
            <button id="btn-lobby-cv" class="btn btn-cv" type="button">
              Enable Webcam Hand-Wheel
            </button>
            <button id="btn-start-race" class="btn btn-primary" type="button">
              Launch 3-Lap Race
            </button>
          </div>
        </div>
      </div>

      <!-- Right Column: Track Selection & Laboratory Photo Importer -->
      <div class="lobby-column">
        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">Select Circuit</h2>
            <span class="panel-meta">4-Car Heat</span>
          </div>
          <div id="track-list" class="track-list"></div>

          <div class="lab-uploader">
            <div class="lab-uploader-row">
              <div>
                <div style="font-size: 0.8rem; font-weight: 600;">Laboratory Photo Arena</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary);">
                  Drop photos of your lab to skin the 3D Robotics Lab gates &amp; walls
                </div>
              </div>
              <label for="lab-photo-input" class="btn btn-sm" style="cursor: pointer; flex-shrink: 0;">
                Add Photos
              </label>
              <input
                id="lab-photo-input"
                type="file"
                accept="image/*"
                multiple
                style="display: none;"
              />
            </div>
            <div id="lab-photo-thumbs" class="lab-photo-thumbs"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- Persistent Computer Vision Hand-Wheel Dock -->
    <aside id="cv-dock" class="cv-dock" aria-label="Computer Vision Steering Telemetry">
      <div class="cv-dock-header">
        <div class="cv-status-group">
          <span id="cv-status-dot" class="status-dot"></span>
          <span id="cv-status-title" class="cv-dock-title">CV Wheel: Standby</span>
        </div>
        <div style="display: flex; gap: 4px;">
          <a
            id="btn-cv-popout"
            class="cv-popout-link"
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            title="Open game in a top-level browser tab so your laptop webcam permission popup is not blocked by the embedded iframe"
          >
            ↗ Webcam Tab
          </a>
          <button id="btn-cv-center" class="btn btn-sm" type="button" title="Calibrate Current Hand Angle as 0°">
            0°
          </button>
          <button id="btn-cv-minimize" class="btn btn-sm" type="button" title="Minimize Camera View">
            _
          </button>
        </div>
      </div>

      <div class="cv-viewport" title="Click your hand or marker in the live camera feed to lock its color!">
        <video id="cv-video" playsinline muted></video>
        <canvas id="cv-overlay"></canvas>
        <div id="cv-empty-prompt" class="cv-empty-prompt">
          <p id="cv-empty-msg" class="cv-empty-text">
            Steer RC cars with your laptop webcam (MediaPipe + Color/Skin CV), upload a hand-gesture video clip, or drag the virtual wheel.
          </p>
          <div style="display: flex; gap: 5px; flex-wrap: wrap; justify-content: center;">
            <button id="btn-dock-webcam" class="btn btn-cv btn-sm" type="button">
              Open Laptop Cam
            </button>
            <button id="btn-dock-sim" class="btn btn-sm" type="button">
              Touch/Mouse Wheel
            </button>
            <label for="cv-video-upload" class="btn btn-sm" style="cursor: pointer;">
              Load Hand Video
            </label>
            <input id="cv-video-upload" type="file" accept="video/*" style="display: none;" />
          </div>
        </div>
      </div>

      <div class="cv-controls-footer">
        <div class="cv-toolbar-row">
          <select id="cv-device-select" class="cv-select" title="Select Laptop Webcam Device">
            <option value="">Default Laptop Camera</option>
          </select>
          <select id="cv-algo-select" class="cv-select" title="Select Computer Vision Tracking Engine">
            <option value="hybrid">CV: Hybrid (Auto)</option>
            <option value="color_cv">CV: Skin / Color Lock</option>
            <option value="mediapipe">CV: MediaPipe 3D</option>
          </select>
        </div>

        <div class="cv-telemetry-bars">
          <div class="telemetry-pill">
            <span>MODE</span>
            <strong id="cv-gesture-readout" style="color: var(--rc-yellow);">KEYBOARD</strong>
          </div>
          <div class="telemetry-pill">
            <span>STEER</span>
            <strong id="cv-steer-readout">0%</strong>
          </div>
        </div>

        <div class="cv-slider-row">
          <label for="cv-sensitivity">Sensitivity</label>
          <input id="cv-sensitivity" type="range" min="0.6" max="2.2" step="0.1" value="1.25" />
          <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
            <input id="cv-autothrottle" type="checkbox" />
            Cruise Gas
          </label>
        </div>
      </div>
    </aside>

    <!-- In-Race Heads-Up Display -->
    <section id="race-hud" class="race-hud hidden" aria-label="Race Telemetry HUD">
      <div class="hud-race-box">
        <div class="hud-stat-card">
          <div class="hud-stat-label">POS</div>
          <div id="hud-place" class="hud-stat-value accent">1st</div>
        </div>
        <div class="hud-stat-card">
          <div class="hud-stat-label">LAP</div>
          <div id="hud-lap" class="hud-stat-value">1 / 3</div>
        </div>
        <div class="hud-stat-card">
          <div class="hud-stat-label">LAP TIME</div>
          <div id="hud-time" class="hud-stat-value" style="font-family: var(--font-mono); font-size: 1.15rem;">
            00:00.00
          </div>
        </div>
      </div>

      <div id="hud-pickup-slot" class="hud-pickup-slot">
        <div id="hud-pickup-icon" class="pickup-icon-box">⚡</div>
        <div class="pickup-meta">
          <span id="hud-pickup-name" class="pickup-name">No Pickup</span>
          <span id="hud-pickup-hint" class="pickup-hint">Collect Bolt</span>
        </div>
      </div>

      <div class="hud-banner">
        <div id="hud-countdown" class="countdown-text"></div>
        <div id="hud-toast" class="event-toast hidden"></div>
      </div>

      <div class="hud-telemetry-cluster">
        <div class="minimap-box">
          <canvas id="minimap-canvas" width="128" height="128"></canvas>
        </div>
        <div class="speedo-box">
          <div class="speedo-reading">
            <span id="hud-speed" class="speedo-num">0</span>
            <span class="speedo-unit">SCALE KM/H</span>
          </div>
          <div class="rpm-bar-outer">
            <div id="hud-rpm-bar" class="rpm-bar-inner"></div>
          </div>
          <div class="input-source-badge">
            <span id="hud-control-src">INPUT: KEYBOARD</span>
            <span>R: RESET</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Post-Race Finish Standings Modal -->
    <div id="finish-modal" class="finish-modal hidden" role="dialog" aria-modal="true">
      <div class="finish-card">
        <div class="panel-meta">CHECKERED FLAG</div>
        <div id="finish-headline" class="finish-place">1st PLACE!</div>
        <div id="finish-standings" class="standings-table"></div>
        <div class="finish-actions">
          <button id="btn-finish-lobby" class="btn" type="button">Change Car / Track</button>
          <button id="btn-finish-rematch" class="btn btn-primary" type="button">Race Again</button>
        </div>
      </div>
    </div>
  `;

  // Instantiate subsystems
  const sound = new SoundEngine();
  const keyboard = new KeyboardController();

  const videoEl = document.getElementById('cv-video') as HTMLVideoElement;
  const overlayEl = document.getElementById('cv-overlay') as HTMLCanvasElement;
  const cvController = new HandWheelController(videoEl, overlayEl);

  const toastEl = document.getElementById('hud-toast')!;
  let toastTimeout = 0;
  const showToast = (msg: string): void => {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => {
      toastEl.classList.add('hidden');
    }, 2400);
  };

  const finishModal = document.getElementById('finish-modal')!;
  const finishHeadline = document.getElementById('finish-headline')!;
  const finishStandings = document.getElementById('finish-standings')!;

  const handleRaceFinish = (standings: RacerProgress[]): void => {
    const pIdx = standings.findIndex((s) => s.isPlayer);
    const placeStr = ordinalSuffix(pIdx >= 0 ? pIdx + 1 : 1);
    finishHeadline.textContent = `${placeStr} PLACE!`;

    finishStandings.innerHTML = standings
      .map((s, idx) => {
        const rightText = s.finished
          ? formatTime(s.finishTimeSec)
          : `Lap ${s.lap}`;
        return `
          <div class="standing-row ${s.isPlayer ? 'player' : ''}">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="font-family: var(--font-mono); width: 28px;">${ordinalSuffix(idx + 1)}</strong>
              <span style="width: 10px; height: 10px; border-radius: 50%; background: ${s.color}; display: inline-block;"></span>
              <span>${s.name}</span>
            </div>
            <span style="font-family: var(--font-mono); font-size: 0.78rem;">${rightText}</span>
          </div>
        `;
      })
      .join('');

    finishModal.classList.remove('hidden');
  };

  const sceneCanvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
  const engine = new RaceEngine(sceneCanvas, sound, showToast, handleRaceFinish);

  // Render Lobby Car Cards & Stats
  const carListEl = document.getElementById('car-list')!;
  const carStatsEl = document.getElementById('car-stats')!;
  const trackListEl = document.getElementById('track-list')!;

  const renderCarSelector = (): void => {
    const selected = engine.getSelectedCarSpec();
    carListEl.innerHTML = CAR_CATALOG.map(
      (c) => `
        <button
          type="button"
          id="select-car-${c.id}"
          class="car-option ${c.id === selected.id ? 'selected' : ''}"
          data-car="${c.id}"
        >
          <div class="car-swatch-row">
            <span class="car-swatch" style="background: ${c.bodyColor};"></span>
            <span class="car-class-tag">${c.classTag}</span>
          </div>
          <div class="car-name">${c.name}</div>
          <div class="car-tagline">${c.tagline}</div>
        </button>
      `
    ).join('');

    carListEl.querySelectorAll<HTMLButtonElement>('[data-car]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.car as CarId;
        engine.selectCar(id);
        sound.playTone(580, 0.08, 'triangle', 0.05);
        renderCarSelector();
      });
    });

    carStatsEl.innerHTML = `
      <div class="stat-row">
        <span class="stat-label">Top Speed</span>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width: ${selected.statSpeed}%;"></div></div>
        <span class="stat-val">${selected.statSpeed}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Accel</span>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width: ${selected.statAccel}%;"></div></div>
        <span class="stat-val">${selected.statAccel}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Corner Grip</span>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width: ${selected.statGrip}%;"></div></div>
        <span class="stat-val">${selected.statGrip}</span>
      </div>
    `;
  };

  const renderTrackSelector = (): void => {
    const selected = engine.getSelectedTrackDef();
    trackListEl.innerHTML = TRACK_CATALOG.map(
      (t) => `
        <button
          type="button"
          id="select-track-${t.id}"
          class="track-card ${t.id === selected.id ? 'selected' : ''}"
          data-track="${t.id}"
        >
          <img class="track-thumb" src="${t.previewUrl}" alt="${t.name} preview" />
          <div>
            <div class="track-info-title">${t.name}</div>
            <div class="track-info-desc">${t.description}</div>
            <div class="track-meta-row">
              <span>${t.subtitle}</span>
            </div>
          </div>
        </button>
      `
    ).join('');

    trackListEl.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.track as TrackId;
        engine.selectTrack(id);
        sound.playTone(660, 0.09, 'triangle', 0.05);
        renderTrackSelector();
      });
    });
  };

  renderCarSelector();
  renderTrackSelector();

  // Laboratory Photo Upload Handler
  const labInput = document.getElementById('lab-photo-input') as HTMLInputElement;
  const labThumbs = document.getElementById('lab-photo-thumbs')!;
  const uploadedLabUrls: string[] = [];

  labInput.addEventListener('change', () => {
    const files = labInput.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      uploadedLabUrls.push(url);
    });

    labThumbs.innerHTML = uploadedLabUrls
      .map((u, idx) => `<img class="lab-photo-mini" src="${u}" alt="Lab photo ${idx + 1}" />`)
      .join('');

    engine.setCustomLabPhotos(uploadedLabUrls);
    renderTrackSelector();
    showToast(`Applied ${uploadedLabUrls.length} Lab Photo(s) to Robotics Lab!`);
  });

  // Computer Vision Activation UI Wiring
  const emptyPromptEl = document.getElementById('cv-empty-prompt')!;
  const emptyMsgEl = document.getElementById('cv-empty-msg')!;
  const statusDotEl = document.getElementById('cv-status-dot')!;
  const statusTitleEl = document.getElementById('cv-status-title')!;
  const btnLobbyCv = document.getElementById('btn-lobby-cv')!;
  const btnDockWebcam = document.getElementById('btn-dock-webcam')!;
  const btnDockSim = document.getElementById('btn-dock-sim')!;
  const deviceSelect = document.getElementById('cv-device-select') as HTMLSelectElement;
  const algoSelect = document.getElementById('cv-algo-select') as HTMLSelectElement;
  const videoUploadInput = document.getElementById('cv-video-upload') as HTMLInputElement;
  const popoutLink = document.getElementById('btn-cv-popout') as HTMLAnchorElement;
  popoutLink.href = window.location.href;

  const refreshCameraDevices = async (): Promise<void> => {
    const devices = await cvController.listVideoDevices();
    if (devices.length === 0) return;
    const current = deviceSelect.value;
    deviceSelect.innerHTML = devices
      .map(
        (d, idx) =>
          `<option value="${d.deviceId}" ${d.deviceId === current ? 'selected' : ''}>${
            d.label || `Laptop Camera ${idx + 1}`
          }</option>`
      )
      .join('');
  };

  void refreshCameraDevices();

  const syncCvUiState = (): void => {
    if (cvController.isWebcamRunning()) {
      emptyPromptEl.classList.add('hidden');
      statusDotEl.className = 'status-dot live';
      statusTitleEl.textContent = 'CV Wheel: Live Video';
      btnLobbyCv.textContent = 'Webcam Hand-Wheel Active';
      btnLobbyCv.classList.add('active');
    } else if (cvController.isSimRunning()) {
      emptyPromptEl.classList.add('hidden');
      statusDotEl.className = 'status-dot sim';
      statusTitleEl.textContent = 'CV Wheel: Touch/Mouse';
      btnLobbyCv.textContent = 'Open Laptop Webcam';
      btnLobbyCv.classList.remove('active');
    } else {
      emptyPromptEl.classList.remove('hidden');
      statusDotEl.className = 'status-dot';
      statusTitleEl.textContent = 'CV Wheel: Standby';
      btnLobbyCv.textContent = 'Enable Webcam Hand-Wheel';
      btnLobbyCv.classList.remove('active');
    }
  };

  const triggerStartWebcam = async (deviceId?: string): Promise<void> => {
    btnLobbyCv.textContent = 'Opening Laptop Camera...';
    btnDockWebcam.textContent = 'Opening...';
    const res = await cvController.startWebcam(deviceId);
    btnDockWebcam.textContent = 'Open Laptop Cam';
    if (!res.ok) {
      emptyMsgEl.textContent = `Embedded preview frame blocked webcam (${res.error}). Click "↗ Webcam Tab" at top-right of this box to allow your laptop camera, or use Touch/Mouse Wheel & Load Hand Video right here!`;
      showToast('🎥 Embedded iframe blocked webcam — Click "↗ Webcam Tab" to allow laptop camera, or steer with Touch/Mouse Wheel!');
    } else {
      await refreshCameraDevices();
      showToast('🎥 Laptop Webcam Active! Tilt hands to steer, or click your hand on the video to lock its color.');
    }
    syncCvUiState();
  };

  btnLobbyCv.addEventListener('click', () => {
    void triggerStartWebcam(deviceSelect.value || undefined);
  });
  btnDockWebcam.addEventListener('click', () => {
    void triggerStartWebcam(deviceSelect.value || undefined);
  });
  btnDockSim.addEventListener('click', () => {
    cvController.startSimulator();
    syncCvUiState();
    showToast('🛞 Virtual Touch/Mouse Hand-Wheel Engaged! Move mouse over wheel to steer, click center FIRE.');
  });

  deviceSelect.addEventListener('change', () => {
    if (cvController.isWebcamRunning()) {
      void triggerStartWebcam(deviceSelect.value);
    } else {
      cvController.setSelectedDeviceId(deviceSelect.value);
    }
  });

  algoSelect.addEventListener('change', () => {
    const val = algoSelect.value as 'hybrid' | 'color_cv' | 'mediapipe';
    cvController.setAlgorithm(val);
    showToast(`CV Engine switched to ${algoSelect.options[algoSelect.selectedIndex].text}`);
  });

  videoUploadInput.addEventListener('change', () => {
    const file = videoUploadInput.files?.[0];
    if (!file) return;
    void cvController.startVideoFile(file).then((res) => {
      if (res.ok) {
        syncCvUiState();
        showToast('🎬 Loaded Hand Video into Live Computer Vision Tracker!');
      } else {
        showToast(`Could not load video: ${res.error}`);
      }
    });
  });

  document.getElementById('btn-cv-center')!.addEventListener('click', () => {
    cvController.calibrateCenter();
    showToast('🎯 Hand-Wheel Center Calibrated (0°)');
  });

  const cvDockEl = document.getElementById('cv-dock')!;
  document.getElementById('btn-cv-minimize')!.addEventListener('click', () => {
    cvDockEl.classList.toggle('minimized');
  });

  const sensInput = document.getElementById('cv-sensitivity') as HTMLInputElement;
  sensInput.addEventListener('input', () => {
    cvController.setSensitivity(parseFloat(sensInput.value));
  });

  const autoThrottleInput = document.getElementById('cv-autothrottle') as HTMLInputElement;
  autoThrottleInput.addEventListener('change', () => {
    cvController.setAutoThrottle(autoThrottleInput.checked);
  });

  // Topbar & Race Flow Buttons
  const lobbyOverlay = document.getElementById('lobby-overlay')!;
  const raceHud = document.getElementById('race-hud')!;
  const btnBackLobby = document.getElementById('btn-back-lobby')!;
  const btnCamMode = document.getElementById('btn-cam-mode')!;
  const btnMute = document.getElementById('btn-mute')!;

  const enterRaceUi = (): void => {
    lobbyOverlay.classList.add('hidden');
    finishModal.classList.add('hidden');
    raceHud.classList.remove('hidden');
    btnBackLobby.style.display = 'inline-flex';
    engine.startRace();
  };

  const returnToLobbyUi = (): void => {
    finishModal.classList.add('hidden');
    raceHud.classList.add('hidden');
    lobbyOverlay.classList.remove('hidden');
    btnBackLobby.style.display = 'none';
    engine.loadLobbyShowcase();
  };

  document.getElementById('btn-start-race')!.addEventListener('click', enterRaceUi);
  document.getElementById('btn-finish-rematch')!.addEventListener('click', enterRaceUi);
  document.getElementById('btn-finish-lobby')!.addEventListener('click', returnToLobbyUi);
  btnBackLobby.addEventListener('click', returnToLobbyUi);

  const cycleCamera = (): void => {
    const mode = engine.cycleCameraMode();
    const label = mode === 'chase' ? 'Chase' : mode === 'low' ? 'Low RC' : 'Hood CV';
    btnCamMode.textContent = `Cam: ${label}`;
  };
  btnCamMode.addEventListener('click', cycleCamera);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') cycleCamera();
  });

  btnMute.addEventListener('click', () => {
    const next = !sound.isMuted();
    sound.setMuted(next);
    btnMute.textContent = next ? 'Audio: Muted' : 'Audio: On';
  });

  // HUD DOM References
  const hudPlace = document.getElementById('hud-place')!;
  const hudLap = document.getElementById('hud-lap')!;
  const hudTime = document.getElementById('hud-time')!;
  const hudPickupSlot = document.getElementById('hud-pickup-slot')!;
  const hudPickupIcon = document.getElementById('hud-pickup-icon')!;
  const hudPickupName = document.getElementById('hud-pickup-name')!;
  const hudPickupHint = document.getElementById('hud-pickup-hint')!;
  const hudCountdown = document.getElementById('hud-countdown')!;
  const hudSpeed = document.getElementById('hud-speed')!;
  const hudRpmBar = document.getElementById('hud-rpm-bar')!;
  const hudControlSrc = document.getElementById('hud-control-src')!;
  const cvGestureReadout = document.getElementById('cv-gesture-readout')!;
  const cvSteerReadout = document.getElementById('cv-steer-readout')!;

  const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  const minimapCtx = minimapCanvas.getContext('2d')!;

  const drawMinimap = (): void => {
    const pts = engine.getTrackSampledPoints();
    if (pts.length === 0) return;

    const w = minimapCanvas.width;
    const h = minimapCanvas.height;
    minimapCtx.clearRect(0, 0, w, h);

    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const pad = 12;
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const scale = (Math.min(w, h) - pad * 2) / span;
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const toMap = (x: number, z: number): [number, number] => [
      w * 0.5 + (x - cx) * scale,
      h * 0.5 + (z - cz) * scale,
    ];

    minimapCtx.beginPath();
    pts.forEach((p, idx) => {
      const [mx, my] = toMap(p.x, p.z);
      if (idx === 0) minimapCtx.moveTo(mx, my);
      else minimapCtx.lineTo(mx, my);
    });
    minimapCtx.closePath();
    minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.36)';
    minimapCtx.lineWidth = 5;
    minimapCtx.stroke();

    // Start line dot
    const [sx, sy] = toMap(pts[0].x, pts[0].z);
    minimapCtx.fillStyle = '#ffffff';
    minimapCtx.fillRect(sx - 3, sy - 3, 6, 6);

    for (const v of engine.getVehiclePositionsForMap()) {
      const [vx, vy] = toMap(v.x, v.z);
      minimapCtx.beginPath();
      minimapCtx.arc(vx, vy, v.isPlayer ? 5 : 3.5, 0, Math.PI * 2);
      minimapCtx.fillStyle = v.isPlayer ? '#ffd000' : v.color;
      minimapCtx.fill();
      if (v.isPlayer) {
        minimapCtx.strokeStyle = '#000000';
        minimapCtx.lineWidth = 1.5;
        minimapCtx.stroke();
      }
    }
  };

  // Main 60fps Game & Computer Vision Loop
  let prevTime = performance.now();

  const frame = (now: number): void => {
    const dt = (now - prevTime) * 0.001;
    prevTime = now;

    const cvSnap = cvController.update();
    const kbSnap = keyboard.update();

    const useCv =
      cvSnap.active && (cvSnap.detectedHands > 0 || cvSnap.simMode) && !kbSnap.anyActive;

    const steer = useCv ? cvSnap.steer : kbSnap.steer;
    const throttle = useCv ? cvSnap.throttle : kbSnap.throttle;
    const brake = useCv ? cvSnap.brake : kbSnap.brake;
    const firePressed = cvSnap.fireTriggered || kbSnap.fireTriggered;
    const resetPressed = kbSnap.resetTriggered;

    // Update CV Dock telemetry pill
    cvGestureReadout.textContent = cvSnap.active ? cvSnap.gestureLabel : 'KEYBOARD';
    const steerPct = Math.round(steer * 100);
    cvSteerReadout.textContent =
      steerPct === 0 ? '0%' : `${Math.abs(steerPct)}% ${steerPct > 0 ? 'R' : 'L'}`;

    const hud = engine.step(dt, steer, throttle, brake, firePressed, resetPressed);

    if (hud.phase !== 'lobby') {
      hudPlace.textContent = ordinalSuffix(hud.place);
      hudLap.textContent = `${hud.lap} / ${hud.totalLaps}`;
      hudTime.textContent = formatTime(hud.currentLapSec);
      hudCountdown.textContent = hud.countdownLabel;
      hudSpeed.textContent = String(hud.speedKmh);
      hudRpmBar.style.width = `${Math.min(100, Math.round((hud.speedKmh / 88) * 100))}%`;
      hudControlSrc.textContent = useCv
        ? cvSnap.simMode
          ? 'INPUT: CV SIM'
          : 'INPUT: WEBCAM CV'
        : 'INPUT: KEYBOARD';

      if (hud.rouletteSpinning) {
        const spinItem = ALL_PICKUP_KEYS[Math.floor(now * 0.018) % ALL_PICKUP_KEYS.length];
        const meta = PICKUP_META[spinItem];
        hudPickupSlot.classList.remove('armed');
        hudPickupIcon.textContent = meta.icon;
        hudPickupName.textContent = 'Selecting...';
        hudPickupHint.textContent = 'Lightning Bolt';
      } else if (hud.heldPickup) {
        const meta = PICKUP_META[hud.heldPickup];
        hudPickupSlot.classList.add('armed');
        hudPickupIcon.textContent = meta.icon;
        hudPickupName.textContent = meta.name;
        hudPickupHint.textContent = useCv ? 'Pinch to Fire!' : 'Space to Fire!';
      } else {
        hudPickupSlot.classList.remove('armed');
        hudPickupIcon.textContent = '⚡';
        hudPickupName.textContent = 'Empty Slot';
        hudPickupHint.textContent = 'Grab Lightning';
      }

      drawMinimap();
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

mountApp();
