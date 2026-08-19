/**
 * Realtime Web Audio Noise Gate & Filter
 * Filters keyboard clicks, microphone hums, and background noise
 */

export class NoiseGate {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.thresholdDb = -48; // dB threshold for gate to open
    this.isOpen = false;
    this.attackTime = 0.01; // seconds
    this.releaseTime = 0.15; // seconds
    this.isFilterEnabled = true;

    this.inputNode = this.ctx.createGain();
    this.outputNode = this.ctx.createGain();
    this.gateGainNode = this.ctx.createGain();
    this.gateGainNode.gain.value = 1.0;

    // High-pass filter to remove 80Hz rumble/AC hum
    this.highPassFilter = this.ctx.createBiquadFilter();
    this.highPassFilter.type = 'highpass';
    this.highPassFilter.frequency.value = 80;

    // Connect nodes
    this.inputNode.connect(this.highPassFilter);
    this.highPassFilter.connect(this.gateGainNode);
    this.gateGainNode.connect(this.outputNode);

    // Analyser for metering & VAD
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.highPassFilter.connect(this.analyser);

    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.onVolumeChange = null;
  }

  processVolume() {
    this.analyser.getByteFrequencyData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }
    const average = sum / this.dataArray.length;
    const normalizedVolume = Math.min(1.0, average / 128); // 0.0 to 1.0
    const volumeDb = average > 0 ? 20 * Math.log10(average / 255) : -100;

    const shouldOpen = volumeDb > this.thresholdDb;

    if (this.isFilterEnabled) {
      const now = this.ctx.currentTime;
      if (shouldOpen && !this.isOpen) {
        this.isOpen = true;
        this.gateGainNode.gain.cancelScheduledValues(now);
        this.gateGainNode.gain.setTargetAtTime(1.0, now, this.attackTime);
      } else if (!shouldOpen && this.isOpen) {
        this.isOpen = false;
        this.gateGainNode.gain.cancelScheduledValues(now);
        this.gateGainNode.gain.setTargetAtTime(0.0, now, this.releaseTime);
      }
    } else {
      this.gateGainNode.gain.value = 1.0;
      this.isOpen = true;
    }

    if (this.onVolumeChange) {
      this.onVolumeChange(normalizedVolume, this.isOpen);
    }

    return { volume: normalizedVolume, isOpen: this.isOpen };
  }

  setThreshold(db) {
    this.thresholdDb = db;
  }

  setFilterEnabled(enabled) {
    this.isFilterEnabled = enabled;
    if (!enabled) {
      this.gateGainNode.gain.value = 1.0;
    }
  }

  getInput() {
    return this.inputNode;
  }

  getOutput() {
    return this.outputNode;
  }
}
