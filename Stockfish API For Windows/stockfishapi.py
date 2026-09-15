from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import requests
import chess
import chess.engine
import random
import math
import threading
import os
import json

app = Flask(__name__)
CORS(app)
current_dir = os.path.dirname(os.path.abspath(__file__))
stockfish_path = os.path.join(current_dir, "stockfish.exe")
stockfish_dir = current_dir
stockfish_process = subprocess.Popen([stockfish_path],
                                     cwd=stockfish_dir,
                                     universal_newlines=True,
                                     stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL)

stockfish_engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)

# One SimpleEngine can only handle one analysis at a time, and Flask serves
# requests on threads, so every call into it goes through this lock.
engine_lock = threading.Lock()

# Mates are folded into the centipawn scale so every move can be compared with
# a plain integer. Anything near this value is a forced mate, not an evaluation.
MATE_CP = 100000

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}

# --- tuning knobs for the three "change evaluation" modes -------------------

WORST_SEARCH_TIME = 0.30
WORST_TOLERANCE = 100        # cp; play randomly among moves this close to the worst

AGGRESSIVE_SEARCH_TIME = 0.35
AGGRESSIVE_CANDIDATES = 8    # how many engine moves to pick the scariest one from
AGGRESSIVE_MARGIN = 150      # cp we're willing to burn for the sake of the attack

HUMAN_SEARCH_TIME = 0.30
HUMAN_CANDIDATES = 16
HUMAN_TEMPERATURE = 90.0     # cp; higher = looser, sloppier, more scattered play
HUMAN_BLUNDER_CHANCE = 0.08  # how often the top moves are simply not seen

DEFAULT_BOOK_ELO = 2500

# ---------------------------------------------------------------------------


def score_to_cp(score):
    """Turn a relative Cp/Mate score into a single comparable integer."""
    return score.score(mate_score=MATE_CP)


def rank_moves(board, stockfish, search_time, limit=None):
    """
    Score the legal moves in one MultiPV analysis instead of one search per move.

    Returns [(move, cp), ...] sorted best first, from the point of view of the
    side to move. Returns [] if the engine could not be reached.
    """
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        return []

    count = len(legal_moves) if limit is None else min(limit, len(legal_moves))

    try:
        with engine_lock:
            analysis = stockfish.analyse(board,
                                         chess.engine.Limit(time=search_time),
                                         multipv=count)
    except chess.engine.EngineError as error:
        print(f"Stockfish engine error: {error}. Falling back to a random legal move.")
        return []

    ranked = []
    for variation in analysis:
        principal_variation = variation.get("pv")
        score = variation.get("score")
        if not principal_variation or score is None:
            continue
        ranked.append((principal_variation[0], score_to_cp(score.relative)))

    ranked.sort(key=lambda item: item[1], reverse=True)
    return ranked


def center_distance(square):
    """0.5 for the four centre squares, 3.5 in the corners."""
    file_distance = abs(chess.square_file(square) * 2 - 7) / 2
    rank_distance = abs(chess.square_rank(square) * 2 - 7) / 2
    return max(file_distance, rank_distance)


def get_move_count_from_fen(fen):
    board = chess.Board(fen)
    return board.fullmove_number

def get_book_move(fen, play_elo):
    if fen == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1":
        fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

    try:
        api_response = requests.get(f'https://explorer.lichess.ovh/masters',
                                    params={'fen': fen, 'topGames': 0, 'recentGames': 0, 'ratings': play_elo},
                                    timeout=5)
    except requests.RequestException as error:
        print(f"Opening book lookup failed: {error}. Falling back to the engine.")
        return None

    if api_response.status_code == 200:
        api_data = api_response.json()
        moves = api_data.get('moves', [])
        if len(moves) >= 2:
            best_moves = sorted(moves[:2], key=lambda move: move.get('averageRating', 0), reverse=True)
            random_index = random.randint(0, 1)
            selected_move = best_moves[random_index]
            return selected_move['uci']
        elif moves:
            return moves[0]['uci']

    return None

def get_preferred_response(fen, response_type):
    with open(os.path.join(current_dir,'preferred_responses.json'), 'r') as json_file:
        data = json.load(json_file)

    for preferred_response in data:
        if fen == preferred_response["fen"] and response_type == 'bestmove':
            return f"bestmove {preferred_response['bestmove']} ponder {preferred_response['ponder']}\n"
    return None


