/**
 * WebRTC Signaling Handler for Multi-Peer Full-Mesh Rooms
 */

class SignalingHandler {
  constructor() {
    // Map of roomId -> Map of peerId -> { ws, userName, isStreaming }
    this.rooms = new Map();
  }

  handleConnection(ws) {
    let currentRoomId = null;
    let currentPeerId = null;
    let currentUserName = 'Guest';

    ws.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        const { type, data } = message;

        switch (type) {
          case 'join-room': {
            const { roomId, peerId, userName } = data;
            currentRoomId = roomId;
            currentPeerId = peerId;
            currentUserName = userName || 'Guest';

            if (!this.rooms.has(roomId)) {
              this.rooms.set(roomId, new Map());
            }

            const room = this.rooms.get(roomId);

            // Get existing peers in the room before adding the new one
            const existingPeers = [];
            for (const [id, peer] of room.entries()) {
              existingPeers.push({
                peerId: id,
                userName: peer.userName,
                isStreaming: peer.isStreaming
              });
            }

            // Save new peer into the room
            room.set(peerId, {
              ws,
              userName: currentUserName,
              isStreaming: false
            });

            // Send back room join confirmation with existing peers
            ws.send(JSON.stringify({
              type: 'room-joined',
              data: {
                roomId,
                peerId,
                existingPeers
              }
            }));

            // Notify existing peers about the newly joined peer
            this.broadcastToRoom(roomId, peerId, {
              type: 'peer-joined',
              data: {
                peerId,
                userName: currentUserName,
                isStreaming: false
              }
            });
            break;
          }

          case 'offer':
          case 'answer':
          case 'ice-candidate':
          case 'speaking-state':
          case 'stream-status': {
            const { targetPeerId } = data;
            if (targetPeerId) {
              // Direct message to a specific peer
              this.sendToPeer(currentRoomId, targetPeerId, {
                type,
                data: {
                  ...data,
                  senderPeerId: currentPeerId
                }
              });
            } else if (type === 'speaking-state') {
              this.broadcastToRoom(currentRoomId, currentPeerId, {
                type: 'speaking-state',
                data: {
                  senderPeerId: currentPeerId,
                  isSpeaking: data.isSpeaking
                }
              });
            } else if (type === 'stream-status') {
              // Broadcast stream status to everyone in room
              const room = this.rooms.get(currentRoomId);
              if (room && room.has(currentPeerId)) {
                room.get(currentPeerId).isStreaming = data.isStreaming;
              }
              this.broadcastToRoom(currentRoomId, currentPeerId, {
                type: 'stream-status',
                data: {
                  senderPeerId: currentPeerId,
                  isStreaming: data.isStreaming,
                  userName: currentUserName
                }
              });
            }
            break;
          }

          default:
            console.warn(`[Signaling] Unknown message type: ${type}`);
        }
      } catch (err) {
        console.error('[Signaling] Failed to process message:', err.message);
      }
    });

    ws.on('close', () => {
      if (currentRoomId && currentPeerId) {
        const room = this.rooms.get(currentRoomId);
        if (room) {
          room.delete(currentPeerId);
          if (room.size === 0) {
            this.rooms.delete(currentRoomId);
          } else {
            this.broadcastToRoom(currentRoomId, currentPeerId, {
              type: 'peer-left',
              data: {
                peerId: currentPeerId,
                userName: currentUserName
              }
            });
          }
        }
      }
    });
  }

  sendToPeer(roomId, targetPeerId, message) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const targetPeer = room.get(targetPeerId);
    if (targetPeer && targetPeer.ws.readyState === targetPeer.ws.OPEN) {
      targetPeer.ws.send(JSON.stringify(message));
    }
  }

  broadcastToRoom(roomId, senderPeerId, message) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const [peerId, peer] of room.entries()) {
      if (peerId !== senderPeerId && peer.ws.readyState === peer.ws.OPEN) {
        peer.ws.send(JSON.stringify(message));
      }
    }
  }
}

module.exports = SignalingHandler;
