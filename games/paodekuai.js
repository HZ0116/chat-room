// games/paodekuai.js - 跑得快游戏逻辑（完整修复版）
class PaoDeKuai {
    constructor(roomId, players) {
        this.roomId = roomId;
        this.players = players.map(p => ({
            id: p.id,
            name: p.name,
            hand: [],
            finished: false,
            isCurrent: false,
            isDealer: false,
            passCount: 0
        }));
        this.state = {
            phase: 'waiting',
            deck: [],
            currentPlayer: null,
            lastPlay: null,
            lastPlayer: null,
            players: this.players,
            winner: null,
            turnCount: 0,
            passCount: 0
        };
        this.dealerIndex = 0;
        this.started = false;
        this.playCount = 0;
        this.cardsPerPlayer = 16;
    }

    start() {
        if (this.started) throw new Error('游戏已开始');
        if (this.players.length < 3 || this.players.length > 4) {
            throw new Error('跑得快需要3或4名玩家');
        }

        this.started = true;
        this.state.phase = 'playing';
        this.playCount = 0;
        this.state.passCount = 0;
        this.state.lastPlay = null;
        this.state.lastPlayer = null;
        this.state.winner = null;
        this.state.turnCount = 0;

        this.players.forEach(p => {
            p.hand = [];
            p.finished = false;
            p.isCurrent = false;
            p.isDealer = false;
            p.passCount = 0;
        });

        this.shuffleDeck();

        const totalCards = this.players.length === 3 ? 51 : 52;
        this.cardsPerPlayer = Math.floor(totalCards / this.players.length);
        const extraCards = totalCards % this.players.length;

        for (let i = 0; i < this.cardsPerPlayer; i++) {
            for (const player of this.players) {
                if (this.state.deck.length > 0) {
                    player.hand.push(this.state.deck.pop());
                }
            }
        }

        for (let i = 0; i < extraCards; i++) {
            const idx = (this.dealerIndex + i) % this.players.length;
            if (this.state.deck.length > 0) {
                this.players[idx].hand.push(this.state.deck.pop());
            }
        }

        let firstPlayer = null;
        for (const player of this.players) {
            const hasSpade3 = player.hand.some(c => c.suit === '♠' && c.rank === '3');
            if (hasSpade3) {
                firstPlayer = player;
                break;
            }
        }

        if (!firstPlayer) {
            firstPlayer = this.players[0];
        }

        this.state.currentPlayer = firstPlayer.id;
        firstPlayer.isCurrent = true;
        this.state.lastAction = `${firstPlayer.name} 先出牌（黑桃3）`;

        this.players.forEach(p => this.sortHand(p.hand));

        this.state.players = this.players;
        return this.getState();
    }

    shuffleDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
        this.state.deck = [];
        for (const suit of suits) {
            for (const rank of ranks) {
                this.state.deck.push({ suit, rank });
            }
        }
        for (let i = this.state.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.state.deck[i], this.state.deck[j]] = [this.state.deck[j], this.state.deck[i]];
        }
    }

    sortHand(hand) {
        const rankOrder = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15 };
        const suitOrder = { '♠': 4, '♥': 3, '♦': 2, '♣': 1 };
        hand.sort((a, b) => {
            if (rankOrder[a.rank] !== rankOrder[b.rank]) {
                return rankOrder[a.rank] - rankOrder[b.rank];
            }
            return suitOrder[a.suit] - suitOrder[b.suit];
        });
    }

    getPlayerCards(playerId) {
        const player = this.players.find(p => p.id === playerId);
        return player ? player.hand : [];
    }

    getPlayerInfo(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return null;
        return {
            id: player.id,
            name: player.name,
            handCount: player.hand.length,
            finished: player.finished,
            isCurrent: player.isCurrent
        };
    }

    getState() {
        const state = {
            phase: this.state.phase,
            currentPlayer: this.state.currentPlayer,
            lastPlay: this.state.lastPlay,
            lastPlayer: this.state.lastPlayer,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                handCount: p.hand.length,
                finished: p.finished,
                isCurrent: p.isCurrent,
                isDealer: p.isDealer
            })),
            winner: this.state.winner,
            turnCount: this.state.turnCount
        };
        return state;
    }

    play(playerId, cards) {
        if (this.state.phase === 'ended') throw new Error('游戏已结束');
        if (this.state.currentPlayer !== playerId) throw new Error('不是你的回合');

        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (player.finished) throw new Error('玩家已出完牌');

        const cardKeys = cards.map(c => `${c.suit}${c.rank}`);
        const handKeys = player.hand.map(c => `${c.suit}${c.rank}`);
        const allInHand = cardKeys.every(key => handKeys.includes(key));
        if (!allInHand) throw new Error('牌不在手牌中');

        if (!this.isValidPlay(cards)) {
            throw new Error('无效的牌型');
        }

        if (this.state.lastPlay && this.state.lastPlayer !== playerId) {
            if (!this.isGreater(cards, this.state.lastPlay)) {
                throw new Error('必须出更大的牌');
            }
        }

        for (const card of cards) {
            const index = player.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
            if (index !== -1) {
                player.hand.splice(index, 1);
            }
        }

        this.state.lastPlay = cards;
        this.state.lastPlayer = playerId;
        this.state.passCount = 0;
        this.playCount++;

        const cardStr = cards.map(c => c.rank + c.suit).join(' ');
        this.state.lastAction = `${player.name} 出了 ${cardStr}`;

        if (player.hand.length === 0) {
            player.finished = true;
            this.state.winner = player.id;
            this.state.phase = 'ended';
            this.state.lastAction = `🏆 ${player.name} 出完了所有牌！`;
            this.started = false;
            this.players.forEach(p => p.isCurrent = false);
            return this.getState();
        }

        this.nextTurn(playerId);
        return this.getState();
    }

    pass(playerId) {
        if (this.state.phase === 'ended') throw new Error('游戏已结束');
        if (this.state.currentPlayer !== playerId) throw new Error('不是你的回合');

        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (player.finished) throw new Error('玩家已出完牌');

        if (this.playCount === 0) {
            throw new Error('必须出牌');
        }

        if (this.state.lastPlayer === playerId) {
            throw new Error('不能连续过牌');
        }

        this.state.passCount++;
        this.state.lastAction = `${player.name} 过`;
        this.state.lastPlay = null;

        const activePlayers = this.players.filter(p => !p.finished);
        if (this.state.passCount >= activePlayers.length - 1) {
            this.state.passCount = 0;
            this.state.lastPlay = null;
            const lastPlayer = this.players.find(p => p.id === this.state.lastPlayer);
            if (lastPlayer) {
                this.state.currentPlayer = lastPlayer.id;
                this.players.forEach(p => p.isCurrent = p.id === this.state.currentPlayer);
                this.state.lastAction = `${lastPlayer.name} 重新出牌`;
                return this.getState();
            }
        }

        this.nextTurn(playerId);
        return this.getState();
    }

    nextTurn(currentId) {
        const activePlayers = this.players.filter(p => !p.finished);
        if (activePlayers.length <= 1) {
            this.state.phase = 'ended';
            if (activePlayers.length === 1) {
                this.state.winner = activePlayers[0].id;
                this.state.lastAction = `🏆 ${activePlayers[0].name} 获胜！`;
            }
            this.started = false;
            this.players.forEach(p => p.isCurrent = false);
            return;
        }

        let currentIndex = this.players.findIndex(p => p.id === currentId);
        let nextIndex = (currentIndex + 1) % this.players.length;
        let attempts = 0;
        while (attempts < this.players.length) {
            const candidate = this.players[nextIndex];
            if (!candidate.finished) {
                this.state.currentPlayer = candidate.id;
                this.players.forEach(p => p.isCurrent = p.id === this.state.currentPlayer);
                this.state.turnCount++;
                return;
            }
            nextIndex = (nextIndex + 1) % this.players.length;
            attempts++;
        }

        this.state.phase = 'ended';
        this.started = false;
        this.players.forEach(p => p.isCurrent = false);
    }

    isValidPlay(cards) {
        if (!cards || cards.length === 0) return false;
        if (cards.length > 12) return false;

        if (cards.length === 1) return true;

        if (cards.length === 2) {
            return cards[0].rank === cards[1].rank;
        }

        if (cards.length === 3) {
            return cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank;
        }

        if (cards.length === 4) {
            const rankCount = {};
            cards.forEach(c => { rankCount[c.rank] = (rankCount[c.rank] || 0) + 1; });
            const counts 