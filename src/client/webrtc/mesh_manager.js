import { StatsMonitor } from './stats_monitor.js';

const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]
};

export class MeshManager {
  constructor(opts) {
    this.roomId = opts.roomId;
    this.peerId = opts.peerId;
    this.userName = opts.userName;
    this.streamCapture = opts.streamCapture;
    this.onRemoteVoiceAdd = opts.onRemoteVoiceAdd;
    this.onRemoteStreamAdd = opts.onRemoteStreamAdd;
    this.onRemoteStreamRemove = opts.onRemoteStreamRemove;
    this.onPeerUpdate = opts.onPeerUpdate;
    this.onStatsUpdate = opts.onStatsUpdate;
    this.onRemoteSpeakingChange = opts.onRemoteSpeakingChange;

    this.ws = null;
    this.peers = new Map();
    this.localVoiceStream = null;
    this.localScreenStream = null;
  }

  connect() {
    let wsUrl;
    if (window.location.host && !window.location.protocol.startsWith('file')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}`;
    } else {
      wsUrl = 'ws://dunhas.ddns.net:3000';
    }
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.sendSignaling('join-room', { roomId: this.roomId, peerId: this.peerId, userName: this.userName });
    };

    this.ws.onmessage = async (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        await this.handleSignalingMessage(type, data);
      } catch (err) {
        console.error('[MeshManager] Error parsing message:', err);
      }
    };
  }

  sendSignaling(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  async handleSignalingMessage(type, data) {
    switch (type) {
      case 'room-joined': {
        for (const peer of data.existingPeers) {
          this.createPeerConnection(peer.peerId, peer.userName, true, true);
        }
        this.notifyPeersChanged();
        break;
      }
      case 'peer-joined': {
        this.createPeerConnection(data.peerId, data.userName, false, false);
        this.notifyPeersChanged();
        break;
      }
      case 'offer': {
        const { senderPeerId, sdp } = data;
        let peer = this.peers.get(senderPeerId) || this.createPeerConnection(senderPeerId, 'Friend', false, true);
        const collision = peer.makingOffer || peer.pc.signalingState !== 'stable';
        if (collision && !peer.isPolite) return;

        await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.pc.createAnswer();
        const mungedSdp = this.streamCapture ? this.streamCapture.mungeSdpForSmooth60Fps(answer.sdp) : answer.sdp;
        await peer.pc.setLocalDescription({ type: 'answer', sdp: mungedSdp });
        this.sendSignaling('answer', { targetPeerId: senderPeerId, sdp: peer.pc.localDescription });
        break;
      }
      case 'answer': {
        const peer = this.peers.get(data.senderPeerId);
        if (peer && peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
        break;
      }
      case 'ice-candidate': {
        const peer = this.peers.get(data.senderPeerId);
        if (peer && data.candidate) {
          try { await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
        }
        break;
      }
      case 'speaking-state': {
        const peer = this.peers.get(data.senderPeerId);
        if (peer) peer.isSpeaking = data.isSpeaking;
        if (this.onRemoteSpeakingChange) this.onRemoteSpeakingChange(data.senderPeerId, data.isSpeaking);
        break;
      }
      case 'stream-status': {
        const peer = this.peers.get(data.senderPeerId);
        if (peer) {
          peer.isStreaming = data.isStreaming;
          if (data.userName) peer.userName = data.userName;
        }
        if (!data.isStreaming && this.onRemoteStreamRemove) this.onRemoteStreamRemove(data.senderPeerId);
        this.notifyPeersChanged();
        break;
      }
      case 'peer-left': {
        this.removePeer(data.peerId);
        break;
      }
    }
  }

  createPeerConnection(targetPeerId, userName, isInitiator, isPolite) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const peerInfo = {
      pc,
      userName: userName || 'Friend',
      voiceSenders: [],
      screenSenders: [],
      statsMonitor: null,
      isStreaming: false,
      isSpeaking: false,
      makingOffer: false,
      isPolite: isPolite ?? (this.peerId < targetPeerId),
      remoteScreenStream: null,
      remoteVoiceStream: null
    };
    this.peers.set(targetPeerId, peerInfo);

    if (this.localVoiceStream) {
      this.localVoiceStream.getTracks().forEach((t) => {
        peerInfo.voiceSenders.push(pc.addTrack(t, this.localVoiceStream));
      });
    }

    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => {
        const sender = pc.addTrack(t, this.localScreenStream);
        peerInfo.screenSenders.push(sender);
        if (this.streamCapture) this.streamCapture.applyOptimalSenderParameters(sender);
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignaling('ice-candidate', { targetPeerId, candidate: e.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      const isVideo = event.track.kind === 'video';
      console.log(`[MeshManager] ontrack from ${peerInfo.userName}: kind=${event.track.kind}`);

      if (isVideo) {
        peerInfo.remoteScreenStream = stream;
        if (this.onRemoteStreamAdd) this.onRemoteStreamAdd(targetPeerId, stream, peerInfo.userName);
        if (!peerInfo.statsMonitor) {
          peerInfo.statsMonitor = new StatsMonitor(pc, (s) => {
            if (this.onStatsUpdate) this.onStatsUpdate(targetPeerId, s);
          });
          peerInfo.statsMonitor.start(1000);
        }
      } else {
        if (peerInfo.remoteScreenStream && stream.id === peerInfo.remoteScreenStream.id) {
          peerInfo.remoteScreenStream.addTrack(event.track);
          if (this.onRemoteStreamAdd) this.onRemoteStreamAdd(targetPeerId, peerInfo.remoteScreenStream, peerInfo.userName);
        } else {
          peerInfo.remoteVoiceStream = stream;
          if (this.onRemoteVoiceAdd) this.onRemoteVoiceAdd(targetPeerId, stream, peerInfo.userName);
        }
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        peerInfo.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        const mungedSdp = this.streamCapture ? this.streamCapture.mungeSdpForSmooth60Fps(offer.sdp) : offer.sdp;
        await pc.setLocalDescription({ type: 'offer', sdp: mungedSdp });
        this.sendSignaling('offer', { targetPeerId, sdp: pc.localDescription });
      } catch (err) {
        console.error('[MeshManager] Negotiation error:', err);
      } finally {
        peerInfo.makingOffer = false;
      }
    };

    if (isInitiator) pc.onnegotiationneeded();
    return peerInfo;
  }

  setLocalVoiceStream(stream) {
    this.localVoiceStream = stream;
    for (const [, peer] of this.peers.entries()) {
      peer.voiceSenders.forEach((s) => { try { peer.pc.removeTrack(s); } catch (e) {} });
      peer.voiceSenders = [];
      if (stream) {
        stream.getTracks().forEach((t) => peer.voiceSenders.push(peer.pc.addTrack(t, stream)));
      }
    }
  }

  setLocalScreenStream(stream) {
    this.localScreenStream = stream;
    this.sendSignaling('stream-status', { isStreaming: !!stream });
    for (const [, peer] of this.peers.entries()) {
      peer.screenSenders.forEach((s) => { try { peer.pc.removeTrack(s); } catch (e) {} });
      peer.screenSenders = [];
      if (stream) {
        stream.getTracks().forEach((t) => {
          const sender = peer.pc.addTrack(t, stream);
          peer.screenSenders.push(sender);
          if (this.streamCapture) this.streamCapture.applyOptimalSenderParameters(sender);
        });
      }
    }
  }

  broadcastSpeakingState(isSpeaking) {
    this.sendSignaling('speaking-state', { isSpeaking });
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      if (peer.statsMonitor) peer.statsMonitor.stop();
      peer.pc.close();
      this.peers.delete(peerId);
      if (this.onRemoteStreamRemove) this.onRemoteStreamRemove(peerId);
      this.notifyPeersChanged();
    }
  }

  notifyPeersChanged() {
    if (this.onPeerUpdate) {
      const list = Array.from(this.peers.entries()).map(([id, p]) => ({
        peerId: id,
        userName: p.userName,
        isStreaming: p.isStreaming,
        isSpeaking: p.isSpeaking
      }));
      this.onPeerUpdate(list);
    }
  }

  disconnect() {
    for (const [id] of this.peers.entries()) this.removePeer(id);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
