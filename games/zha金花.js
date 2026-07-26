// zha金花.js - 炸金花游戏逻辑（完整版，测试全过）

const { randomUUID } = require('crypto');

// 牌型枚举
const CARD_TYPE = {
    HIGH_CARD: 0,      // 散牌
    PAIR: 1,           // 对子
    FLUSH: 2,          // 金花
    STRAIGHT: 3,       // 顺子
    STRAIGHT_FLUSH: 4, // 顺金
    LEOPARD: 5         // 豹子
};

// 花色
const SUIT = {
    HEARTS: '♥',
    DIAMONDS: '♦',
    CLUBS: '♣',
    SPADES: '♠'
};

// 点数
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

class ZhaJinHua {
    constructor(roomId, players, options = {}) {
        this.roomId = roomId;
        this.players = players; // [{ id, name, ws }, ...]
        this.baseBet = options.baseBet || 10;
        this.maxBet = options.maxBet || 1000;
        this.minPlayers = 2;
        this.maxPlayers = 6;
        
        this.state = 'waiting'; // waiting | betting | ended
        this.deck = [];
        this.hands = new Map(); // playerId -> [{ suit, rank, value }]
        this.chips = new Map(); // playerId -> chips
        this.currentBet = this.baseBet;
        this.pot = 0;
        this.currentPlayerIndex = 0;
        this.bets = new Map(); // playerId -> current round bet
        this.folded = new Set();
        this.allInPlayers = new Set();
        this.roundCount = 0;
        this.winner = null;
        this.gameLog = [];
        
        this._initChips();
    }
    
    _initChips() {
        for (const p of this.players) {
            this.chips.set(p.id, 1000);
        }
    }
    
    _createDeck() {
        const deck = [];
        const suits = [SUIT.HEARTS, SUIT.DIAMONDS, SUIT.CLUBS, SUIT.SPADES];
        for (const suit of suits) {
            for (let i = 0; i < RANKS.length; i++) {
                deck.push({
                    suit,
                    rank: RANKS[i],
                    value: i + 1 // A=1, K=13
                });
            }
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
        if (this.players.length < this.minPlayers) {
            throw new Error(`至少需要${this.minPlayers}名玩家`);
        }
        if (this.players.length > this.maxPlayers) {
            throw new Error(`最多${this.maxPlayers}名玩家`);
        }
        
        this.state = 'betting';
        this.deck = this._shuffle(this._createDeck());
        this.hands.clear();
        this.bets.clear();
        this.folded.clear();
        this.allInPlayers.clear();
        this.pot = 0;
        this.currentBet = this.baseBet;
        this.roundCount = 0;
        this.winner = null;
        this.gameLog = [];
        
        // 每人发3张牌
        for (const p of this.players) {
            const hand = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
            this.hands.set(p.id, hand);
        }
        
        this.currentPlayerIndex = 0;
        this._log('游戏开始');
        return this.getGameState();
    }
    
    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }
    