def intimidation_score(board, move):
    """
    Heuristic for how frightening a move looks from the other side of the board.

    Stockfish only reports an evaluation, so "intimidating" has to be measured
    here: checks, sacrifices, pieces piling onto the king, and enemy material
    left hanging. Higher is scarier.
    """
    us = board.turn
    them = not us
    score = 0.0

    attacker = board.piece_at(move.from_square)
    victim = board.piece_at(move.to_square)
    mover_value = PIECE_VALUES.get(attacker.piece_type, 0) if attacker else 0
    victim_value = PIECE_VALUES.get(victim.piece_type, 0) if victim else 0

    if victim is not None:
        score += 1.5
    if move.promotion:
        score += 2.0

    king_square = board.king(them)

    board.push(move)
    try:
        if board.is_check():
            score += 4.0
            if len(board.checkers()) > 1:
                score += 3.0          # a double check is the scariest thing on a board
            if board.is_checkmate():
                score += 50.0

        # Material left en prise on purpose is what makes an attack feel violent.
        enemy_attackers = board.attackers(them, move.to_square)
        own_defenders = board.attackers(us, move.to_square)
        if enemy_attackers:
            exposure = mover_value - victim_value
            cheapest_attacker = min(PIECE_VALUES.get(board.piece_type_at(square), 0)
                                    for square in enemy_attackers)
            if not own_defenders and exposure > 0:
                score += 2.0 + exposure / 200.0
            elif cheapest_attacker < mover_value:
                score += 1.0 + (mover_value - cheapest_attacker) / 300.0

        if king_square is not None:
            # How much of the king's neighbourhood we cover after the move.
            king_zone = chess.SquareSet(chess.BB_KING_ATTACKS[king_square])
            king_zone.add(king_square)
            score += sum(1 for square in king_zone if board.attackers(us, square)) * 0.8

            # Simply getting close to the king reads as an attack.
            score += max(0, 5 - chess.square_distance(move.to_square, king_square)) * 0.4

            if attacker is not None and attacker.piece_type == chess.PAWN \
                    and chess.square_distance(move.to_square, king_square) <= 3:
                score += 1.0      # pawn storm

        # Enemy pieces we now attack that nobody is defending.
        for square in chess.SquareSet(board.occupied_co[them]):
            piece = board.piece_at(square)
            if piece is None or piece.piece_type == chess.KING:
                continue
            if board.attackers(us, square) and not board.attackers(them, square):
                score += PIECE_VALUES[piece.piece_type] / 300.0
    finally:
        board.pop()

    return score


def human_naturalness(board, move):
    """
    Multiplier for how likely a club player is to even look at this move.

    Humans see forcing, forward, central moves and routinely miss quiet
    retreats, so the sampling below is biased the same way.
    """
    bonus = 1.0

    if board.is_capture(move):
        bonus *= 1.6
    if board.gives_check(move):
        bonus *= 1.4
    if board.is_castling(move):
        bonus *= 1.5
    if move.promotion == chess.QUEEN:
        bonus *= 2.0

    piece = board.piece_at(move.from_square)
    if piece is not None:
        direction = chess.square_rank(move.to_square) - chess.square_rank(move.from_square)
        if board.turn == chess.BLACK:
            direction = -direction
        if direction > 0:
            bonus *= 1.25
        elif direction < 0:
            bonus *= 0.8          # backwards moves get overlooked

        if center_distance(move.to_square) < center_distance(move.from_square):
            bonus *= 1.15

    return bonus


def get_most_aggressive_move(board, stockfish,
                             search_time=AGGRESSIVE_SEARCH_TIME,
                             multipv=AGGRESSIVE_CANDIDATES,
                             margin=AGGRESSIVE_MARGIN):
    """
    Let the engine decide what is playable, then pick the scariest of those.

    The engine filters for soundness and intimidation_score picks the style, so
    the attack stays real instead of hanging pieces for nothing.
    """
    if board.is_game_over():
        return None

    ranked = rank_moves(board, stockfish, search_time, limit=multipv)
    if not ranked:
        return random.choice(list(board.legal_moves))

    best_cp = ranked[0][1]
    candidates = [move for move, cp in ranked if cp >= best_cp - margin]

    scored = [(move, intimidation_score(board, move)) for move in candidates]
    scored.sort(key=lambda item: item[1], reverse=True)

    top_score = scored[0][1]
    finalists = [move for move, value in scored if value >= top_score - 0.5]
    return random.choice(finalists)


