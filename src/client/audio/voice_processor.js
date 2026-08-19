import { NoiseGate } from './noise_gate.js';

export class VoiceProcessor {
  constructor() {
    this.audioCtx = null;
    this.micStream = null;
    this.processedStream = null;
    this.noiseGate = null;
    this.isMuted = false;
    this.isDeafened = false;
    this.isNoiseFilterActive = true;
    this.meterInterval = null;

    this.onSpeakingChange = null; // (isSpeaking) => void
    this.onVolumeMeter = null;    // (volumePercent) => void
    this.isSpeaking = false;
  }

  async startVoice(deviceId = null) {
    this.stopVoice();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass();
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000
      },
      video: false
    };

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
      const micSource = this.audioCtx.createMediaStreamSource(this.micStream);

      this.noiseGate = new NoiseGate(this.audioCtx);
      this.noiseGate.setFilterEnabled(this.isNoiseFilterActive);

      micSource.connect(this.noiseGate.getInput());

      const destination = this.audioCtx.createMediaStreamDestination();
      this.noiseGate.getOutput().connect(destination);

      this.processedStream = destination.stream;

      // Start metering and VAD loop (approx 30fps)
      this.meterInterval = setInterval(() => {
        if (!this.noiseGate || this.isMuted) {
          if (this.isSpeaking) {
            this.isSpeaking = false;
            if (this.onSpeakingChange) this.onSpeakingChange(false);
          }
          if (this.onVolumeMeter) this.onVolumeMeter(0);
          return;
        }

        const { volume, isOpen } = this.noiseGate.processVolume();
        const speakingNow = isOpen && volume > 0.05;

        if (speakingNow !== this.isSpeaking) {
          this.isSpeaking = speakingNow;
          if (this.onSpeakingChange) {
            this.onSpeakingChange(this.isSpeaking);
          }
        }

        if (this.onVolumeMeter) {
          this.onVolumeMeter(volume);
        }
      }, 35);

      return this.processedStream;
    } catch (err) {
      console.warn('[VoiceProcessor] Could not initialize microphone:', err);
      throw err;
    }
  }

  stopVoice() {
    if (this.meterInterval) {
      clearInterval(this.meterInterval);
      this.meterInterval = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.noiseGate = null;
    this.processedStream = null;
    this.isSpeaking = false;
  }

  setMute(muted) {
    this.isMuted = muted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
    }
    if (muted && this.isSpeaking) {
      this.isSpeaking = false;
      if (this.onSpeakingChange) this.onSpeakingChange(false);
    }
  }

  setNoiseFilter(enabled) {
    this.isNoiseFilterActive = enabled;
    if (this.noiseGate) {
      this.noiseGate.setFilterEnabled(enabled);
    }
  }

  getProcessedStream() {
    return this.processedStream;
  }
}
