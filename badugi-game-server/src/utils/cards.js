// badugi-game-server/src/utils/cards.js

// 🃏 카드 무늬 (Suit)와 랭크 (Rank) 정의
const SUITS = ['s', 'h', 'd', 'c']; // s: Spade(♠), h: Heart(♥), d: Diamond(♦), c: Club(♣)
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']; // T: 10 (Ten)

/**
 * 덱에 들어갈 개별 카드 객체를 생성합니다.
 * @param {string} suit - 카드의 무늬 ('s', 'h', 'd', 'c')
 * @param {string} rank - 카드의 랭크 ('A', '2', ..., 'K')
 * @returns {{suit: string, rank: string, value: number, id: string}} 카드 객체
 */
function createCard(suit, rank) {
    return {
        suit,
        rank,
        value: getCardValue(rank), // 족보 계산을 위한 숫자 값
        id: `${suit}${rank}` // 클라이언트에서 이미지 파일 이름 등으로 활용할 고유 ID (예: hA, sT)
    };
}

/**
 * 표준 52장 카드 덱을 생성합니다.
 * @returns {Array<{suit: string, rank: string, value: number, id: string}>} 생성된 카드 덱
 */
function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push(createCard(suit, rank));
        }
    }
    return deck;
}

/**
 * 카드 덱을 무작위로 섞습니다 (Fisher-Yates 셔플 알고리즘).
 * @param {Array<Object>} deck - 섞을 카드 덱
 * @returns {Array<Object>} 섞인 카드 덱
 */
function shuffleDeck(deck) {
    // 원본 덱을 변경하지 않기 위해 복사본 생성
    const shuffledDeck = [...deck];
    for (let i = shuffledDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledDeck[i], shuffledDeck[j]] = [shuffledDeck[j], shuffledDeck[i]]; // 스왑
    }
    return shuffledDeck;
}

/**
 * 카드의 랭크(문자)를 족보 계산을 위한 숫자 값으로 변환합니다.
 * 로우바둑이 규칙에 따라 A는 1(가장 낮음)으로 설정. T는 10.
 * @param {string} rank - 카드의 랭크 ('A', '2', ..., 'K')
 * @returns {number} 카드의 숫자 값
 */
function getCardValue(rank) {
    if (rank === 'A') return 1;
    if (rank === 'T') return 10;
    if (rank === 'J') return 11;
    if (rank === 'Q') return 12;
    if (rank === 'K') return 13;
    return parseInt(rank); // '2' ~ '9'
}

/**
 * 주어진 패(4장)에서 가장 좋은 바둑이(무늬/숫자 중복 없는 카드 조합)를 찾습니다.
 * @param {Array<{suit: string, rank: string, value: number}>} hand - 플레이어의 4장 패
 * @returns {Array<{suit: string, rank: string, value: number}>} 찾은 바둑이 카드 조합 (오름차순 정렬)
 */
function findBestBadugi(hand) {
    let bestBadugi = [];

    // 4장 패에서 만들 수 있는 모든 15가지 조합 (C(4,4) + C(4,3) + C(4,2) + C(4,1))을 검사하여
    // 무늬와 숫자가 중복되지 않는 가장 좋은 패(낮은 숫자)를 찾습니다.

    // 4구 바둑이 시도
    for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
            for (let k = j + 1; k < hand.length; k++) {
                for (let l = k + 1; l < hand.length; l++) {
                    const combo = [hand[i], hand[j], hand[k], hand[l]];
                    const suits = new Set(combo.map(c => c.suit));
                    const ranks = new Set(combo.map(c => c.rank));

                    if (suits.size === 4 && ranks.size === 4) {
                        return combo.sort((a, b) => a.value - b.value); // 4구 바둑이를 찾으면 바로 반환 (오름차순 정렬)
                    }
                }
            }
        }
    }

    // 3구 바둑이 시도
    for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
            for (let k = j + 1; k < hand.length; k++) {
                const combo = [hand[i], hand[j], hand[k]];
                const suits = new Set(combo.map(c => c.suit));
                const ranks = new Set(combo.map(c => c.rank));
                if (suits.size === 3 && ranks.size === 3) {
                    return combo.sort((a, b) => a.value - b.value);
                }
            }
        }
    }

    // 2구 바둑이 시도
    for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
            const combo = [hand[i], hand[j]];
            const suits = new Set(combo.map(c => c.suit));
            const ranks = new Set(combo.map(c => c.rank));
            if (suits.size === 2 && ranks.size === 2) {
                return combo.sort((a, b) => a.value - b.value);
            }
        }
    }

    // 1구 바둑이 시도
    if (hand.length > 0) {
        return [hand[0]]; // 가장 낮은 카드 1장
    }

    return bestBadugi; // 찾지 못하면 빈 배열 반환
}