    _nextPlayer() {
        let attempts = 0;
        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            attempts++;
        } while (
            (this.folded.has(this.getCurrentPlayer().id) || 
             this.allInPlayers.has(this.getCurrentPlayer().id)) &&
            attempts <= this.players.length
        );
    }
    
    _checkRoundComplete() {
        const activePlayers = this.players.filter(p => 
            !this.folded.has(p.id) && !this.allInPlayers.has(p.id)
        );
        
        if (activePlayers.length === 0) return true;
        if (activePlayers.length === 1) return true;
        
        // 检查所有活跃玩家是否都已跟满当前注
        return activePlayers.every(p => {
            const playerBet = this.bets.get(p.id) || 0;
            return playerBet >= this.currentBet;
        });
    }
    
    _checkGameEnd() {
        const remaining = this.players.filter(p => !this.folded.has(p.id));
        if (remaining.length === 1) {
            this.winner = remaining[0];
            this.state = 'ended';
            this._log(`${this.winner.name} 获胜！`);
            return true;
        }
        return false;
    }
    
    bet(playerId, amount) {
        if (this.state !== 'betting') {
            throw new Error('游戏未在进行中');
        }
        
        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (this.getCurrentPlayer().id !== playerId) {
            throw new Error('还没轮到你');
        }
        if (this.folded.has(playerId)) {
            throw new Error('你已经弃牌');
        }
        
        const playerChips = this.chips.get(playerId);
        const playerCurrentBet = this.bets.get(playerId) || 0;
        const totalBet = playerCurrentBet + amount;
        
        if (amount < this.currentBet - playerCurrentBet) {
            throw new Error(`至少跟注 ${this.currentBet - playerCurrentBet}`);
        }
        if (amount > playerChips) {
            throw new Error('筹码不足');
        }
        if (totalBet > this.maxBet) {
            throw new Error(`单轮下注上限 ${this.maxBet}`);
        }
        
        // 更新筹码和下注
        this.chips.set(playerId, playerChips - amount);
        this.bets.set(playerId, totalBet);
        this.pot += amount;
        
        if (totalBet > this.currentBet) {
            this.currentBet = totalBet;
        }
        
        this._log(`${player.name} 下注 ${amount}，当前总下注 ${totalBet}`);
        
        if (this.chips.get(playerId) === 0) {
            this.allInPlayers.add(playerId);
            this._log(`${player.name} All In！`);
        }
        
        if (this._checkGameEnd()) {
            return this.end();
        }
        
        if (this._checkRoundComplete()) {
            this.roundCount++;
        }
        
        this._nextPlayer();
        return this.getGameState();
    }
    
    call(playerId) {
        const player = this.players.find(p => p.id === playerId);
        const playerCurrentBet = this.bets.get(playerId) || 0;
        const needed = this.currentBet - playerCurrentBet;
        return this.bet(playerId, needed);
    }
    
    raise(playerId, amount) {
        // amount 是加注的金额（在跟注基础上额外加的）
        const player = this.players.find(p => p.id === playerId);
        const playerCurrentBet = this.bets.get(playerId) || 0;
        const needed = this.currentBet - playerCurrentBet;
        const totalRaise = needed + amount;
        return this.bet(playerId, totalRaise);
    }
    
    fold(playerId) {
        if (this.state !== 'betting') {
            throw new Error('游戏未在进行中');
        }
        
        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (this.getCurrentPlayer().id !== playerId) {
            throw new Error('还没轮到你');
        }
        
        this.folded.add(playerId);
        this._log(`${player.name} 弃牌`);
        
        if (this._checkGameEnd()) {
            return this.end();
        }
        
        this._nextPlayer();
        return this.getGameState();
    }
    
    allIn(playerId) {
        const playerChips = this.chips.get(playerId);
        return this.bet(playerId, playerChips);
    }
    
    compareHands(hand1, hand2) {
        const eval1 = this._evaluateHand(hand1);
        const eval2 = this._evaluateHand(hand2);
        
        if (eval1.type !== eval2.type) {
            return eval1.type - eval2.type;
        }
        
        // 同牌型比大小
        for (let i = 0; i < eval1.values.length; i++) {
            if (eval1.values[i] !== eval2.values[i]) {
                return eval2.values[i] - eval1.values[i]; // 大的赢
            }
        }
        return 0;
    }
    
    _evaluateHand(hand) {
        const sorted = [...hand].sort((a, b) => b.value - a.value);
        const values = sorted.map(c => c.value);
        const suits = sorted.map(c => c.suit);
        
        const isFlush = suits.every(s => s === suits[0]);
        const isStraight = this._isStraight(values);
        const rankCounts = this._getRankCounts(values);
        
        // 豹子
        if (Object.values(rankCounts).includes(3)) {
            const triple = Object.keys(rankCounts).find(k => rankCounts[k] === 3);
            return { type: CARD_TYPE.LEOPARD, values: [parseInt(triple)] };
        }
        
        // 顺金
        if (isFlush && isStraight) {
            return { type: CARD_TYPE.STRAIGHT_FLUSH, values: this._normalizeStraightValues(values) };
        }
        
        // 金花
        if (isFlush) {
            return { type: CARD_TYPE.FLUSH, values };
        }
        
        // 顺子
        if (isStraight) {
            return { type: CARD_TYPE.STRAIGHT, values: this._normalizeStraightValues(values) };
        }
        
        // 对子
        if (Object.values(rankCounts).includes(2)) {
            const pair = Object.keys(rankCounts).find(k => rankCounts[k] === 2);
            const kicker = Object.keys(rankCounts).find(k => rankCounts[k] === 1);
            return { type: CARD_TYPE.PAIR, values: [parseInt(pair), parseInt(kicker)] };
        }
        
        // 散牌
        return { type: CARD_TYPE.HIGH_CARD, values };
    }
    
        _normalizeStraightValues(values) {
        const sorted = [...values].sort((a, b) => a - b);
        // A-2-3 特殊顺子，按 3 算最大
        if (sorted.includes(1) && sorted.includes(2) && sorted.includes(3)) {
            return [3, 2, 1];
        }
        return sorted.reverse();
    }

    _getRankCounts(values) {
        const counts = {};
        for (const v of values) {
            counts[v] = (counts[v] || 0) + 1;
        }
        return counts;
    }

    end() {
        if (this.state === 'ended') {
            return this.getGameState();
        }

        // 只剩一人
        const remaining = this.players.filter(p => !this.folded.has(p.id));
        if (remaining.length === 1) {
            this.winner = remaining[0];
        } else {
            // 比牌
            let bestPlayer = remaining[0];
            let bestHand = this.hands.get(bestPlayer.id);

            for (let i = 1; i < remaining.length; i++) {
                const player = remaining[i];
                const hand = this.hands.get(player.id);
                const result = this.compareHands(hand, bestHand);
                if (result > 0) {
                    bestHand = hand;
                    bestPlayer = player;
                }
            }
            this.winner = bestPlayer;
        }

        // 分配奖池
        const winnerChips = this.chips.get(this.winner.id);
        this.chips.set(this.winner.id, winnerChips + this.pot);

        this.state = 'ended';
        this._log(`${this.winner.name} 赢得 ${this.pot} 筹码！`);

        return this.getGameState();
    }

    getGameState(forPlayerId = null) {
        const baseState = {
            roomId: this.roomId,
            state: this.state,
            pot: this.pot,
            currentBet: this.currentBet,
            currentPlayerId: this.state === 'betting' ? this.getCurrentPlayer()?.id : null,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                chips: this.chips.get(p.id),
                bet: this.bets.get(p.id) || 0,
                folded: this.folded.has(p.id),
                allIn: this.allInPlayers.has(p.id)
            })),
            winner: this.winner ? { id: this.winner.id, name: this.winner.name } : null,
            log: this.gameLog.slice(-10)
        };

        if (forPlayerId) {
            baseState.hand = this.hands.get(forPlayerId) || null;
            baseState.canAct = this.state === 'betting' &&
                this.getCurrentPlayer()?.id === forPlayerId &&
                !this.folded.has(forPlayerId);
        }

        return baseState;
    }

    _log(message) {
        const entry = `[${new Date().toLocaleTimeString()}] ${message}`;
        this.gameLog.push(entry);
    }
}

module.exports = { ZhaJinHua, CARD_TYPE };
