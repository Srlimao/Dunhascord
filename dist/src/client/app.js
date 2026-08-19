import { StreamCapture, QUALITY_PRESETS } from './webrtc/stream_capture.js';
import { VoiceProcessor } from './audio/voice_processor.js';
import { ProcessAudioReceiver } from './audio/process_audio_receiver.js';
import { MeshManager } from './webrtc/mesh_manager.js';
import { StreamRenderer } from './ui/stream_renderer.js';
import { VoiceView } from './ui/voice_view.js';
import { SourcePicker } from './ui/source_picker.js';

class App {
  constructor() {
    this.streamCapture = new StreamCapture();
    this.voiceProcessor = new VoiceProcessor();
    this.processAudioReceiver = new ProcessAudioReceiver();
    this.meshManager = null;
    this.roomId = null;
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
    this.userName = '';
    this.isStreaming = false;
    this.isMuted = false;
    this.isDeafened = false;
    this.isNoiseFilterOn = true;

    this.initElements();
    this.initEventListeners();
    this.checkUrlParams();
    this.fetchNetworkInfo();
  }

  initElements() {
    this.joinModal = document.getElementById('join-modal');
    this.roomInput = document.getElementById('room-input');
    this.nameInput = document.getElementById('name-input');
    this.roomView = document.getElementById('room-view');
    this.roomBadge = document.getElementById('current-room-badge');
    this.peerCountBadge = document.getElementById('peer-count-badge');
    this.presetSelect = document.getElementById('preset-select');

    // Dock
    this.dockAvatar = document.getElementById('dock-avatar');
    this.dockUsername = document.getElementById('dock-username');
    this.micLevelFill = document.getElementById('mic-level-fill');
    this.micMuteBtn = document.getElementById('mic-mute-btn');
    this.deafenBtn = document.getElementById('deafen-btn');
    this.noiseFilterBtn = document.getElementById('noise-filter-btn');
    this.shareScreenBtn = document.getElementById('share-screen-btn');

    // Renderers & Modals
    this.inviteModal = document.getElementById('invite-modal');
    this.inviteLinksContainer = document.getElementById('invite-links-container');
    this.voiceView = new VoiceView({ container: document.getElementById('voice-grid') });
    this.streamRenderer = new StreamRenderer({
      container: document.getElementById('stream-grid'),
      onToggleMonitor: (m) => this.processAudioReceiver.setLocalMonitoring(m)
    });
    this.sourcePicker = new SourcePicker({
      modalEl: document.getElementById('source-picker-modal'),
      gridEl: document.getElementById('source-cards-grid'),
      onSelect: (id, name) => this.startStreaming(id, name)
    });

    document.getElementById('cancel-picker-btn')?.addEventListener('click', () => this.sourcePicker.close());
    this.presetSelect.innerHTML = Object.entries(QUALITY_PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  }

  initEventListeners() {
    document.getElementById('join-btn').addEventListener('click', () => this.joinRoom());
    this.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinRoom(); });
    this.micMuteBtn.addEventListener('click', () => this.toggleMute());
    this.deafenBtn.addEventListener('click', () => this.toggleDeafen());
    this.noiseFilterBtn.addEventListener('click', () => this.toggleNoiseFilter());
    this.shareScreenBtn.addEventListener('click', () => this.toggleScreenShare());
    document.getElementById('copy-link-btn').addEventListener('click', () => this.openInviteModal());
    document.getElementById('close-invite-modal-btn')?.addEventListener('click', () => this.inviteModal.classList.add('hidden'));
    document.getElementById('leave-btn').addEventListener('click', () => window.location.reload());
    this.streamCapture.setOnStreamEnded(() => this.stopStreaming());

    this.voiceProcessor.onSpeakingChange = (s) => {
      document.getElementById('dock-halo')?.parentElement.classList.toggle('is-speaking', s);
      this.voiceView.setSpeaking(this.peerId, s);
      this.meshManager?.broadcastSpeakingState(s);
    };

    this.voiceProcessor.onVolumeMeter = (v) => {
      if (this.micLevelFill) this.micLevelFill.style.width = `${Math.min(100, Math.round(v * 140))}%`;
    };

