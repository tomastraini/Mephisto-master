from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import requests
import chess
import chess.engine
import random
import os
import json
import re
import asyncio

app = Flask(__name__)
CORS(app)
current_dir = os.path.dirname(os.path.abspath(__file__))
# stockfish_path = os.path.join(current_dir, 'stockfish.exe')
# stockfish_process = subprocess.Popen([stockfish_path],
#                                      cwd=current_dir,
#                                      universal_newlines=True,
#                                      stdin=subprocess.PIPE,
#                                      stdout=subprocess.PIPE,
#                                      stderr=subprocess.DEVNULL)

# stockfish_engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)

lc0_path = os.path.join(current_dir, 'lc0\\lc0.exe')
async def initialize_stockfish():
    # Create the subprocess for Stockfish
    stockfish_process = await asyncio.create_subprocess_exec(
        lc0_path,
        cwd=current_dir,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    return stockfish_process

async def leela_process(stockfish_process, fen, analysis_parameter):
    try:
        if stockfish_process.stdin is None or stockfish_process.stdout is None:
            return None, None, "Stockfish process streams not available"

        commands = [
            f'position fen {fen}\n',
            f'go {analysis_parameter}\n',
            'isready\n'
        ]

        for cmd in commands:
            stockfish_process.stdin.write(cmd.encode())

        # Read output in a loop until the process finishes
        response = ""
        best_move = None
        ponder_move = None

        while True:
            line = await stockfish_process.stdout.readline()
            if not line:
                break

            line = line.decode().strip()
            if line.startswith('info depth'):
                response = line
            elif line.startswith('bestmove'):
                move_parts = line.split(' ')
                best_move = move_parts[1]
                if len(move_parts) > 2 and move_parts[2] == 'ponder':
                    ponder_move = move_parts[3]
                break

        return best_move, ponder_move, response

    except Exception as e:
        print(e)
        return None, None, f"Error in leela_process: {str(e)}"

# Initialize the Stockfish process
stockfish_process = None
stockfish_engine = chess.engine.SimpleEngine.popen_uci(lc0_path)

###################################################################################
###################################################################################
###################################################################################

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

###################################################################################
###################################################################################
###################################################################################

@app.route('/stockfish', methods=['POST'])
async def handle_stockfish():
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

    response = await leela_process(stockfish_process, fen, analysis_parameter)
    print(response)
    best_move = None
    ponder_move = None

    
    if response_type == 'bestmove':
        response = f'bestmove {best_move} ponder {ponder_move}'
    elif response_type == 'info':
        print(response)
        response = reorder_string(response)
        print(response)
        response += f' pv {best_move}'

    return jsonify({'response': response})

@app.before_request
async def setup():
    if not getattr(app, '_got_first_request', False):
        await initialize_stockfish()
        app._got_first_request = True

def reorder_string(input_string):
    try:
        components = input_string.split()

        component_positions = {
            'info': 0,
            'depth': 0,
            'seldepth': 0,
            'multipv': 0,
            'score': 0,
            'cp': 0,
            'nodes': 0,
            'tbhits': 0,
            'time': 0
        }

        # Identify positions of each component in the input string
        for i, comp in enumerate(components):
            if comp in component_positions:
                component_positions[comp] = i

        # Rearrange the components based on the desired order
        reordered_components = [
            'info', 'depth', components[component_positions['depth'] + 1],
            'seldepth', components[component_positions['seldepth'] + 1],
            'multipv', components[component_positions['multipv'] + 1],
            'score', 'cp', components[component_positions['cp'] + 1],  # Placeholder for score cp -9163
            'nodes', components[component_positions['nodes'] + 1],
            'tbhits', components[component_positions['tbhits'] + 1],
            'time', components[component_positions['time'] + 1]
        ]

        # Create the reordered string
        reordered_string = ' '.join(reordered_components)
        return reordered_string
    except e as Exception:
        print(e)
        print("ERROR: " + input_string)
        return input_string




if __name__ == '__main__':
    app.run()
