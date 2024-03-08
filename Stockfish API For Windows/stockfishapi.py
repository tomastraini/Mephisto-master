from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import requests
import chess
import chess.engine
import random
import os
import json

app = Flask(__name__)
CORS(app)
stockfish_path = 'C:\\Users\\Tomas\\Documents\\Games installer\\Mephisto-master-main\\Stockfish API for Linux\\stockfish.exe'
stockfish_dir = 'C:\\Users\\Tomas\\Documents\\Games installer\\Mephisto-master-main\\Stockfish API for Linux'
stockfish_path = os.path.expanduser(stockfish_path)
stockfish_dir = os.path.expanduser(stockfish_dir)
stockfish_process = subprocess.Popen([stockfish_path],
                                     cwd=stockfish_dir,
                                     universal_newlines=True,
                                     stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL)

stockfish_engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)

def get_move_count_from_fen(fen):
    board = chess.Board(fen)
    return board.fullmove_number

def get_book_move(fen, play_elo):
    if fen == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1":
        fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    api_response = requests.get(f'https://explorer.lichess.ovh/masters',
                               params={'fen': fen, 'topGames': 0, 'recentGames': 0, 'ratings': play_elo})

    if api_response.status_code == 200:
        api_data = api_response.json()
        moves = api_data.get('moves', [])
        if len(moves) >= 2:
            best_moves = sorted(moves[:2], key=lambda move: move.get('averageRating', 0), reverse=True)
            print(best_moves)
            random_index = random.randint(0, 1)
            selected_move = best_moves[random_index]
            return selected_move['uci']
        elif moves:
            return moves[0]['uci']

    return None

def get_preferred_response(fen, response_type):
    with open('./preferred_responses.json', 'r') as json_file:
        data = json.load(json_file)
        
    for preferred_response in data:
        if fen == preferred_response["fen"] and response_type == 'bestmove':
            return f"bestmove {preferred_response['bestmove']} ponder {preferred_response['ponder']}\n"
    return None

def get_most_aggressive_move(board, stockfish):
    legalMoves = list(board.legal_moves)
    timeLeft = 1

    if not isinstance(timeLeft, chess.engine.Limit):
        timeLeft /= 1000
        searchTime = min(timeLeft / (10 * len(legalMoves)), 0.1)
    else:
        searchTime = 0.1

    mostAggressiveEvaluation = None
    mostAggressiveMoves = []

    for move in legalMoves:
        board.push(move)
        evaluation = stockfish.analyse(board, chess.engine.Limit(time=searchTime - 0.01))["score"].relative

        if mostAggressiveEvaluation is None or mostAggressiveEvaluation > evaluation:
            mostAggressiveEvaluation = evaluation
            mostAggressiveMoves = [move]
        elif mostAggressiveEvaluation == evaluation:
            mostAggressiveMoves.append(move)

        board.pop()

    aggressiveCaptures = [move for move in mostAggressiveMoves if board.is_capture(move)]
    aggressiveChecks = [move for move in mostAggressiveMoves if board.gives_check(move)]
    aggressiveQueenAttacks = [move for move in mostAggressiveMoves if board.is_capture(move) and board.piece_at(move.to_square).piece_type == chess.QUEEN]
    aggressiveOther = [move for move in mostAggressiveMoves if move not in aggressiveCaptures and move not in aggressiveChecks and move not in aggressiveQueenAttacks]

    if aggressiveChecks:
        return random.choice(aggressiveChecks)
    elif aggressiveCaptures:
        return random.choice(aggressiveCaptures)
    elif aggressiveQueenAttacks:
        return random.choice(aggressiveQueenAttacks)
    elif aggressiveOther:
        return random.choice(aggressiveOther)
    else:
        return random.choice(mostAggressiveMoves)

def get_worst_move(board, stockfish):
    legalMoves = list(board.legal_moves)
    timeLeft = 1

    if not isinstance(timeLeft, chess.engine.Limit):
        timeLeft /= 1000
        searchTime = min(timeLeft / (10 * len(legalMoves)), 0.1)
    else:
        searchTime = 0.1

    worstEvaluation = None
    worstMoves = []

    for move in legalMoves:
        board.push(move)
        evaluation = stockfish.analyse(board, chess.engine.Limit(time=searchTime - 0.01))["score"].relative

        if worstEvaluation is None or worstEvaluation < evaluation:
            worstEvaluation = evaluation
            worstMoves = [move]
        elif worstEvaluation == evaluation:
            worstMoves.append(move)

        board.pop()

    worstCaptures = [move for move in worstMoves if board.is_capture(move)]
    worstChecks = [move for move in worstMoves if board.gives_check(move)]
    worstOther = [move for move in worstMoves if move not in worstCaptures and move not in worstChecks]

    if worstOther:
        return random.choice(worstOther)
    elif worstChecks:
        return random.choice(worstChecks)
    else:
        return random.choice(worstCaptures)

def get_human_move(board, stockfish):
    legalMoves = list(board.legal_moves)
    timeLeft = 1

    if not isinstance(timeLeft, chess.engine.Limit):
        timeLeft /= 1000
        searchTime = min(timeLeft / (10 * len(legalMoves)), 0.1)
    else:
        searchTime = 0.1

    bestEvaluation = None
    bestMoves = []

    for move in legalMoves:
        board.push(move)
        evaluation = stockfish.analyse(board, chess.engine.Limit(time=searchTime - 0.01))["score"].relative

        # Modify the condition to select moves with evaluations close to 0
        if bestEvaluation is None or abs(evaluation) < abs(bestEvaluation):
            bestEvaluation = evaluation
            bestMoves = [move]
        elif abs(evaluation) == abs(bestEvaluation):
            bestMoves.append(move)

        board.pop()

    bestCaptures = [move for move in bestMoves if board.is_capture(move)]
    bestChecks = [move for move in bestMoves if board.is_check()]
    bestOther = [move for move in bestMoves if move not in bestCaptures and move not in bestChecks]

    if bestOther:
        return random.choice(bestOther)
    elif bestChecks:
        return random.choice(bestChecks)
    else:
        return random.choice(bestCaptures)

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

    turn = chess.Board(fen).turn  # Determine the side to move (True for white, False for black)

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
     legal_moves = list(chess.Board(fen).legal_moves)
     if not legal_moves:
         return jsonify({'response': 'bestmove Qh8#'})
     if evaluation_type == 1:
        response_changed = get_worst_move(chess.Board(fen), stockfish_engine)
     if evaluation_type == 2:
        response_changed = get_most_aggressive_move(chess.Board(fen), stockfish_engine)
     if evaluation_type == 3:
        response_changed = get_human_move(chess.Board(fen), stockfish_engine)

     return jsonify({'response': f'bestmove {response_changed.uci()} ponder h1h2'})

    if bookmoves:
        move_number = get_move_count_from_fen(fen)
        if move_number <= maximum_book_move and response_type == 'bestmove':
            book_move = get_book_move(fen, play_elo)

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