    this.processAudioReceiver.onVolumeCallback = (v) => {
      this.streamRenderer.updateAudioMeter(this.peerId, v);
    };
  }

  checkUrlParams() {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('room');
    this.roomInput.value = r || ('chill-room-' + Math.floor(100 + Math.random() * 900));
    if (r) this.nameInput.focus();
  }

  async fetchNetworkInfo() {
    try {
      const res = await fetch('/api/network-info');
      this.networkInfo = await res.json();
    } catch (e) {}
  }

  async joinRoom() {
    const room = this.roomInput.value.trim();
    const name = this.nameInput.value.trim() || 'Friend';
    if (!room) return;

    this.roomId = room;
    this.userName = name;
    this.dockUsername.textContent = this.userName;
    this.dockAvatar.textContent = (this.userName.charAt(0) || 'U').toUpperCase();

    const newUrl = new URL(window.location);
    newUrl.searchParams.set('room', this.roomId);
    window.history.pushState({}, '', newUrl);

    this.joinModal.classList.add('hidden');
    this.roomView.classList.remove('hidden');
    this.roomBadge.textContent = `🔊 Voice: ${this.roomId}`;
    this.voiceView.addParticipant({ id: this.peerId, userName: this.userName, isLocal: true });

    try {
      const voiceStream = await this.voiceProcessor.startVoice();
      this.initMeshManager(voiceStream);
    } catch (e) {
      this.initMeshManager(null);
    }
  }

  initMeshManager(voiceStream) {
    this.meshManager = new MeshManager({
      roomId: this.roomId,
      peerId: this.peerId,
      userName: this.userName,
      streamCapture: this.streamCapture,
      onRemoteVoiceAdd: (id, s, name) => this.voiceView.addParticipant({ id, userName: name, isLocal: false, audioStream: s }),
      onRemoteStreamAdd: (id, s, name) => this.streamRenderer.addStream({ id, stream: s, userName: name, isLocal: false }),
      onRemoteStreamRemove: (id) => this.streamRenderer.removeStream(id),
      onRemoteSpeakingChange: (id, s) => this.voiceView.setSpeaking(id, s),
      onPeerUpdate: (peers) => {
        this.peerCountBadge.textContent = `👥 ${peers.length + 1} Connected`;
        peers.forEach((p) => {
          this.voiceView.addParticipant({ id: p.peerId, userName: p.userName, isLocal: false });
          if (p.isSpeaking !== undefined) this.voiceView.setSpeaking(p.peerId, p.isSpeaking);
        });
      },
      onStatsUpdate: (id, stats) => this.streamRenderer.updateStats(id, stats)
    });

    if (voiceStream) this.meshManager.setLocalVoiceStream(voiceStream);
    this.meshManager.connect();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.voiceProcessor.setMute(this.isMuted);
    this.micMuteBtn.classList.toggle('is-muted', this.isMuted);
    this.micMuteBtn.querySelector('.dock-label').textContent = this.isMuted ? 'Unmute' : 'Mute';
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    this.deafenBtn.classList.toggle('is-muted', this.isDeafened);
    document.querySelectorAll('#voice-grid audio').forEach((a) => { a.muted = this.isDeafened; });
    this.deafenBtn.querySelector('.dock-label').textContent = this.isDeafened ? 'Undeafen' : 'Deafen';
  }

  toggleNoiseFilter() {
    this.isNoiseFilterOn = !this.isNoiseFilterOn;
    this.voiceProcessor.setNoiseFilter(this.isNoiseFilterOn);
    this.noiseFilterBtn.classList.toggle('is-active-filter', this.isNoiseFilterOn);
  }

  async toggleScreenShare() {
    if (this.isStreaming) {
      this.stopStreaming();
    } else {
      if (window.electronAPI?.isElectron) this.sourcePicker.open();
      else await this.startStreaming();
    }
  }

  async startStreaming(sourceId = null, sourceName = null) {
    try {
      const presetKey = this.presetSelect.value;
      const preset = QUALITY_PRESETS[presetKey] || QUALITY_PRESETS['1080p60'];
      let stream;

      if (window.electronAPI?.isElectron && sourceId) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              minWidth: 1280,
              maxWidth: preset.width,
              minHeight: 720,
              maxHeight: preset.height,
              minFrameRate: preset.frameRate,
              maxFrameRate: preset.frameRate
            }
          }
        });
        const vTrack = stream.getVideoTracks()[0];
        if (vTrack && 'contentHint' in vTrack) vTrack.contentHint = 'motion';
      } else {
        stream = await this.streamCapture.startCapture({ presetKey });
      }

      if (window.electronAPI?.startProcessAudioCapture) {
        const started = await window.electronAPI.startProcessAudioCapture(sourceName || sourceId || '0');
        if (started) {
          const processAudioTrack = this.processAudioReceiver.start();
          if (processAudioTrack) {
            const currentAudio = stream.getAudioTracks()[0];
            if (currentAudio) stream.removeTrack(currentAudio);
            stream.addTrack(processAudioTrack);
          }
        }
      }

      this.isStreaming = true;
      this.shareScreenBtn.classList.add('is-streaming');
      this.shareScreenBtn.querySelector('.dock-label').textContent = 'Stop Sharing';
      this.streamRenderer.addStream({ id: this.peerId, stream, userName: this.userName, isLocal: true });
      this.meshManager?.setLocalScreenStream(stream);
    } catch (err) {
      console.warn('Screen share failed:', err);
      this.stopStreaming();
    }
  }

  stopStreaming() {
    this.streamCapture.stopCapture();
    this.processAudioReceiver.stop();
    this.isStreaming = false;
    this.shareScreenBtn.classList.remove('is-streaming');
    this.shareScreenBtn.querySelector('.dock-label').textContent = 'Share Screen';
    this.streamRenderer.removeStream(this.peerId);
    this.meshManager?.setLocalScreenStream(null);
  }

  openInviteModal() {
    const protocol = window.location.protocol;
    const currentPort = window.location.port || (protocol === 'https:' ? '3443' : '3000');
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('room', this.roomId);

    let linksHtml = `
      <div class="invite-link-row">
        <div class="link-label">Direct Link:</div>
        <div class="copy-box">
          <input type="text" readonly value="${currentUrl.href}" id="invite-url-input">
          <button class="primary-btn" id="copy-direct-btn">Copy</button>
        </div>
      </div>
    `;

    if (this.networkInfo?.addresses) {
      this.networkInfo.addresses.forEach((net) => {
        const lanUrl = `${protocol}//${net.address}:${currentPort}/?room=${encodeURIComponent(this.roomId)}`;
        linksHtml += `
          <div class="invite-link-row">
            <div class="link-label">LAN (${net.interface}):</div>
            <div class="copy-box">
              <input type="text" readonly value="${lanUrl}">
              <button class="primary-btn" onclick="navigator.clipboard.writeText('${lanUrl}')">Copy</button>
            </div>
          </div>
        `;
      });
    }

    this.inviteLinksContainer.innerHTML = linksHtml;
    this.inviteModal.classList.remove('hidden');

    const copyBtn = document.getElementById('copy-direct-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentUrl.href);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => { new App(); });
