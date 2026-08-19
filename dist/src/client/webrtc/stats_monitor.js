/**
 * WebRTC Realtime Stats Monitor for FPS, Resolution, Bitrate, and Latency
 */

export class StatsMonitor {
  constructor(peerConnection, onStatsUpdate) {
    this.pc = peerConnection;
    this.onStatsUpdate = onStatsUpdate;
    this.intervalId = null;
    this.previousBytesReceived = 0;
    this.previousTimestamp = 0;
  }

  start(intervalMs = 1000) {
    this.stop();
    this.intervalId = setInterval(async () => {
      if (!this.pc || this.pc.connectionState === 'closed') {
        this.stop();
        return;
      }

      try {
        const stats = await this.pc.getStats();
        let fps = 0;
        let width = 0;
        let height = 0;
        let bitrateMbps = 0;
        let rttMs = 0;
        let packetsLost = 0;

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            fps = report.framesPerSecond || 0;
            width = report.frameWidth || 0;
            height = report.frameHeight || 0;
            packetsLost = report.packetsLost || 0;

            const now = report.timestamp;
            const bytes = report.bytesReceived || 0;
            if (this.previousTimestamp > 0) {
              const durationSec = (now - this.previousTimestamp) / 1000;
              if (durationSec > 0) {
                const bitsReceived = (bytes - this.previousBytesReceived) * 8;
                bitrateMbps = (bitsReceived / durationSec / (1024 * 1024)).toFixed(2);
              }
            }
            this.previousBytesReceived = bytes;
            this.previousTimestamp = now;
          }

          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime) {
              rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
          }
        });

        if (this.onStatsUpdate) {
          this.onStatsUpdate({
            fps: Math.round(fps),
            resolution: width && height ? `${width}x${height}` : 'Active',
            bitrate: bitrateMbps > 0 ? `${bitrateMbps} Mbps` : 'Calculating...',
            latency: rttMs > 0 ? `${rttMs} ms` : '< 10 ms',
            packetsLost
          });
        }
      } catch (err) {
        // Peer connection closed or transitioning
      }
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
