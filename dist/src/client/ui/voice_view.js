/**
 * Discord-style Voice Channel UI Component
 * Displays participant tiles with green glowing speaking halos and volume controls
 */

export class VoiceView {
  constructor({ container }) {
    this.container = container;
    this.participants = new Map(); // peerId -> { element, avatar, nameEl, volumeSlider, audioEl }
  }

  addParticipant({ id, userName, isLocal = false, audioStream = null }) {
    if (this.participants.has(id)) {
      this.updateAudio(id, audioStream);
      return;
    }

    const tile = document.createElement('div');
    tile.className = `voice-user-tile ${isLocal ? 'is-local' : ''}`;
    tile.dataset.id = id;

    const initial = (userName || 'U').charAt(0).toUpperCase();

    // Hidden audio playback element for remote voice
    let audioEl = null;
    if (!isLocal) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      if (audioStream) {
        audioEl.srcObject = audioStream;
        audioEl.play().catch(() => {});
      }
      tile.appendChild(audioEl);
    }

    tile.innerHTML = `
      <div class="avatar-ring">
        <div class="user-avatar">${initial}</div>
        <div class="speaking-halo"></div>
      </div>
      <div class="tile-info">
        <div class="tile-name">${this.escapeHtml(userName)} ${isLocal ? '(You)' : ''}</div>
        <div class="voice-status-pill">Connected</div>
      </div>
      ${!isLocal ? `
        <div class="tile-controls">
          <button class="icon-btn-mini mute-user-btn" title="Mute user">🔊</button>
          <input type="range" class="user-vol-slider" min="0" max="1.5" step="0.05" value="1" title="User Volume">
        </div>
      ` : ''}
    `;

    if (!isLocal && audioEl) {
      tile.appendChild(audioEl);
      const volSlider = tile.querySelector('.user-vol-slider');
      const muteBtn = tile.querySelector('.mute-user-btn');

      if (volSlider) {
        volSlider.addEventListener('input', (e) => {
          audioEl.volume = Math.min(1.0, parseFloat(e.target.value));
          muteBtn.textContent = audioEl.volume === 0 ? '🔇' : '🔊';
        });
      }

      if (muteBtn) {
        muteBtn.addEventListener('click', () => {
          audioEl.muted = !audioEl.muted;
          muteBtn.textContent = audioEl.muted ? '🔇' : '🔊';
        });
      }
    }

    this.container.appendChild(tile);
    this.participants.set(id, { element: tile, audioEl, userName, isLocal });
  }

  setSpeaking(id, isSpeaking) {
    const p = this.participants.get(id);
    if (p && p.element) {
      if (isSpeaking) {
        p.element.classList.add('is-speaking');
      } else {
        p.element.classList.remove('is-speaking');
      }
    }
  }

  updateAudio(id, stream) {
    const p = this.participants.get(id);
    if (!p || p.isLocal || !stream) return;

    if (!p.audioEl) {
      p.audioEl = document.createElement('audio');
      p.audioEl.autoplay = true;
      p.element.appendChild(p.audioEl);
    }

    p.audioEl.srcObject = stream;
    p.audioEl.play().catch((err) => console.warn('[VoiceView] Play error:', err));
  }

  removeParticipant(id) {
    const p = this.participants.get(id);
    if (p) {
      if (p.audioEl) {
        p.audioEl.srcObject = null;
        p.audioEl.remove();
      }
      p.element.remove();
      this.participants.delete(id);
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
