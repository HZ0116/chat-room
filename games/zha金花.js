// games/zha金花.js - 炸金花游戏逻辑（完整版）
class ZhaJinHua {
    constructor(roomId, players) {
        this.roomId = roomId;
        this.players = players.map(p => ({
            id: p.id,
            name: p.name,
            chips: 1000,
            bet: 0,
            folded: false,
            allin: false,
            hand: [],
            isDealer: false,
            isCurrent: false
        }));
        this.state = {
            phase: 'waiting',
            pot: 0,
            currentPlayer: null,
            lastAction: null,
            deck: [],
            communityCards: [],
            players: this.players,
            winner: null,
            handRank: null
        };
        this.currentBet = 0;
        this.minBet = 10;
        this.dealerIndex = 0;
        this.actionIndex = 0;
        this.raiseCount = 0;
        this.maxRaises = 4;
        this.started = false;
    }

    start() {
        if (this.started) throw new Error('游戏已开始');
        if (this.players.length < 2) throw new Error('至少需要2名玩家');

        this.started = true;
        this.state.phase = 'preflop';
        this.state.pot = 0;
        this.currentBet = 0;
        this.raiseCount = 0;

        this.players.forEach(p => {
            p.chips = 1000;
            p.bet = 0;
            p.folded = false;
            p.allin = false;
            p.hand = [];
            p.isDealer = false;
            p.isCurrent = false;
        });

        this.shuffleDeck();
        this.dealCards();
        this.setBlinds();

        this.state.players = this.players;
        this.state.lastAction = '游戏开始';

        return this.getState();
    }

    shuffleDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
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

    dealCards() {
        const activePlayers = this.players.filter(p => !p.folded);
        for (let i = 0; i < 3; i++) {
            for (const player of activePlayers) {
                if (this.state.deck.length === 0) break;
                const card = this.state.deck.pop();
                player.hand.push(card);
            }
        }
    }

