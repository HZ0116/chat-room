// chat-server.js - 零依赖 WebSocket 聊天服务器（含游戏修复）

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { ZhaJinHua } = require('./games/zha金花');
const { PaoDeKuai } = require('./games/paodekuai');

const PORT = process.env.PORT || 3000;
const server = http.createServer();

// 静态文件服务（index.html 在根目录）
server.on('request', (req, res) => {
    // favicon 静默处理
    if (req.url === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
    }

    const url = req.url === '/' ? '/index.html' : req.url;
    
    // 防止路径穿越
    const sanitizedPath = path.normalize(url).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, sanitizedPath);

    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif'
    };

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        const mime = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
});

// 房间管理
const rooms = new Map(); // roomId -> { players: [], game: null, gameType: null }

// 连接管理
const clients = new Map(); // ws -> { id, name, roomId }

// 游戏实例
const games = new Map(); // roomId -> game instance

// WebSocket 握手及帧处理
server.on('upgrade', (req, socket, head) => {
    if (req.headers['upgrade'] !== 'websocket') {
        socket.destroy();
        return;
    }

    const acceptKey = req.headers['sec-websocket-key'];
    const hash = require('crypto')
        .createHash('sha1')
        .update(acceptKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${hash}\r\n\r\n`
    );

    const clientId = randomUUID();
    const client = {
        id: clientId,
        socket,
        buffer: Buffer.alloc(0),
        name: '匿名',
        roomId: null
    };

    clients.set(socket, client);

    socket.on('data', (chunk) => handleFrame(client, chunk));
    socket.on('close', () => handleDisconnect(client));
    socket.on('error', () => handleDisconnect(client));

    sendToClient(client, {
        type: 'connected',
        id: clientId
    });
});

// WebSocket 帧解析
function handleFrame(client, chunk) {
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

        // ping 帧，回复 pong 防 Railway 空闲断开
        if (opcode === 0x9) {
            socket.write(Buffer.from([0x8A, 0x00]));
            continue;
        }

        if (opcode === 0x1) {
            try {
                const message = JSON.parse(unmasked.toString('utf8'));
                handleMessage(client, message);
            } catch (e) {
                console.error('消息解析失败:', e);
            }
        }
    }
}

// 发送消息
function sendToClient(client, data) {
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

function broadcast(roomId, data, excludeId = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    for (const p of room.players) {
        if (p.id === excludeId) continue;
        const client = Array.from(clients.values()).find(c => c.id === p.id);
        if (client) {
            sendToClient(client, data);
        }
    }
}

function handleDisconnect(client) {
    if (client.roomId) {
        leaveRoom(client);
    }
    clients.delete(client.socket);
    try {
        client.socket.destroy();
    } catch (e) {
        // ignore
    }
}

// 消息路由
function handleMessage(client, msg) {
    switch (msg.type) {
        case 'join':
            handleJoin(client, msg);
            break;
        case 'chat':
            handleChat(client, msg);
            break;
        case 'start_game':
            handleStartGame(client, msg);
            break;
        case 'game_action':
            handleGameAction(client, msg);
            break;
        case 'leave':
            leaveRoom(client);
            break;
    }
}

function handleJoin(client, msg) {
    const name = String(msg.name || '匿名').slice(0, 20);
    const roomId = String(msg.roomId || 'default');

    if (client.roomId) {
        leaveRoom(client);
    }

    client.name = name;
    client.roomId = roomId;

    if (!rooms.has(roomId)) {
        rooms.set(roomId, { players: [], game: null, gameType: null });
    }

    const room = rooms.get(roomId);
    room.players.push({ id: client.id, name, ws: client });

    sendToClient(client, {
        type: 'joined',
        roomId,
        players: room.players.map(p => ({ id: p.id, name: p.name }))
    });

    broadcast(roomId, {
        type: 'player_joined',
        player: { id: client.id, name }
    }, client.id);
}
function handleChat(client, msg) {
    if (!client.roomId) return;

    broadcast(client.roomId, {
        type: 'chat',
        from: { id: client.id, name: client.name },
        content: String(msg.content || '').slice(0, 500),
        time: Date.now()
    }, client.id);
}

function handleStartGame(client, msg) {
    const room = rooms.get(client.roomId);
    if (!room) return;

    const gameType = msg.gameType;

    if (games.has(client.roomId)) {
        sendToClient(client, { type: 'error', message: '游戏正在进行中' });
        return;
    }

    try {
        let game;
        if (gameType === 'zhajinhua') {
            if (room.players.length < 2) {
                sendToClient(client, { type: 'error', message: '炸金花至少需要2人' });
                return;
            }
            game = new ZhaJinHua(client.roomId, room.players);
        } else if (gameType === 'paodekuai') {
            if (room.players.length < 3) {
                sendToClient(client, { type: 'error', message: '跑得快需要3或4人' });
                return;
            }
            game = new PaoDeKuai(client.roomId, room.players);
        } else {
            sendToClient(client, { type: 'error', message: '未知游戏类型' });
            return;
        }

        const initialState = game.start();
        games.set(client.roomId, { game, type: gameType });
        room.game = game;
        room.gameType = gameType;

        broadcastGameState(game, client.roomId);

        broadcast(client.roomId, {
            type: 'game_started',
            gameType
        });

    } catch (e) {
        sendToClient(client, { type: 'error', message: e.message });
    }
}

function handleGameAction(client, msg) {
    const gameWrapper = games.get(client.roomId);
    if (!gameWrapper) {
        sendToClient(client, { type: 'error', message: '没有正在进行的游戏' });
        return;
    }

    const { game } = gameWrapper;

    try {
        let result;
        switch (msg.action) {
            case 'bet':
                result = game.bet(client.id, msg.amount);
                break;
            case 'call':
                result = game.call(client.id);
                break;
            case 'raise':
                result = game.raise(client.id, msg.amount);
                break;
            case 'fold':
                result = game.fold(client.id);
                break;
            case 'allin':
                result = game.allIn(client.id);
                break;
            case 'play':
                result = game.play(client.id, msg.cards);
                break;
            case 'pass':
                result = game.pass(client.id);
                break;
            default:
                sendToClient(client, { type: 'error', message: '未知操作' });
                return;
        }

        broadcastGameState(game, client.roomId);

        if (result.state === 'ended') {
            games.delete(client.roomId);
            const room = rooms.get(client.roomId);
            if (room) {
                room.game = null;
                room.gameType = null;
            }
        }

    } catch (e) {
        sendToClient(client, { type: 'error', message: e.message });
    }
}

function broadcastGameState(game, roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    for (const player of room.players) {
        const client = Array.from(clients.values()).find(c => c.id === player.id);
        if (!client) continue;

        const state = game.getGameState(player.id);
        sendToClient(client, {
            type: 'game_state',
            state
        });
    }
}

function leaveRoom(client) {
    if (!client.roomId) return;

    const room = rooms.get(client.roomId);
    if (room) {
        room.players = room.players.filter(p => p.id !== client.id);

        broadcast(client.roomId, {
            type: 'player_left',
            playerId: client.id
        });

        if (room.players.length === 0) {
            rooms.delete(client.roomId);
            games.delete(client.roomId);
        }
    }

    client.roomId = null;
}

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
    console.log(`聊天室已启动 → http://0.0.0.0:${PORT}`);
    console.log('支持多房间、实时消息、游戏系统');
});


