/**
 * Audio Mixer & Source Manager
 * Supports: Screen Audio, Specific App/Virtual Audio Devices, and Mic Mixing
 */

export class AudioMixer {
  constructor() {
    this.audioCtx = null;
    this.destination = null;
    this.screenAudioSource = null;
    this.deviceAudioSource = null;
    this.deviceStream = null;
  }

  initAudioContext() {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this.destination = this.audioCtx.createMediaStreamDestination();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  async getAvailableAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audioinput');
    } catch (err) {
      console.warn('[AudioMixer] Failed to enumerate audio devices:', err);
      return [];
    }
  }

  /**
   * Builds the final mixed audio track from display audio and/or custom device input
   */
  async buildMixedAudioTrack({ displayStream, customDeviceId = null, mixMic = false, micDeviceId = null }) {
    this.initAudioContext();
    this.cleanup();

    const outputTracks = [];

    // 1. Process Display Media Audio (e.g. Tab/Screen Audio)
    const displayAudioTrack = displayStream?.getAudioTracks()[0];
    if (displayAudioTrack && !customDeviceId) {
      this.screenAudioSource = this.audioCtx.createMediaStreamSource(new MediaStream([displayAudioTrack]));
      const screenGain = this.audioCtx.createGain();
      screenGain.gain.value = 1.0;
      this.screenAudioSource.connect(screenGain);
      screenGain.connect(this.destination);
    }

    // 2. Process Custom Audio Device (e.g. Virtual Cable, App Audio track, Stereo Mix)
    if (customDeviceId && customDeviceId !== 'default-screen') {
      try {
        this.deviceStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: customDeviceId },
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 2
          }
        });

        this.deviceAudioSource = this.audioCtx.createMediaStreamSource(this.deviceStream);
        const deviceGain = this.audioCtx.createGain();
        deviceGain.gain.value = 1.0;
        this.deviceAudioSource.connect(deviceGain);
        deviceGain.connect(this.destination);
      } catch (err) {
        console.warn('[AudioMixer] Could not capture custom audio device:', err);
      }
    }

    const mixedTrack = this.destination.stream.getAudioTracks()[0];
    return mixedTrack || displayAudioTrack || null;
  }

  cleanup() {
    if (this.deviceStream) {
      this.deviceStream.getTracks().forEach((t) => t.stop());
      this.deviceStream = null;
    }
    if (this.screenAudioSource) {
      try { this.screenAudioSource.disconnect(); } catch (e) {}
      this.screenAudioSource = null;
    }
    if (this.deviceAudioSource) {
      try { this.deviceAudioSource.disconnect(); } catch (e) {}
      this.deviceAudioSource = null;
    }
  }
}