/**
 * 🃏 바둑이 패(Hand)의 족보를 판정하고 점수를 계산합니다. (로우바둑이 규칙 적용)
 * 로우 바둑이 규칙: 숫자 중복(페어) 없고, 무늬 중복 적고, 낮은 숫자가 좋은 패.
 * @param {Array<{suit: string, rank: string, value: number, id: string}>} hand - 플레이어의 4장 패
 * @returns {{rank: string, value: number, badugiCount: number, description: string}} 족보 결과 객체
 */
function evaluateBadugiHand(hand) {
    if (hand.length !== 4) {
        return { rank: 'Invalid', value: Infinity, badugiCount: 0, description: '유효하지 않은 패 (4장이 아님)' };
    }

    const cards = [...hand].sort((a, b) => a.value - b.value); // 숫자 값으로 오름차순 정렬

    let rankCounts = {};
    let suitCounts = {};
    let hasPair = false; // 숫자 중복 여부

    for (const card of cards) {
        rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
        suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
        if (rankCounts[card.rank] > 1) {
            hasPair = true;
        }
    }
    // sameSuitCount는 findBestBadugi에서 직접 처리하므로 여기서 필요 없음

    // 🏆 가장 좋은 바둑이 패 찾기
    const bestBadugiCards = findBestBadugi(hand);
    let badugiCount = bestBadugiCards.length;

    // 족보 판정 및 점수 계산 (낮은 숫자가 좋은 족보)
    let rankName = '노 바둑이';
    let handValue = Infinity; // 점수가 낮을수록 좋은 패. Infinity는 가장 나쁜 패.
    let description = '';

    // 우선순위 판정
    if (hasPair) {
        // 1. 페어 포함 핸드 (가장 큰 감점)
        rankName = `페어 패 (${Object.entries(rankCounts).filter(([, count]) => count > 1).map(([rank, count]) => `${rank} ${count}장`).join(', ')})`;
        handValue = 900000; // 매우 나쁜 점수 (다른 패보다 훨씬 나쁨)
        description = `페어 패, 로우 바둑이 아님`;
    } else {
        // 페어가 없는 경우 (바둑이 가능성이 있음)
        const badugiValues = bestBadugiCards.map(c => c.value).sort((a, b) => a - b);
        let baseValue = 0;
        if (badugiValues.length > 0) {
            // 바둑이 패의 숫자 합산 점수 (낮을수록 좋음)
            baseValue = badugiValues.reduce((sum, val) => sum + val, 0);
        } else {
            // 이 경우는 페어가 없는데도 바둑이를 찾지 못한 예외 상황
            baseValue = 100000; // 매우 높은 값으로 처리
        }

        // 바둑이 구수에 따른 페널티 (구수가 낮을수록 좋은 패)
        if (badugiCount === 4) { // 4구 바둑이
            rankName = `4구 바둑이`;
            handValue = baseValue; // 4구 바둑이는 베이스 값만
            description = `4구 바둑이!`;
        } else if (badugiCount === 3) { // 3구 바둑이
            rankName = `3구 바둑이`;
            handValue = 10000 + baseValue; // 4구보다 나쁨
            description = `3구 바둑이 패`;
        } else if (badugiCount === 2) { // 2구 바둑이
            rankName = `2구 바둑이`;
            handValue = 20000 + baseValue; // 3구보다 나쁨
            description = `2구 바둑이 패`;
        } else if (badugiCount === 1) { // 1구 바둑이
            rankName = `1구 바둑이`;
            handValue = 30000 + baseValue; // 2구보다 나쁨
            description = `1구 바둑이 패`;
        } else {
            rankName = `노 바둑이 (패 오류)`;
            handValue = 999999;
            description = `오류: 바둑이 패를 찾을 수 없음`;
        }
    }

    return {
        rank: rankName,
        value: handValue, // 점수가 낮을수록 좋은 패
        badugiCount: badugiCount,
        description: description,
        badugiCards: bestBadugiCards // 어떤 카드로 바둑이가 되었는지 (디버깅용)
    };
}

