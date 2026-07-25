const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== 零依赖 WebSocket 服务器 =====
// 自己实现 WebSocket 协议（RFC 6455），不依赖任何第三方包

const server = http.createServer((req, res) => {
  // 修复：直接从根目录读取，不再拼接 'public'
  let urlPath = req.url.split('?')[0]; // 去掉查询参数
  let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);

  // 防止路径穿越攻击
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };
  const contentType = contentTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
    res.end(data);
  });
});

// WebSocket 握手升级
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  const ws = new WSConnection(socket);
  handleConnection(ws, req);
});

// 简易 WebSocket 连接封装
function WSConnection(socket) {
  this.socket = socket;
  this.readyState = 1; // OPEN
  this.buffer = Buffer.alloc(0);
  this.frameQueue = [];

  socket.on('data', (chunk) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this._processBuffer();
  });

  socket.on('close', () => { this.readyState = 3; this.onclose && this.onclose(); });
  socket.on('error', () => { this.readyState = 3; });
}

WSConnection.prototype._processBuffer = function() {
  while (true) {
    const buf = this.buffer;
    if (buf.length < 2) break;

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let payloadLen = buf[1] & 0x7f;
    let offset = 2;

    if (payloadLen === 126) { payloadLen = buf.readUInt16BE(2); offset = 4; }
    else if (payloadLen === 127) { payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10; }

    let maskingKey;
    if (masked) { maskingKey = buf.slice(offset, offset + 4); offset += 4; }

    if (buf.length < offset + payloadLen) break;

    let payload = buf.slice(offset, offset + payloadLen);
    if (masked) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskingKey[i % 4];
    }

    this.buffer = buf.slice(offset + payloadLen);

    if (opcode === 0x01) {
      this.onmessage && this.onmessage(payload.toString('utf8'));
    } else if (opcode === 0x08) {
      this.readyState = 3;
      this.onclose && this.onclose();
      this.socket.end();
      return;
    } else if (opcode === 0x09) {
      this._sendFrame(0x0a, payload);
    }
  }
};

WSConnection.prototype.send = function(data) {
  if (this.readyState !== 1) return;
  const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  this._sendFrame(0x01, payload);
};

WSConnection.prototype._sendFrame = function(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x80 | opcode, len]); }
  else if (len < 65536) { header = Buffer.concat([Buffer.from([0x80 | opcode, 126]), Buffer.alloc(2)]); header.writeUInt16BE(len, 2); }
  else { header = Buffer.concat([Buffer.from([0x80 | opcode, 127]), Buffer.alloc(8)]); header.writeBigUInt64BE(BigInt(len), 2); }
  this.socket.write(Buffer.concat([header, payload]));
};

WSConnection.prototype.close = function() {
  if (this.readyState === 1) {
    this._sendFrame(0x08, Buffer.from([]));
    this.readyState = 3;
    this.socket.end();
  }
};

// ===== 房间 & 用户管理 =====
const rooms = new Map();
let userCount = 0;

function broadcast(roomId, message, excludeWs) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const [_, user] of room) {
    if (user.ws !== excludeWs && user.ws.readyState === 1) user.ws.send(data);
  }
}

function sendTo(ws, message) {
  ws.send(JSON.stringify(message));
}

function getOnlineList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.values()].map(u => u.nickname);
}

function handleConnection(ws) {
  const userId = ++userCount;
  let userRoom = null;
  let userNickname = '匿名' + userId;

  ws.onmessage = (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const roomId = msg.room || 'lobby';
        userNickname = msg.nickname || userNickname;
        userRoom = roomId;

        if (!rooms.has(roomId)) rooms.set(roomId, new Map());
        rooms.get(roomId).set(userId, { ws, nickname: userNickname });

        sendTo(ws, { type: 'joined', nickname: userNickname, room: roomId });
        broadcast(roomId, { type: 'system', text: `🟢 ${userNickname} 加入了房间` }, ws);

        const online = getOnlineList(roomId);
        broadcast(roomId, { type: 'online', users: online });
        console.log(`[+] ${userNickname} → ${roomId}`);
        break;
      }
      case 'message': {
        if (!userRoom) return;
        const payload = {
          type: 'message',
          author: userNickname,
          text: msg.text,
          time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };
        broadcast(userRoom, payload);
        console.log(`[${userRoom}] ${userNickname}: ${msg.text}`);
        break;
      }
      case 'typing': {
        if (!userRoom) return;
        broadcast(userRoom, { type: 'typing', author: userNickname, isTyping: msg.isTyping }, ws);
        break;
      }
    }
  };

  ws.onclose = () => {
    if (userRoom && rooms.has(userRoom)) {
      rooms.get(userRoom).delete(userId);
      broadcast(userRoom, { type: 'system', text: `🔴 ${userNickname} 离开了房间` });
      const room = rooms.get(userRoom);
      if (room.size === 0) { rooms.delete(userRoom); }
      else { broadcast(userRoom, { type: 'online', users: getOnlineList(userRoom) }); }
      console.log(`[-] ${userNickname} ← ${userRoom}`);
    }
  };
}

// ===== 启动 =====
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🚀 聊天室已启动 → http://${HOST}:${PORT}`);
  console.log(`   支持多房间、实时消息、打字提示、在线列表`);
});