    setBlinds() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length < 2) return;
        this.dealerIndex = (this.dealerIndex + 1) % activePlayers.length;
        activePlayers[this.dealerIndex].isDealer = true;

        const sbIndex = (this.dealerIndex + 1) % activePlayers.length;
        const sbPlayer = activePlayers[sbIndex];
        const sbAmount = Math.min(5, sbPlayer.chips);
        sbPlayer.chips -= sbAmount;
        sbPlayer.bet = sbAmount;
        this.state.pot += sbAmount;
        this.currentBet = sbAmount;

        const bbIndex = (this.dealerIndex + 2) % activePlayers.length;
        const bbPlayer = activePlayers[bbIndex];
        const bbAmount = Math.min(10, bbPlayer.chips);
        bbPlayer.chips -= bbAmount;
        bbPlayer.bet = bbAmount;
        this.state.pot += bbAmount;
        this.currentBet = bbAmount;

        this.state.lastAction = `盲注: ${sbPlayer.name} ${sbAmount}, ${bbPlayer.name} ${bbAmount}`;

        this.actionIndex = (bbIndex + 1) % activePlayers.length;
        this.state.currentPlayer = activePlayers[this.actionIndex].id;
        this.players.forEach(p => p.isCurrent = p.id === this.state.currentPlayer);
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
            chips: player.chips,
            bet: player.bet,
            folded: player.folded,
            allin: player.allin
        };
    }

    getState() {
        const state = {
            phase: this.state.phase,
            pot: this.state.pot,
            currentPlayer: this.state.currentPlayer,
            lastAction: this.state.lastAction,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                chips: p.chips,
                bet: p.bet,
                folded: p.folded,
                allin: p.allin,
                isDealer: p.isDealer,
                isCurrent: p.isCurrent,
                showCards: this.state.phase === 'ended' || p.folded
            })),
            communityCards: this.state.communityCards || [],
            winner: this.state.winner,
            handRank: this.state.handRank
        };
        return state;
    }

    bet(playerId, amount) {
        if (this.state.phase === 'ended') throw new Error('游戏已结束');
        if (this.state.currentPlayer !== playerId) throw new Error('不是你的回合');

        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (player.folded) throw new Error('玩家已弃牌');
        if (amount < this.minBet) throw new Error(`下注至少 ${this.minBet}`);

        const actualAmount = Math.min(amount, player.chips);
        if (actualAmount <= 0) throw new Error('筹码不足');

        player.chips -= actualAmount;
        player.bet += actualAmount;
        this.state.pot += actualAmount;
        this.currentBet = Math.max(this.currentBet, actualAmount);
        this.state.lastAction = `${player.name} 下注 ${actualAmount}`;

        this.nextTurn();
        return this.getState();
    }

    call(playerId) {
        if (this.state.phase === 'ended') throw new Error('游戏已结束');
        if (this.state.currentPlayer !== playerId) throw new Error('不是你的回合');

        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (player.folded) throw new Error('玩家已弃牌');

        const callAmount = Math.min(this.currentBet - player.bet, player.chips);
        if (callAmount < 0) throw new Error('无需跟注');

        player.chips -= callAmount;
        player.bet += callAmount;
        this.state.pot += callAmount;
        this.state.lastAction = `${player.name} 跟注 ${callAmount}`;

        this.nextTurn();
        return this.getState();
    }
    raise(playerId, amount) {
        if (this.state.phase === 'ended') throw new Error('游戏已结束');
        if (this.state.currentPlayer !== playerId) throw new Error('不是你的回合');
        if (this.raiseCount >= this.maxRaises) throw new Error('已达到最大加注次数');

        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (player.folded) throw new Error('玩家已弃牌');

        const totalBet = this.currentBet + amount;
        const raiseAmount = Math.min(totalBet - player.bet, player.chips);
        if (raiseAmount <= 0) throw new Error('加注金额无效');

        player.chips -= raiseAmount;
        player.bet += raiseAmount;
        this.state.pot += raiseAmount;
        this.currentBet = player.bet;
        this.raiseCount++;
        this.state.lastAction = `${player.name} 加注 ${raiseAmount}`;

        this.nextTurn();
        return this.getState();
    }

    fold(playerId) {
        if (this.state.phase === 'ended') throw new Error('游戏已结束');
        if (this.state.currentPlayer !== playerId) throw new Error('不是你的回合');

        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (player.folded) throw new Error('玩家已弃牌');

        player.folded = true;
        player.isCurrent = false;
        this.state.lastAction = `${player.name} 弃牌`;

        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length === 1) {
            this.endGame(activePlayers[0]);
            return this.getState();
        }

        this.nextTurn();
        return this.getState();
    }

    allIn(playerId) {
        if (this.state.phase === 'ended') throw new Error('游戏已结束');
        if (this.state.currentPlayer !== playerId) throw new Error('不是你的回合');

        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (player.folded) throw new Error('玩家已弃牌');

        const allAmount = player.chips;
        if (allAmount <= 0) throw new Error('没有筹码');

        player.chips = 0;
        player.bet += allAmount;
        this.state.pot += allAmount;
        player.allin = true;
        this.currentBet = Math.max(this.currentBet, player.bet);
        this.state.lastAction = `${player.name} All-in ${allAmount}`;

        this.nextTurn();
        return this.getState();
    }

    nextTurn() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length === 1) {
            this.endGame(activePlayers[0]);
            return;
        }

        const allActed = activePlayers.every(p =>
            p.allin || p.bet === this.currentBet || p.folded
        );

        if (allActed) {
            this.nextStage();
            return;
        }

        let nextIndex = (this.actionIndex + 1) % this.players.length;
        let attempts = 0;
        while (attempts < this.players.length) {
            const candidate = this.players[nextIndex];
            if (!candidate.folded && !candidate.allin && candidate.bet < this.currentBet) {
                this.actionIndex = nextIndex;
                this.state.currentPlayer = candidate.id;
                this.players.forEach(p => p.isCurrent = p.id === this.state.currentPlayer);
                return;
            }
            nextIndex = (nextIndex + 1) % this.players.length;
            attempts++;
        }

        this.nextStage();
    }
    nextStage() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length === 1) {
            this.endGame(activePlayers[0]);
            return;
        }

        this.players.forEach(p => p.bet = 0);
        this.currentBet = 0;
        this.raiseCount = 0;

        switch (this.state.phase) {
            case 'preflop':
                this.state.phase = 'flop';
                this.flopCards();
                break;
            case 'flop':
                this.state.phase = 'turn';
                this.turnCard();
                break;
            case 'turn':
                this.state.phase = 'river';
                this.riverCard();
                break;
            case 'river':
                this.state.phase = 'showdown';
                this.showdown();
                return;
            default:
                this.state.phase = 'ended';
                return;
        }

        const active = this.players.filter(p => !p.folded);
        let startIndex = (this.dealerIndex + 1) % this.players.length;
        while (startIndex < this.players.length && this.players[startIndex].folded) {
            startIndex = (startIndex + 1) % this.players.length;
        }
        this.actionIndex = startIndex;
        this.state.currentPlayer = this.players[startIndex].id;
        this.players.forEach(p => p.isCurrent = p.id === this.state.currentPlayer);
        this.state.lastAction = `${this.state.phase.toUpperCase()} 阶段开始`;
    }

    flopCards() {
        this.state.communityCards = [];
        this.state.deck.pop();
        for (let i = 0; i < 3; i++) {
            if (this.state.deck.length > 0) {
                this.state.communityCards.push(this.state.deck.pop());
            }
        }
        this.state.lastAction = `翻牌: ${this.state.communityCards.map(c => c.rank + c.suit).join(' ')}`;
    }

    turnCard() {
        this.state.deck.pop();
        if (this.state.deck.length > 0) {
            this.state.communityCards.push(this.state.deck.pop());
        }
        this.state.lastAction = `转牌: ${this.state.communityCards[3].rank}${this.state.communityCards[3].suit}`;
    }

    riverCard() {
        this.state.deck.pop();
        if (this.state.deck.length > 0) {
            this.state.communityCards.push(this.state.deck.pop());
        }
        this.state.lastAction = `河牌: ${this.state.communityCards[4].rank}${this.state.communityCards[4].suit}`;
    }

    showdown() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length === 0) {
            this.state.phase = 'ended';
            this.state.lastAction = '游戏结束，无人获胜';
            return;
        }

        let bestPlayer = activePlayers[0];
        let bestRank = this.evaluateHand(bestPlayer.hand);

        for (const player of activePlayers) {
            const rank = this.evaluateHand(player.hand);
            if (rank > bestRank) {
                bestRank = rank;
                bestPlayer = player;
            }
        }

        this.endGame(bestPlayer);
    }

    evaluateHand(hand) {
        if (hand.length < 3) return 0;
        const ranks = hand.map(c => c.rank);
        const suits = hand.map(c => c.suit);

        const isFlush = suits.every(s => s === suits[0]);

        const rankValues = ranks.map(r => {
            const values = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
            return values[r] || 0;
        });
        const sorted = rankValues.sort((a, b) => a - b);
        const isStraight = sorted[2] - sorted[0] === 2 &&
            sorted[1] - sorted[0] === 1;

        const rankCount = {};
        rankValues.forEach(r => { rankCount[r] = (rankCount[r] || 0) + 1; });
        const counts = Object.values(rankCount);
        const isTrips = counts.some(c => c === 3);
        const isPair = counts.some(c => c === 2);

        if (isFlush && isStraight) return 9;
        if (isTrips) return 8;
        if (isStraight) return 7;
        if (isFlush) return 6;
        if (isPair) {
            if (counts.filter(c => c === 2).length === 2) return 5;
            return 4;
        }
        return Math.max(...rankValues);
    }
    endGame(winner) {
        this.state.phase = 'ended';
        this.state.winner = winner ? winner.id : null;
        this.state.currentPlayer = null;
        this.players.forEach(p => p.isCurrent = false);

        if (winner) {
            winner.chips += this.state.pot;
            this.state.lastAction = `🏆 ${winner.name} 赢得 ${this.state.pot} 筹码！`;
            this.state.handRank = this.evaluateHand(winner.hand);
        } else {
            this.state.lastAction = '游戏结束，平局';
        }

        this.started = false;
    }

    checkPlayerLeft(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (player && !player.folded && this.state.phase !== 'ended') {
            player.folded = true;
            const activePlayers = this.players.filter(p => !p.folded);
            if (activePlayers.length === 1) {
                this.endGame(activePlayers[0]);
            } else if (this.state.currentPlayer === playerId) {
                this.nextTurn();
            }
        }
        return this.getState();
    }
}

module.exports = { ZhaJinHua };