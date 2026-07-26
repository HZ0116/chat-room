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
            phase: 'waiting', // waiting, preflop, flop, turn, river, showdown, ended
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

    // 启动游戏
    start() {
        if (this.started) throw new Error('游戏已开始');
        if (this.players.length < 2) throw new Error('至少需要2名玩家');

        this.started = true;
        this.state.phase = 'preflop';
        this.state.pot = 0;
        this.currentBet = 0;
        this.raiseCount = 0;

        // 重置玩家状态
        this.players.forEach(p => {
            p.chips = 1000;
            p.bet = 0;
            p.folded = false;
            p.allin = false;
            p.hand = [];
            p.isDealer = false;
            p.isCurrent = false;
        });

        // 洗牌发牌
        this.shuffleDeck();
        this.dealCards();

        // 设置庄家和小盲大盲
        this.setBlinds();

        // 记录状态
        this.state.players = this.players;
        this.state.lastAction = '游戏开始';

        return this.getState();
    }

    // 洗牌
    shuffleDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        this.state.deck = [];
        for (const suit of suits) {
            for (const rank of ranks) {
                this.state.deck.push({ suit, rank });
            }
        }
        // Fisher-Yates 洗牌
        for (let i = this.state.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.state.deck[i], this.state.deck[j]] = [this.state.deck[j], this.state.deck[i]];
        }
    }

    // 发牌
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

    // 设置盲注
    setBlinds() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length < 2) return;

        // 庄家
        this.dealerIndex = (this.dealerIndex + 1) % activePlayers.length;
        activePlayers[this.dealerIndex].isDealer = true;

        // 小盲
        const sbIndex = (this.dealerIndex + 1) % activePlayers.length;
        const sbPlayer = activePlayers[sbIndex];
        const sbAmount = Math.min(5, sbPlayer.chips);
        sbPlayer.chips -= sbAmount;
        sbPlayer.bet = sbAmount;
        this.state.pot += sbAmount;
        this.currentBet = sbAmount;

        // 大盲
        const bbIndex = (this.dealerIndex + 2) % activePlayers.length;
        const bbPlayer = activePlayers[bbIndex];
        const bbAmount = Math.min(10, bbPlayer.chips);
        bbPlayer.chips -= bbAmount;
        bbPlayer.bet = bbAmount;
        this.state.pot += bbAmount;
        this.currentBet = bbAmount;

        this.state.lastAction = `盲注: ${sbPlayer.name} ${sbAmount}, ${bbPlayer.name} ${bbAmount}`;

        // 从大盲后一位开始
        this.actionIndex = (bbIndex + 1) % activePlayers.length;
        this.state.currentPlayer = activePlayers[this.actionIndex].id;
        this.players.forEach(p => p.isCurrent = p.id === this.state.currentPlayer);
    }

    // 获取玩家手牌（用于广播）
    getPlayerCards(playerId) {
        const player = this.players.find(p => p.id === playerId);
        return player ? player.hand : [];
    }

    // 获取玩家信息
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

    // 获取游戏状态
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

    // 下注
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

    // 跟注
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

    // 加注
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

    // 弃牌
    fold(playerId) {
        if (this.state.phase === 'ended') throw new Error('游戏已结束');
        if (this.state.currentPlayer !== playerId) throw new Error('不是你的回合');

        const player = this.players.find(p => p.id === playerId);
        if (!player) throw new Error('玩家不存在');
        if (player.folded) throw new Error('玩家已弃牌');

        player.folded = true;
        player.isCurrent = false;
        this.state.lastAction = `${player.name} 弃牌`;

        // 检查是否只剩一个玩家
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length === 1) {
            this.endGame(activePlayers[0]);
            return this.getState();
        }

        this.nextTurn();
        return this.getState();
    }

    // All-in
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

    // 下一回合
    nextTurn() {
        const activePlayers = this.players.filter(p => !p.folded);
        if (activePlayers.length === 1) {
            this.endGame(activePlayers[0]);
            return;
        }

        // 检查是否所有人都已行动（或all-in）
        const allActed = activePlayers.every(p => 
            p.allin || p.bet === this.currentBet || p.folded
        );

        if (allActed) {
            // 进入下一阶段
            this.nextStage();
            return;
        }

        // 找下一个未行动的玩家
        let nextIndex = (this.actionIndex + 1) % this.players.length;
        let attempts = 0;
        