// chat-server.js - 零依赖 WebSocket 聊天服务器（完整修复版）
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = require('crypto');

// ============ 游戏模块加载 ============
let ZhaJinHua, PaoDeKuai;
try {
    const zjh = require('./games/zha金花');
    const pdk = require('./games/paodekuai');
    ZhaJinHua = zjh.ZhaJinHua;
    PaoDeKuai = pdk.PaoDeKuai;
} catch (e) {
    console.warn('[警告] 游戏模块加载失败:', e.message);
    ZhaJinHua = class { constructor() {} };
    PaoDeKuai = class { constructor() {} };
}

const PORT = process.env.PORT || 3000;

// ============ 数据结构 ============
const rooms = new Map();
const clients = new Map();
const gameInstances = new Map();

// ============ HTTP 服务器 ============
const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const pathname = url.split('?')[0].split('#')[0];

    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

    if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    let filePath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(__dirname, safePath);

    fs.stat(fullPath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`404 Not Found: ${pathname}`);
            return;
        }

        const ext = path.extname(fullPath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.txt': 'text/plain; charset=utf-8',
            '.wasm': 'application/wasm',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        fs.readFile(fullPath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`500 Internal Server Error: ${err.message}`);
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });
});

// ============ WebSocket 升级处理 ============
server.on('upgrade', (req, socket, head) => {
    console.log('[WS] 新的 WebSocket 连接请求');

    if (req.headers['upgrade'] !== 'websocket') {
        socket.destroy();
        return;
    }

    const acceptKey = req.headers['sec-websocket-key'];
    const hash = crypto
        .createHash('sha1')
        .update(acceptKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${hash}`,
        '\r\n'
    ].join('\r\n');

    socket.write(responseHeaders);

    const clientId = randomUUID();
    const client = {
        id: clientId,
        socket: socket,
        buffer: Buffer.alloc(0),
        name: '匿名',
        roomId: null
    };

    clients.set(socket, client);

    sendToClient(client, {
        type: 'connected',
        id: clientId,
        timestamp: Date.now()
    });

    socket.on('data', (chunk) => handleWebSocketData(client, chunk));
    socket.on('close', () => handleDisconnect(client));
    socket.on('error', (err) => {
        console.error('[WS] 连接错误:', err.message);
        handleDisconnect(client);
    });
});

// ============ WebSocket 帧处理 ============
function handleWebSocketData(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);

    while (client.buffer.length >= 2) {
        const firstByte = client.buffer[0];
        const secondByte = client.buffer[1];

        const fin = (firstByte & 0x80) !== 0;
        const opcode = firstByte & 0x0F;
        const masked = (secondByte & 0x80) !== 0;
        let payloadLength = secondByte & 0x7F;

        let offset = 2;

        if (payloadLength === 126) {
            if (client.buffer.length < 4) return;
            payloadLength = client.buffer.readUInt16BE(2);
            offset = 4;
        } else if (payloadLength === 127) {
            if (client.buffer.length < 10) return;
            payloadLength = Number(client.buffer.readBigUInt64BE(2));
            offset = 10;
        }

        if (!masked) {
            client.socket.destroy();
            return;
        }

        const mask = client.buffer.slice(offset, offset + 4);
        offset += 4;

        if (client.buffer.length < offset + payloadLength) return;

        const payload = client.buffer.slice(offset, offset + payloadLength);
        const unmasked = Buffer.alloc(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
            unmasked[i] = payload[i] ^ mask[i % 4];
        }

        client.buffer = client.buffer.slice(offset + payloadLength);

        if (opcode === 0x8) {
            handleDisconnect(client);
            return;
        }

        if (opcode === 0x9) {
            sendPong(client);
            continue;
        }

        if (opcode === 0x1) {
            try {
                const message = JSON.parse(unmasked.toString('utf8'));
                handleMessage(client, message);
            } catch (e) {
                console.error('[WS] 消息解析失败:', e.message);
            }
        }
    }
}

// ============ 发送 Pong ============
function sendPong(client) {
    try {
        const frame = Buffer.from([0x8A, 0x00]);
        client.socket.write(frame);
        console.log('[WS] 回复 Pong 心跳');
    } catch (e) {}
}

// ============ 发送消息 ============
function sendToClient(client, data) {
    if (!client || !client.socket) return;

    const str = JSON.stringify(data);
    const bytes = Buffer.from(str, 'utf8');
    const length = bytes.length;

    let frame;
    if (length <= 125) {
        frame = Buffer.alloc(2 + length);
        frame[0] = 0x81;
        frame[1] = length;
        bytes.copy(frame, 2);
    } else if (length <= 65535) {
        frame = Buffer.alloc(4 + length);
        frame[0] = 0x81;
        frame[1] = 126;
        frame.writeUInt16BE(length, 2);
        bytes.copy(frame, 4);
    } else {
        frame = Buffer.alloc(10 + length);
        frame[0] = 0x81;
        frame[1] = 127;
        frame.writeBigUInt64BE(BigInt(length), 2);
        bytes.copy(frame, 10);
    }

    try {
        client.socket.write(frame);
    } catch (e) {
        handleDisconnect(client);
    }
}

// ============ 广播 ============
function broadcast(roomId, data, excludeId = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    for (const player of room.players) {
        if (player.id === excludeId) continue;
        const client = getClientById(player.id);
        if (client) {
            sendToClient(client, data);
        }
    }
}

// ============ 辅助函数 ============
function getClientById(id) {
    for (const [socket, client] of clients) {
        if (client.id === id) return client;
    }
    return null;
}

// ============ 消息路由 ============
function handleMessage(client, msg) {
    console.log(`[消息] ${client.name}:`, msg.type);

    switch (msg.type) {
        case 'join':
        case 'join_room':
            handleJoin(client, msg);
            break;
        case 'chat':
        case 'message':
            handleChat(client, msg);
            break;
        case 'start_game':
            handleStartGame(client, msg);
            break;
        case 'game_action':
            handleGameAction(client, msg);
            break;
        case 'leave':
        case 'leave_room':
            leaveRoom(client);
            break;
        case 'ping':
            sendToClient(client, { type: 'pong', timestamp: Date.now() });
            break;
        default:
            console.log('[消息] 未知类型:', msg.type);
    }
}

// ============ 加入房间 ============
function handleJoin(client, msg) {
    const name = String(msg.name || msg.nickname || '匿名').slice(0, 20);
    const roomId = String(msg.roomId || msg.room || 'default');

    if (client.roomId) {
        leaveRoom(client);
    }

    client.name = name;
    client.roomId = roomId;

    if (!rooms.has(roomId)) {
        rooms.set(roomId, { players: [], game: null, gameType: null });
    }

    const room = rooms.get(roomId);
    room.players.push({ id: client.id, name: name });

    sendToClient(client, {
        type: 'joined',
        roomId: roomId,
        players: room.players.map(p => ({ id: p.id, name: p.name }))
    });

    broadcast(roomId, {
        type: 'player_joined',
        player: { id: client.id, name: name },
        players: room.players.map(p => ({ id: p.id, name: p.name }))
    }, client.id);

    const gameWrapper = gameInstances.get(roomId);
    if (gameWrapper) {
        broadcastGameState(gameWrapper.game, roomId);
    }
}

// ============ 聊天 ============
function handleChat(client, msg) {
    if (!client.roomId) return;

    const content = String(msg.content || msg.text || '').slice(0, 500);
    if (!content.trim()) return;

    broadcast(client.roomId, {
        type: 'chat',
        from: { id: client.id, name: client.name },
        content: content,
        time: Date.now()
    });
}

// ============ 离开房间 ============
function leaveRoom(client) {
    if (!client.roomId) return;

    const roomId = client.roomId;
    const room = rooms.get(roomId);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== client.id);

    broadcast(roomId, {
        type: 'player_left',
        playerId: client.id,
        players: room.players.map(p => ({ id: p