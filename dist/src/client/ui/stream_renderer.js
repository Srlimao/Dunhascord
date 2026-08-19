/**
 * Stream Renderer - Interactive video cards with live Audio VU Gauge and Monitor
 */

export class StreamRenderer {
  constructor({ container, onFocusChange, onToggleMonitor }) {
    this.container = container;
    this.onFocusChange = onFocusChange;
    this.onToggleMonitor = onToggleMonitor;
    this.cards = new Map();
    this.focusedId = null;
  }

  addStream({ id, stream, userName, isLocal = false }) {
    console.log(`[StreamRenderer] addStream: peer=${id}, isLocal=${isLocal}, video=${stream.getVideoTracks().length}, audio=${stream.getAudioTracks().length}`);

    if (this.cards.has(id)) {
      this.updateStream(id, stream);
      return;
    }

    const card = document.createElement('div');
    card.className = `stream-card ${isLocal ? 'is-local' : ''}`;
    card.dataset.id = id;

    const header = document.createElement('div');
    header.className = 'stream-header';
    header.innerHTML = `
      <div class="user-badge">
        <span class="pulse-dot"></span>
        <span class="user-name">${this.escapeHtml(userName)} ${isLocal ? '(You)' : ''}</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn stats-toggle-btn" title="Toggle Stats HUD">📊</button>
      </div>
    `;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    if (!isLocal) video.volume = 1.0;

    const playVideo = () => {
      video.play().catch((e) => console.warn('[StreamRenderer] video play error:', e));
    };

    video.addEventListener('loadedmetadata', playVideo);
    playVideo();

    const statsHud = document.createElement('div');
    statsHud.className = 'stats-hud hidden';
    statsHud.innerHTML = `
      <div class="stat-row"><span>FPS:</span> <strong class="stat-fps">--</strong></div>
      <div class="stat-row"><span>Res:</span> <strong class="stat-res">--</strong></div>
      <div class="stat-row"><span>Bitrate:</span> <strong class="stat-bitrate">--</strong></div>
      <div class="stat-row"><span>Latency:</span> <strong class="stat-lat">--</strong></div>
    `;

    const controls = document.createElement('div');
    controls.className = 'stream-controls';
    controls.innerHTML = `
      <div class="ctrl-left">
        ${!isLocal ? `
          <button class="icon-btn volume-btn" title="Mute/Unmute">🔊</button>
          <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="1" title="Volume">
        ` : `
          <button class="icon-btn monitor-audio-btn" title="Hear/Monitor Stream Audio (Debug Loopback)">🎧</button>
          <div class="audio-gauge-wrap" title="Live Game Audio Output">
            <span class="gauge-label">Audio:</span>
            <div class="audio-gauge"><div class="gauge-fill"></div></div>
          </div>
        `}
      </div>
      <div class="ctrl-right">
        <button class="icon-btn focus-btn" title="Focus (Theater Mode)">🔍</button>
        <button class="icon-btn pip-btn" title="Picture in Picture">🔲</button>
        <button class="icon-btn fullscreen-btn" title="Fullscreen">⛶</button>
      </div>
    `;

    card.appendChild(header);
    card.appendChild(video);
    card.appendChild(statsHud);
    card.appendChild(controls);

    this.container.appendChild(card);

    const gaugeFill = card.querySelector('.gauge-fill');
    const cardInfo = { element: card, video, statsHud, gaugeFill, isFocused: false, isLocal, isMonitoring: false };
    this.cards.set(id, cardInfo);

    this.attachEventListeners(id, cardInfo);
    this.updateLayout();
  }

  updateAudioMeter(id, vol) {
    const card = this.cards.get(id);
    if (card && card.gaugeFill) {
      const pct = Math.min(100, Math.round(vol * 100));
      card.gaugeFill.style.width = `${pct}%`;
      card.gaugeFill.style.opacity = pct > 2 ? '1' : '0.3';
    }
  }

  attachEventListeners(id, { element, video, statsHud, isLocal }) {
    element.querySelector('.stats-toggle-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      statsHud.classList.toggle('hidden');
    });

    if (!isLocal) {
      const volumeBtn = element.querySelector('.volume-btn');
      const volumeSlider = element.querySelector('.volume-slider');
      volumeSlider.addEventListener('input', (e) => {
        video.volume = parseFloat(e.target.value);
        video.muted = video.volume === 0;
        volumeBtn.textContent = video.muted ? '🔇' : (video.volume < 0.5 ? '🔉' : '🔊');
      });
      volumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        video.muted = !video.muted;
        volumeBtn.textContent = video.muted ? '🔇' : '🔊';
        if (!video.muted && video.volume === 0) { video.volume = 0.5; volumeSlider.value = '0.5'; }
      });
    } else {
      const monitorBtn = element.querySelector('.monitor-audio-btn');
      if (monitorBtn) {
        monitorBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const card = this.cards.get(id);
          if (card) {
            card.isMonitoring = !card.isMonitoring;
            monitorBtn.classList.toggle('is-active-filter', card.isMonitoring);
            if (this.onToggleMonitor) this.onToggleMonitor(card.isMonitoring);
          }
        });
      }
    }

    element.querySelector('.focus-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFocus(id);
    });

    element.querySelector('.pip-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
        else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
      } catch (err) {}
    });

    element.querySelector('.fullscreen-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!document.fullscreenElement) element.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    });
  }

  toggleFocus(id) {
    this.focusedId = (this.focusedId === id) ? null : id;
    this.updateLayout();
    if (this.onFocusChange) this.onFocusChange(this.focusedId);
  }

  updateStats(id, stats) {
    const card = this.cards.get(id);
    if (!card || !card.statsHud) return;
    const fpsEl = card.statsHud.querySelector('.stat-fps');
    const resEl = card.statsHud.querySelector('.stat-res');
    const bitrateEl = card.statsHud.querySelector('.stat-bitrate');
    const latEl = card.statsHud.querySelector('.stat-lat');
    if (fpsEl) fpsEl.textContent = `${stats.fps} fps`;
    if (resEl) resEl.textContent = stats.resolution;
    if (bitrateEl) bitrateEl.textContent = stats.bitrate;
    if (latEl) latEl.textContent = stats.latency;
  }

  updateStream(id, newStream) {
    const card = this.cards.get(id);
    if (card && card.video) {
      card.video.srcObject = newStream;
      card.video.play().catch(() => {});
    }
  }

  removeStream(id) {
    const card = this.cards.get(id);
    if (card) {
      card.element.remove();
      this.cards.delete(id);
      if (this.focusedId === id) this.focusedId = null;
      this.updateLayout();
    }
  }

  updateLayout() {
    const count = this.cards.size;
    this.container.dataset.streamCount = count;
    if (count === 0) {
      this.container.classList.add('empty');
      return;
    }
    this.container.classList.remove('empty');

    for (const [id, card] of this.cards.entries()) {
      if (this.focusedId) {
        card.element.className = (id === this.focusedId) ? 'stream-card is-focused' : 'stream-card is-thumbnail';
      } else {
        card.element.className = `stream-card ${card.isLocal ? 'is-local' : ''}`;
      }
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