/**
 * 복수의 플레이어 패를 비교하여 승자를 결정합니다.
 * 낮은 점수가 좋은 패입니다.
 * @param {Array<{playerId: number, hand: Array<Object>, bestHand: Object}>} playerHands - 비교할 플레이어 패 정보 배열
 * @returns {Array<Object>} 승자 플레이어(들) 목록 (동점자 있을 수 있음), 각 객체에 { playerId, hand, bestHand } 포함
 */
function compareBadugiHands(playerHands) {
    if (playerHands.length === 0) return [];

    let winners = [];
    let bestValue = Infinity; // 낮은 점수가 좋은 패

    // 1차 비교: 족보 점수 (value)
    for (const playerHand of playerHands) {
        const evaluatedHand = playerHand.bestHand;

        if (evaluatedHand.value < bestValue) {
            bestValue = evaluatedHand.value;
            winners = [playerHand];
        } else if (evaluatedHand.value === bestValue) {
            winners.push(playerHand);
        }
    }

    // 2차 비교: 동점자 처리 (동일한 족보 점수일 경우)
    if (winners.length > 1) {
        // 로우바둑이의 동점자 규칙:
        // 1. 같은 구수의 바둑이 패일 경우 (예: 4구 vs 4구)
        // 2. 가장 낮은 숫자부터 역순으로 비교 (A-2-3-4 vs A-2-3-5 이면 A-2-3-4가 승리)
        // 이 로직은 `evaluateBadugiHand`의 `value` 계산에 `baseValue`로 이미 포함되어 있으나,
        // 완전히 동일한 `baseValue`와 `badugiCount`일 경우 `findBestBadugi`가 반환한 정렬된 카드들의 개별 값을 비교해야 합니다.
        // 현재 `evaluateBadugiHand`의 `value` 계산 방식은 이미 낮은 숫자가 합산되어 있기 때문에
        // `value`가 같다면 카드 구성도 동일할 확률이 높습니다.
        // 하지만 실제로는 A-2-3-7과 A-2-4-6처럼 다른 구성으로도 합이 같을 수 있습니다.
        // 이를 위해 `bestBadugiCards` 배열의 각 카드 값을 비교하는 로직이 필요합니다.

        let finalWinners = [];
        let currentBestHandCards = null; // 승자의 bestBadugiCards

        for (const candidate of winners) {
            const candidateBadugiCards = candidate.bestHand.badugiCards; // 이미 오름차순 정렬된 상태
            if (!currentBestHandCards) {
                currentBestHandCards = candidateBadugiCards;
                finalWinners = [candidate];
            } else {
                // 카드 개수가 다르면 안되지만, 안전을 위해
                if (candidateBadugiCards.length !== currentBestHandCards.length) {
                    // 이 경우는 사실상 발생하면 안되는 상황 (value가 같은데 구수가 다를 수 없음)
                    // 또는 족보 점수 로직에 문제가 있을 수 있음.
                    continue;
                }

                let isBetter = false;
                let isTie = true;
                for (let i = candidateBadugiCards.length - 1; i >= 0; i--) { // 가장 높은 카드부터 역순 비교 (로우 바둑이)
                    if (candidateBadugiCards[i].value < currentBestHandCards[i].value) {
                        isBetter = true;
                        isTie = false;
                        break;
                    } else if (candidateBadugiCards[i].value > currentBestHandCards[i].value) {
                        isBetter = false;
                        isTie = false;
                        break;
                    }
                }

                if (isBetter) {
                    currentBestHandCards = candidateBadugiCards;
                    finalWinners = [candidate];
                } else if (isTie) {
                    finalWinners.push(candidate);
                }
            }
        }
        return finalWinners;
    }

    return winners;
}

export { SUITS, RANKS, createCard, createDeck, shuffleDeck, getCardValue, evaluateBadugiHand, compareBadugiHands };