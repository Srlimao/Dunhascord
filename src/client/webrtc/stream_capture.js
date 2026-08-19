import { AudioMixer } from './audio_mixer.js';

export const QUALITY_PRESETS = {
  '1080p60': {
    name: '1080p 60 FPS (Crisp Gaming / Motion)',
    width: 1920,
    height: 1080,
    frameRate: 60,
    maxBitrate: 10000000,
    minBitrateKbps: 6000
  },
  '1080p30': {
    name: '1080p 30 FPS (Standard)',
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 6000000,
    minBitrateKbps: 3000
  },
  '720p60': {
    name: '720p 60 FPS (High Motion / Low Latency)',
    width: 1280,
    height: 720,
    frameRate: 60,
    maxBitrate: 5000000,
    minBitrateKbps: 2500
  },
  '1440p60': {
    name: '1440p 60 FPS (Ultra 2K)',
    width: 2560,
    height: 1440,
    frameRate: 60,
    maxBitrate: 16000000,
    minBitrateKbps: 8000
  }
};

export class StreamCapture {
  constructor() {
    this.localStream = null;
    this.activePresetKey = '1080p60';
    this.onStreamEndedCallback = null;
    this.audioMixer = new AudioMixer();
  }

  async startCapture({ presetKey = '1080p60', audioDeviceId = 'default-screen' }) {
    this.activePresetKey = presetKey;
    const preset = QUALITY_PRESETS[presetKey] || QUALITY_PRESETS['1080p60'];

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error(
        'Screen sharing is not supported on this browser or page. ' +
        'Please ensure you are connected via HTTPS (https://) or localhost.'
      );
    }

    const constraints = {
      video: {
        width: { ideal: preset.width, max: preset.width },
        height: { ideal: preset.height, max: preset.height },
        frameRate: { ideal: preset.frameRate, max: preset.frameRate },
        cursor: 'always'
      },
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: 2,
        suppressLocalAudioPlayback: false
      },
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude'
    };

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia(constraints);

      // Handle video track & motion optimization
      const videoTrack = displayStream.getVideoTracks()[0];
      if (videoTrack) {
        if ('contentHint' in videoTrack) {
          videoTrack.contentHint = 'motion';
        }
        videoTrack.onended = () => {
          this.stopCapture();
          if (this.onStreamEndedCallback) {
            this.onStreamEndedCallback();
          }
        };
      }

      // Build mixed or targeted audio track (e.g. app virtual device or screen sound)
      const mixedAudioTrack = await this.audioMixer.buildMixedAudioTrack({
        displayStream,
        customDeviceId: audioDeviceId !== 'default-screen' ? audioDeviceId : null
      });

      const outputTracks = [videoTrack];
      if (mixedAudioTrack) {
        outputTracks.push(mixedAudioTrack);
      }

      this.localStream = new MediaStream(outputTracks);
      return this.localStream;
    } catch (err) {
      console.error('[StreamCapture] Error getting display media:', err);
      throw err;
    }
  }

  stopCapture() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.audioMixer.cleanup();
  }

  getStream() {
    return this.localStream;
  }

  isCapturing() {
    return !!(this.localStream && this.localStream.active);
  }

  setOnStreamEnded(callback) {
    this.onStreamEndedCallback = callback;
  }

  async getAudioDevices() {
    return this.audioMixer.getAvailableAudioDevices();
  }

  async applyOptimalSenderParameters(sender) {
    if (!sender || sender.track?.kind !== 'video') return;
    try {
      const preset = QUALITY_PRESETS[this.activePresetKey] || QUALITY_PRESETS['1080p60'];
      const params = sender.getParameters();
      params.degradationPreference = 'maintain-framerate';

      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = preset.maxBitrate;
      params.encodings[0].maxFramerate = preset.frameRate;
      await sender.setParameters(params);
    } catch (err) {
      console.warn('[StreamCapture] Could not apply sender parameters:', err.message);
    }
  }

  mungeSdpForSmooth60Fps(sdp) {
    const preset = QUALITY_PRESETS[this.activePresetKey] || QUALITY_PRESETS['1080p60'];
    const minKbps = preset.minBitrateKbps || 6000;
    const maxKbps = Math.round(preset.maxBitrate / 1000) || 12000;
    const startKbps = Math.round((minKbps + maxKbps) / 2);

    let lines = sdp.split('\r\n');
    let mungeLines = [];

    for (let line of lines) {
      mungeLines.push(line);
      if (line.startsWith('m=video')) {
        mungeLines.push(`b=AS:${maxKbps}`);
        mungeLines.push(`b=TIAS:${maxKbps * 1000}`);
      }
      if (line.startsWith('a=fmtp:') && line.includes('level-asymmetry-allowed=')) {
        mungeLines.push(`a=fmtp:${line.split(' ')[0].replace('a=fmtp:', '')} x-google-min-bitrate=${minKbps};x-google-max-bitrate=${maxKbps};x-google-start-bitrate=${startKbps}`);
      }
    }

    return mungeLines.join('\r\n');
  }
}
