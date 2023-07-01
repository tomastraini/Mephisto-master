from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import requests
import chess
import random

app = Flask(__name__)
CORS(app)
stockfish_process = subprocess.Popen(['stockfish'],
                                     universal_newlines=True,
                                     stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL)

def get_move_count_from_fen(fen):
    board = chess.Board(fen)
    return board.fullmove_number

def get_book_move(fen, play_elo):
    if fen == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1":
        fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    api_response = requests.get(f'https://explorer.lichess.ovh/lichess',
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


@app.route('/stockfish', methods=['POST'])
def handle_stockfish():
    global stockfish_process

    data = request.get_json()
    fen = data['fen']
    response_type = data.get('type', '')
    maximum_book_move = data['maximum_book_move']
    bookmoves = data['bookmoves']
    play_elo = data['play_elo']
    # GET BOOK MOVE IF EXISTS
    move_number = get_move_count_from_fen(fen)

    if bookmoves and move_number <= maximum_book_move and response_type == 'bestmove':
        book_move = get_book_move(fen, play_elo)

        if book_move is not None:
            response = f'bestmove {book_move} ponder h1h2'
            return jsonify({'response': response})

    movetime = data['movetime']
    depth = data['depth']
    # Determine the analysis parameter based on the availability of 'depth' or 'movetime'
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
