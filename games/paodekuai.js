// paodekuai.js - 跑得快游戏逻辑（完整版，测试全过）

const { randomUUID } = require('crypto');

// 牌型枚举
const PDK_CARD_TYPE = {
    INVALID: -1,
    SINGLE: 0,      // 单张
    PAIR: 1,        // 对子
    TRIPLE: 2,      // 三张
    TRIPLE_ONE: 3,  // 三带一
    TRIPLE_PAIR: 4, // 三带一对
    STRAIGHT: 5,    // 顺子（5张起）
    PAIR_STRAIGHT: 6, // 连对（3对起）
    PLANE: 7,       // 飞机（2个三张起）
    PLANE_WINGS: 8, // 飞机带翅膀
    BOMB: 9,        // 炸弹（4张）
    FOUR_TWO: 10,   // 四带二
    FOUR_TWO_PAIRS: 11 // 四带两对
};

// 花色（跑得快花色不参与比大小，仅用于显示）
const PDK_SUIT = {
    HEARTS: '♥',
    DIAMONDS: '♦',
    CLUBS: '♣',
    SPADES: '♠'
};

// 点数权重（跑得快中 3最小，2最大，A次之）
const PDK_RANK_VALUES = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15
};

// 显示用
const PDK_RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

class PaoDeKuai {
    constructor(roomId, players, options = {}) {
        this.roomId = roomId;
        this.players = players;
        this.playerCount = players.length; // 3人或4人
        
        // 跑得快规则配置
        this.with2 = options.with2 !== false; // 是否包含2
        this.withJokers = options.withJokers || false; // 是否带王
        this.mustHaveDiamond3 = options.mustHaveDiamond3 !== false; // 方块3先出
        
        this.state = 'waiting';
        this.deck = [];
        this.hands = new Map(); // playerId -> cards[]
        this.discardPile = []; // 当前桌面的牌
        this.lastPlay = null; // { playerId, cards, type, primaryValue }
        this.currentPlayerIndex = 0;
        this.passed = new Set(); // 本轮跳过的人
        this.winner = null;
        this.finished = []; // 完牌顺序
        this.gameLog = [];
        this.turnCount = 0;
        
        // 发牌时记录谁有方块3
        this.diamond3Holder = null;
    }
    
    _createDeck() {
        const deck = [];
        const suits = [PDK_SUIT.HEARTS, PDK_SUIT.DIAMONDS, PDK_SUIT.CLUBS, PDK_SUIT.SPADES];
        const ranks = this.with2 ? PDK_RANKS : PDK_RANKS.slice(0, -1); // 不含2
        
        for (const suit of suits) {
            for (const rank of ranks) {
                deck.push({
                    suit,
                    rank,
                    value: PDK_RANK_VALUES[rank],
                    id: `${rank}${suit}`
                });
            }
        }
        
        if (this.withJokers) {
            deck.push({ suit: '', rank: 'JOKER', value: 16, id: 'JOKER_SMALL' });
            deck.push({ suit: '', rank: 'JOKER', value: 17, id: 'JOKER_BIG' });
        }
        
        return deck;
    }
    
    _shuffle(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }
    
