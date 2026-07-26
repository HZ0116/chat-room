// paodekuai.js - 跑得快游戏逻辑（支持2-4人）

const { randomUUID } = require('crypto');

const PDK_CARD_TYPE = {
    INVALID: -1,
    SINGLE: 0,
    PAIR: 1,
    TRIPLE: 2,
    TRIPLE_ONE: 3,
    TRIPLE_PAIR: 4,
    STRAIGHT: 5,
    PAIR_STRAIGHT: 6,
    PLANE: 7,
    PLANE_WINGS: 8,
    BOMB: 9,
    FOUR_TWO: 10,
    FOUR_TWO_PAIRS: 11
};

const PDK_SUIT = {
    HEARTS: '♥',
    DIAMONDS: '♦',
    CLUBS: '♣',
    SPADES: '♠'
};

const PDK_RANK_VALUES = {
    '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15
};

const PDK_RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

class PaoDeKuai {
    constructor(roomId, players, options = {}) {
        this.roomId = roomId;
        this.players = players;
        this.playerCount = players.length;

        this.with2 = options.with2 !== false;
        this.withJokers = options.withJokers || false;
        this.mustHaveDiamond3 = options.mustHaveDiamond3 !== false;

        this.state = 'waiting';
        this.deck = [];
        this.hands = new Map();
        this.discardPile = [];
        this.lastPlay = null;
        this.currentPlayerIndex = 0;
        this.passed = new Set();
        this.winner = null;
        this.finished = [];
        this.gameLog = [];
        this.turnCount = 0;
        this.diamond3Holder = null;
    }