def get_worst_move(board, stockfish,
                   search_time=WORST_SEARCH_TIME,
                   tolerance=WORST_TOLERANCE):
    """Pick from the moves the engine rates at the very bottom of the list."""
    ranked = rank_moves(board, stockfish, search_time)
    if not ranked:
        return random.choice(list(board.legal_moves))

    worst_cp = ranked[-1][1]
    candidates = [move for move, cp in ranked if cp <= worst_cp + tolerance]

    # Among equally losing moves, a quiet one looks more like a genuine mistake
    # than flinging a piece into a capture.
    quiet = [move for move in candidates
             if not board.is_capture(move) and not board.gives_check(move)]
    return random.choice(quiet or candidates)


def get_human_move(board, stockfish,
                   search_time=HUMAN_SEARCH_TIME,
                   temperature=HUMAN_TEMPERATURE,
                   blunder_chance=HUMAN_BLUNDER_CHANCE):
    """
    Sample a move the way a person picks one, rather than optimising.

    Every candidate gets a weight that decays with how much it loses against the
    best move, multiplied by how natural it looks. Nothing is ever locked in, so
    the same position can produce a different move each time.
    """
    ranked = rank_moves(board, stockfish, search_time, limit=HUMAN_CANDIDATES)
    if not ranked:
        return random.choice(list(board.legal_moves))
    if len(ranked) == 1:
        return ranked[0][0]

    # Every so often the good moves are simply not seen at all.
    pool = ranked
    if len(ranked) >= 4 and random.random() < blunder_chance:
        pool = ranked[len(ranked) // 3:]

    best_cp = pool[0][1]

    moves = []
    weights = []
    for move, cp in pool:
        loss = best_cp - cp
        moves.append(move)
        weights.append(math.exp(-loss / temperature) * human_naturalness(board, move))

    if sum(weights) <= 0:
        return random.choice(moves)

    return random.choices(moves, weights=weights, k=1)[0]


@app.route('/stockfish', methods=['POST'])
def handle_stockfish():
    global stockfish_process

    data = request.get_json()

    fen = data['fen']
    response_type = data.get('type', '')
    maximum_book_move = data['maximum_book_move']
    bookmoves = data['bookmoves']
    preferred_responses = data['preferred_responses']

    change_evaluation = data['change_evaluation']
    evaluation_color = data['evaluation_color']
    evaluation_type = data['evaluation_type']

    turn = chess.Board(fen).turn

    if preferred_responses:
     preferred_response = get_preferred_response(fen, response_type)
     if preferred_response:
         return jsonify({'response': preferred_response})

    change_evaluation_final = False
    if evaluation_color == 1 and turn:
        change_evaluation_final = True
    elif evaluation_color == 2 and not turn:
        change_evaluation_final = True
    elif evaluation_color == 3:
        change_evaluation_final = True

    if response_type == 'bestmove' and change_evaluation and change_evaluation_final:
        board = chess.Board(fen)
        if not list(board.legal_moves):
            return jsonify({'response': 'bestmove Qh8#'})

        response_changed = None
        if evaluation_type == 1:
            response_changed = get_worst_move(board, stockfish_engine)
        elif evaluation_type == 2:
            response_changed = get_most_aggressive_move(board, stockfish_engine)
        elif evaluation_type == 3:
            response_changed = get_human_move(board, stockfish_engine)

        # An unknown evaluation_type falls through to the normal engine reply.
        if response_changed is not None:
            return jsonify({'response': f'bestmove {response_changed.uci()} ponder h1h2'})

    if bookmoves:
        move_number = get_move_count_from_fen(fen)
        if move_number <= maximum_book_move and response_type == 'bestmove':
            book_move = get_book_move(fen, data.get('play_elo', DEFAULT_BOOK_ELO))

            if book_move is not None:
                response = f'bestmove {book_move} ponder h1h2'
                return jsonify({'response': response})

    movetime = data['movetime']
    depth = data['depth']

    analysis_parameter = f'depth {depth}' if depth else f'movetime {movetime}'
    stockfish_process.stdin.write(f'position fen {fen}\n')
    stockfish_process.stdin.write(f'go {analysis_parameter}\n')
    stockfish_process.stdin.flush()

    response = ""
    best_move = None
    ponder_move = None

    for line in stockfish_process.stdout:
        if line.startswith('info depth'):
            response = line.strip()
        elif line.startswith('bestmove'):
            move_parts = line.split(' ')
            best_move = move_parts[1]
            if len(move_parts) > 2 and move_parts[2] == 'ponder':
                ponder_move = move_parts[3]
            break

    if response_type == 'bestmove':
        response = f'bestmove {best_move} ponder {ponder_move}'
    elif response_type == 'info':
        response += f' pv {best_move}'

    return jsonify({'response': response})


if __name__ == '__main__':
    app.run()