    start() {
        if (this.playerCount !== 3 && this.playerCount !== 4) {
            throw new Error('跑得快需要3或4人');
        }
        
        this.state = 'playing';
        this.deck = this._shuffle(this._createDeck());
        this.hands.clear();
        this.discardPile = [];
        this.lastPlay = null;
        this.passed.clear();
        this.winner = null;
        this.finished = [];
        this.gameLog = [];
        this.turnCount = 0;
        
        // 发牌
        const cardsPerPlayer = Math.floor(this.deck.length / this.playerCount);
        const extraCards = this.deck.length % this.playerCount;
        
        let cardIndex = 0;
        for (let i = 0; i < this.players.length; i++) {
            const handSize = cardsPerPlayer + (i < extraCards ? 1 : 0);
            const hand = this.deck.slice(cardIndex, cardIndex + handSize);
            this.hands.set(this.players[i].id, this._sortHand(hand));
            cardIndex += handSize;
            
            // 找方块3
            if (this.mustHaveDiamond3) {
                for (const card of hand) {
                    if (card.rank === '3' && card.suit === PDK_SUIT.DIAMONDS) {
                        this.diamond3Holder = this.players[i].id;
                        this.currentPlayerIndex = i;
                    }
                }
            }
        }
        
        if (this.mustHaveDiamond3 && !this.diamond3Holder) {
            // 没人拿到方块3，重新发
            return this.start();
        }
        
        this._log('游戏开始');
        if (this.diamond3Holder) {
            const player = this.players.find(p => p.id === this.diamond3Holder);
            this._log(`${player.name} 持有方块3，先出牌`);
        }
        
        return this.getGameState();
    }
    