    _createDeck() {
        const deck = [];
        const suits = [PDK_SUIT.HEARTS, PDK_SUIT.DIAMONDS, PDK_SUIT.CLUBS, PDK_SUIT.SPADES];
        const ranks = this.with2 ? PDK_RANKS : PDK_RANKS.slice(0, -1);

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
        if (this.playerCount < 2 || this.playerCount > 4) {
            throw new Error('跑得快需要2-4人');
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
        this.diamond3Holder = null;

        let deckForDeal = [...this.deck];

        // 2人局：随机去掉4张牌
        if (this.playerCount === 2) {
            this._shuffle(deckForDeal);
            deckForDeal = deckForDeal.slice(0, deckForDeal.length - 4);
            this._log('2人局，随机去掉4张牌');
        }

        // 发牌
        const cardsPerPlayer = Math.floor(deckForDeal.length / this.playerCount);
        const extraCards = deckForDeal.length % this.playerCount;

        let cardIndex = 0;
        for (let i = 0; i < this.players.length; i++) {
            const handSize = cardsPerPlayer + (i < extraCards ? 1 : 0);
            const hand = deckForDeal.slice(cardIndex, cardIndex + handSize);
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

        // 没人拿到方块3，重新发
        if (this.mustHaveDiamond3 && !this.diamond3Holder) {
            if (this.playerCount === 2) {
                // 2人局随机指定先手
                this.currentPlayerIndex = Math.floor(Math.random() * 2);
                this._log('未找到方块3，随机指定先手');
            } else {
                return this.start();
            }
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

        const typeInfo = this._analyzeCards(playedCards);
        if (typeInfo.type === PDK_CARD_TYPE.INVALID) {
            throw new Error('无效的牌型');
        }

        if (this.turnCount === 0 && this.mustHaveDiamond3) {
            const hasDiamond3 = playedCards.some(c => c.rank === '3' && c.suit === PDK_SUIT.DIAMONDS);
            if (!hasDiamond3) {
                throw new Error('首轮必须包含方块3');
            }
        }

        if (this.lastPlay && this.lastPlay.playerId !== playerId) {
            if (!this._canBeat(playedCards, typeInfo, this.lastPlay)) {
                throw new Error('压不过上家的牌');
            }
        }

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

        if (remainingHand.length === 0) {
            this.finished.push({ playerId, rank: this.finished.length + 1 });
            this._log(`${player.name} 跑得快！第${this.finished.length}名出完`);

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

        if (this.turnCount === 0) {
            throw new Error('首轮必须出牌');
        }

        if (this.lastPlay && this.lastPlay.playerId === playerId) {
            throw new Error('你不能跳过自己的牌');
        }

        this.passed.add(playerId);
        this._log(`${player.name} 不要`);

        const activePlayers = this.players.filter(p =>
            !this.finished.find(f => f.playerId === p.id) &&
            !this.passed.has(p.id)
        );

        if (activePlayers.length === 1) {
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

        if (cards.length === 1) {
            return { type: PDK_CARD_TYPE.SINGLE, primaryValue: values[0] };
        }

        if (cards.length === 2 && countGroups[0] === 2) {
            return { type: PDK_CARD_TYPE.PAIR, primaryValue: uniqueValues[0] };
        }

        if (cards.length === 3 && countGroups[0] === 3) {
            return { type: PDK_CARD_TYPE.TRIPLE, primaryValue: uniqueValues[0] };
        }

        if (cards.length >= 5 && this._isStraight(uniqueValues) && !uniqueValues.includes(15)) {
            return { type: PDK_CARD_TYPE.STRAIGHT, primaryValue: uniqueValues[uniqueValues.length - 1] };
        }

        if (cards.length >= 6 && cards.length % 2 === 0) {
            const pairVals = Object.keys(valueCounts).filter(k => valueCounts[k] === 2).map(Number).sort((a, b) => a - 
        // 连对
        if (cards.length >= 6 && cards.length % 2 === 0) {
            const pairVals = Object.keys(valueCounts).filter(k => valueCounts[k] === 2).map(Number).sort((a, b) => a - b);
            if (pairVals.length === cards.length / 2 && this._isConsecutive(pairVals) && !pairVals.includes(15)) {
                return { type: PDK_CARD_TYPE.PAIR_STRAIGHT, primaryValue: pairVals[pairVals.length - 1] };
            }
        }

        // 炸弹
        if (cards.length === 4 && countGroups[0] === 4) {
            return { type: PDK_CARD_TYPE.BOMB, primaryValue: uniqueValues[0] };
        }

        // 三带一
        if (cards.length === 4 && countGroups.includes(3) && countGroups.includes(1)) {
            const triple = Object.keys(valueCounts).find(k => valueCounts[k] === 3);
            return { type: PDK_CARD_TYPE.TRIPLE_ONE, primaryValue: parseInt(triple) };
        }

        // 三带一对
        if (cards.length === 5 && countGroups.includes(3) && countGroups.includes(2)) {
            const triple = Object.keys(valueCounts).find(k => valueCounts[k] === 3);
            return { type: PDK_CARD_TYPE.TRIPLE_PAIR, primaryValue: parseInt(triple) };
        }

        // 飞机
        const triples = uniqueValues.filter(v => valueCounts[v] === 3);
        if (triples.length >= 2 && this._isConsecutive(triples)) {
            return { type: PDK_CARD_TYPE.PLANE, primaryValue: Math.max(...triples) };
        }

        // 四带二
        if (cards.length === 6 && countGroups.includes(4) && countGroups.filter(c => c === 1).length === 2) {
            const quad = Object.keys(valueCounts).find(k => valueCounts[k] === 4);
            return { type: PDK_CARD_TYPE.FOUR_TWO, primaryValue: parseInt(quad) };
        }

        // 四带两对
        if (cards.length === 8 && countGroups.includes(4) && countGroups.filter(c => c === 2).length === 2) {
            const quad = Object.keys(valueCounts).find(k => valueCounts[k] === 4);
            return { type: PDK_CARD_TYPE.FOUR_TWO_PAIRS, primaryValue: parseInt(quad) };
        }

        return { type: PDK_CARD_TYPE.INVALID };
    }

    _isStraight(values) {
        if (values.length < 5) return false;
        const unique = [...new Set(values)].sort((a, b) => a - b);
        if (unique.length !== values.length) return false;
        for (let i = 1; i < unique.length; i++) {
            if (unique[i] - unique[i - 1] !== 1) return false;
        }
        return true;
    }

    _isConsecutive(values) {
        const sorted = [...values].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] - sorted[i - 1] !== 1) return false;
        }
        return true;
    }

    _canBeat(cards, typeInfo, lastPlay) {
        if (typeInfo.type === PDK_CARD_TYPE.BOMB && lastPlay.type !== PDK_CARD_TYPE.BOMB) {
            return true;
        }
        if (typeInfo.type === lastPlay.type) {
            if (cards.length !== lastPlay.cards.length) return false;
            return typeInfo.primaryValue > lastPlay.primaryValue;
        }
        return false;
    }

    end() {
        this.state = 'ended';

        const finishedIds = this.finished.map(f => f.playerId);
        const lastPlayer = this.players.find(p => !finishedIds.includes(p.id));
        if (lastPlayer) {
            this.finished.push({ playerId: lastPlayer.id, rank: this.players.length });
        }

        this._log('游戏结束');
        this._log(`排名: ${this.finished.map(f => {
            const p = this.players.find(p => p.id === f.playerId);
            return `${f.rank}.${p.name}`;
        }).join(', ')}`);

        return this.getGameState();
    }

    getGameState(forPlayerId = null) {
        const baseState = {
            roomId: this.roomId,
            state: this.state,
            currentPlayerId: this.state === 'playing' ? this.getCurrentPlayer()?.id : null,
            lastPlay: this.lastPlay ? {
                playerId: this.lastPlay.playerId,
                cards: this.lastPlay.cards,
                type: this.lastPlay.type
            } : null,
            finished: this.finished,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: this.hands.get(p.id)?.length || 0,
                finished: !!this.finished.find(f => f.playerId === p.id)
            })),
            log: this.gameLog.slice(-15)
        };

        if (forPlayerId) {
            baseState.hand = this.hands.get(forPlayerId) || [];
            baseState.canAct = this.state === 'playing' &&
                this.getCurrentPlayer()?.id === forPlayerId;
            baseState.canPass = this.state === 'playing' &&
                this.getCurrentPlayer()?.id === forPlayerId &&
                this.turnCount > 0 &&
                this.lastPlay &&
                this.lastPlay.playerId !== forPlayerId;
        }

        return baseState;
    }

    _cardsToString(cards) {
        return cards.map(c => c.rank + c.suit).join('');
    }

    _log(message) {
        const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
        this.gameLog.push(entry);
    }
}

module.exports = { PaoDeKuai, PDK_CARD_TYPE, PDK_SUIT, PDK_RANK_VALUES };

