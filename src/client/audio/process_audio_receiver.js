/**
 * Process Audio Receiver (Electron Native WASAPI Process Loopback)
 * Converts raw 48kHz 16-bit PCM chunks into a Web Audio MediaStreamTrack
 * Includes local audio monitoring and high-precision volume metering
 */

export class ProcessAudioReceiver {
  constructor() {
    this.audioCtx = null;
    this.destination = null;
    this.scriptNode = null;
    this.monitorGain = null;
    this.sampleRate = 48000;
    this.channels = 2;

    this.pcmBufferQueue = [];
    this.isPlaying = false;
    this.isMonitoring = false;
    this.onVolumeCallback = null;
    this.loggedChunks = 0;
  }

  start() {
    this.cleanupNodes();

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass({ sampleRate: this.sampleRate });
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.destination = this.audioCtx.createMediaStreamDestination();

    this.monitorGain = this.audioCtx.createGain();
    this.monitorGain.gain.value = this.isMonitoring ? 1.0 : 0.0;
    this.monitorGain.connect(this.audioCtx.destination);

    const bufferSize = 2048;
    this.scriptNode = this.audioCtx.createScriptProcessor(bufferSize, 0, this.channels);

    let currentBuffer = null;
    let bufferOffset = 0;

    this.scriptNode.onaudioprocess = (e) => {
      const leftOut = e.outputBuffer.getChannelData(0);
      const rightOut = e.outputBuffer.getChannelData(1);
      let sum = 0;

      for (let i = 0; i < bufferSize; i++) {
        if (!currentBuffer || bufferOffset >= currentBuffer.length) {
          if (this.pcmBufferQueue.length > 0) {
            currentBuffer = this.pcmBufferQueue.shift();
            bufferOffset = 0;
          } else {
            currentBuffer = null;
            leftOut[i] = 0;
            rightOut[i] = 0;
            continue;
          }
        }

        const l = currentBuffer[bufferOffset++];
        const r = currentBuffer[bufferOffset++];
        leftOut[i] = l;
        rightOut[i] = r;
        sum += (l * l) + (r * r);
      }

      if (this.onVolumeCallback && bufferSize > 0) {
        const rms = Math.sqrt(sum / (bufferSize * 2));
        this.onVolumeCallback(Math.min(1.0, rms * 5));
      }
    };

    this.scriptNode.connect(this.destination);
    this.scriptNode.connect(this.monitorGain);

    if (window.electronAPI?.onProcessAudioData) {
      window.electronAPI.onProcessAudioData((chunk) => {
        this.pushPcmChunk(chunk);
      });
    }

    this.isPlaying = true;
    console.log('[ProcessAudioReceiver] Started WebAudio receiver, sampleRate:', this.audioCtx.sampleRate);
    return this.destination.stream.getAudioTracks()[0];
  }

  pushPcmChunk(chunk) {
    if (!this.isPlaying || !chunk) return;

    let int16View;
    if (chunk instanceof ArrayBuffer) {
      int16View = new Int16Array(chunk);
    } else if (ArrayBuffer.isView(chunk)) {
      int16View = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
    } else if (chunk.data && Array.isArray(chunk.data)) {
      int16View = new Int16Array(new Uint8Array(chunk.data).buffer);
    } else {
      return;
    }

    const float32 = new Float32Array(int16View.length);
    for (let i = 0; i < int16View.length; i++) {
      float32[i] = int16View[i] / 32768.0;
    }

    this.pcmBufferQueue.push(float32);

    this.loggedChunks++;
    if (this.loggedChunks % 100 === 1) {
      console.log(`[AudioReceiver] Received ${this.loggedChunks} chunks. Queue size: ${this.pcmBufferQueue.length}`);
    }

    if (this.pcmBufferQueue.length > 20) {
      this.pcmBufferQueue.shift();
    }
  }

  setLocalMonitoring(enabled) {
    this.isMonitoring = enabled;
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    if (this.monitorGain && this.audioCtx) {
      this.monitorGain.gain.setValueAtTime(enabled ? 1.0 : 0.0, this.audioCtx.currentTime);
    }
    console.log('[ProcessAudioReceiver] Local audio monitoring set to:', enabled);
  }

  cleanupNodes() {
    this.isPlaying = false;
    this.pcmBufferQueue = [];

    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.destination = null;
    this.monitorGain = null;
  }

  stop() {
    this.cleanupNodes();
    if (window.electronAPI?.stopProcessAudioCapture) {
      window.electronAPI.stopProcessAudioCapture();
    }
  }
}