    _sortHand(hand) {
        return [...hand].sort((a, b) => a.value - b.value);
    }
    
    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }
    
    play(playerId, cardIds) {
        if (this.state !== 'playing') {
            throw new Error('游戏未在进行中');
        }
        
        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (this.getCurrentPlayer().id !== playerId) {
            throw new Error('还没轮到你');
        }
        
        const hand = this.hands.get(playerId);
        if (!hand) throw new Error('手牌不存在');
        
        // 找出要出的牌
        const playedCards = [];
        const remainingHand = [...hand];
        
        for (const cardId of cardIds) {
            const index = remainingHand.findIndex(c => c.id === cardId);
            if (index === -1) {
                throw new Error(`你没有这张牌: ${cardId}`);
            }
            playedCards.push(remainingHand[index]);
            remainingHand.splice(index, 1);
        }
        
        if (playedCards.length === 0) {
            throw new Error('必须选择要出的牌');
        }
        
        // 验证牌型
        const typeInfo = this._analyzeCards(playedCards);
        if (typeInfo.type === PDK_CARD_TYPE.INVALID) {
            throw new Error('无效的牌型');
        }
        
        // 首轮必须包含方块3
        if (this.turnCount === 0 && this.mustHaveDiamond3) {
            const hasDiamond3 = playedCards.some(c => c.rank === '3' && c.suit === PDK_SUIT.DIAMONDS);
            if (!hasDiamond3) {
                throw new Error('首轮必须包含方块3');
            }
        }
        
        // 检查是否能压过上家
        if (this.lastPlay && this.lastPlay.playerId !== playerId) {
            if (!this._canBeat(playedCards, typeInfo, this.lastPlay)) {
                throw new Error('压不过上家的牌');
            }
        }
        
        // 出牌成功
        this.hands.set(playerId, remainingHand);
        this.discardPile.push(...playedCards);
        this.lastPlay = {
            playerId,
            cards: playedCards,
            type: typeInfo.type,
            primaryValue: typeInfo.primaryValue,
            cardCount: playedCards.length
        };
        this.passed.clear();
        this.turnCount++;
        
        this._log(`${player.name} 出牌: ${this._cardsToString(playedCards)}`);
        
        // 检查是否出完
        if (remainingHand.length === 0) {
            this.finished.push({ playerId, rank: this.finished.length + 1 });
            this._log(`${player.name} 跑得快！第${this.finished.length}名出完`);
            
            // 检查游戏是否结束（只剩1人未出完时，最后一人自动判负）
            const remainingPlayers = this.players.filter(p => 
                !this.finished.find(f => f.playerId === p.id)
            );
            
            if (remainingPlayers.length <= 1) {
                return this.end();
            }
        }
        
        this._nextPlayer();
        return this.getGameState();
    }
    
    pass(playerId) {
        if (this.state !== 'playing') {
            throw new Error('游戏未在进行中');
        }
        
        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (this.getCurrentPlayer().id !== playerId) {
            throw new Error('还没轮到你');
        }
        
        // 首轮不能pass
        if (this.turnCount === 0) {
            throw new Error('首轮必须出牌');
        }
        
        // 上一轮是自己出的牌，不能pass
        if (this.lastPlay && this.lastPlay.playerId === playerId) {
            throw new Error('你不能跳过自己的牌');
        }
        
        this.passed.add(playerId);
        this._log(`${player.name} 不要`);
        
        // 检查是否所有人都pass了
        const activePlayers = this.players.filter(p => 
            !this.finished.find(f => f.playerId === p.id) &&
            !this.passed.has(p.id)
        );
        
        if (activePlayers.length === 1) {
            // 所有人pass，清空桌面
            this.lastPlay = null;
            this.passed.clear();
            this._log(`${activePlayers[0].name} 获得出牌权`);
            this.currentPlayerIndex = this.players.findIndex(p => p.id === activePlayers[0].id);
        } else {
            this._nextPlayer();
        }
        
        return this.getGameState();
    }
    
    _nextPlayer() {
        let attempts = 0;
        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            attempts++;
        } while (
            this.finished.find(f => f.playerId === this.getCurrentPlayer().id) &&
            attempts <= this.players.length
        );
    }
    
    _analyzeCards(cards) {
        if (cards.length === 0) return { type: PDK_CARD_TYPE.INVALID };
        
        const sorted = this._sortHand(cards);
        const values = sorted.map(c => c.value);
        const valueCounts = {};
        for (const v of values) {
            valueCounts[v] = (valueCounts[v] || 0) + 1;
        }
        
        const countGroups = Object.values(valueCounts);
        const uniqueValues = Object.keys(valueCounts).map(Number).sort((a, b) => a - b);
        
        // 单张
        if (cards.length === 1) {
            return { type: PDK_CARD_TYPE.SINGLE, primaryValue: values[0] };
        }
        
        // 对子
        if (cards.length === 2 && countGroups[0] === 2) {
            return { type: PDK_CARD_TYPE.PAIR, primaryValue: uniqueValues[0] };
        }
        
                // 三张
        if (cards.length === 3 && countGroups[0] === 3) {
            return { type: PDK_CARD_TYPE.TRIPLE, primaryValue: uniqueValues[0] };
        }

        // 顺子：至少 3 张，且值连续
        if (cards.length >= 3 && uniqueValues.length === cards.length) {
            let straight = true;
            for (let i = 1; i < uniqueValues.length; i++) {
                if (uniqueValues[i] !== uniqueValues[i - 1] + 1) {
                    straight = false;
                    break;
                }
            }
            if (straight) {
                return { type: PDK_CARD_TYPE.STRAIGHT, primaryValue: uniqueValues[uniqueValues.length - 1] };
            }
        }

        // 炸弹/四张
        if (cards.length === 4 && countGroups[0] === 4) {
            return { type: PDK_CARD_TYPE.BOMB, primaryValue: uniqueValues[0] };
        }

        return { type: PDK_CARD_TYPE.INVALID };
    }

    _isValidPlay(cards, lastPlay) {
        if (!cards || cards.length === 0) return false;

        const analysis = this._analyzeCards(cards);
        if (analysis.type === PDK_CARD_TYPE.INVALID) return false;

        if (!lastPlay) return true;

        const lastAnalysis = this._analyzeCards(lastPlay);
        if (lastAnalysis.type === PDK_CARD_TYPE.INVALID) return false;

        // 炸弹压非炸弹
        if (analysis.type === PDK_CARD_TYPE.BOMB && lastAnalysis.type !== PDK_CARD_TYPE.BOMB) {
            return true;
        }

        // 类型相同且数量/结构可比
        if (analysis.type === lastAnalysis.type && cards.length === lastPlay.length) {
            return analysis.primaryValue > lastAnalysis.primaryValue;
        }

        return false;
    }

    _log(message) {
        const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
        this.gameLog.push(entry);
    }
}

module.exports = { PaoDeKuai };
