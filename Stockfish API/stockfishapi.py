from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
from threading import Thread
import random
app = Flask(__name__)
CORS(app)
stockfish_process = subprocess.Popen(['stockfish'],
                                             universal_newlines=True,
                                             stdin=subprocess.PIPE,
                                             stdout=subprocess.PIPE,
                                             stderr=subprocess.DEVNULL)


@app.route('/stockfish', methods=['POST'])
def handle_stockfish():
    global stockfish_process

    data = request.get_json()
    fen = data['fen']
    movetime = data['movetime']
    depth = data.get('depth')  # Use get() method to handle cases where 'depth' is not present in the request

    # Determine the analysis parameter based on the availability of 'depth' or 'movetime'
    if depth:
        analysis_parameter = f'depth {depth}'
    else:
        analysis_parameter = f'movetime {movetime}'

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

    response_type = data.get('type', '')

    if response_type == 'bestmove':
        response = f'bestmove {best_move} ponder {ponder_move}'
    elif response_type == 'info':
        response = response + f' pv {best_move}'

    return jsonify({'response': response})


@app.route('/stockfish/worst', methods=['POST'])
def handle_stockfish_worst():
    global stockfish_process

    if stockfish_process is None:
        stockfish_process = subprocess.Popen(['stockfish'],
                                             universal_newlines=True,
                                             stdin=subprocess.PIPE,
                                             stdout=subprocess.PIPE,
                                             stderr=subprocess.DEVNULL)

    data = request.get_json()
    fen = data['fen']
    stockfish_process.stdin.write(f'position fen {fen}\n')
    stockfish_process.stdin.write(f'go depth 1 \n')

    stockfish_process.stdin.flush()

    response = ""
    best_move = None

    for line in stockfish_process.stdout:
        if line.startswith('info depth'):
            response = line.strip()
        elif line.startswith('bestmove'):
            best_move = line.split(' ')[1]
            break

    response_type = data.get('type', '')  # Get the 'type' parameter from the request data

    if response_type == 'bestmove':
        response = f'bestmove {best_move} ponder h8h6'
    elif response_type == 'info':
        response = response + f' pv {best_move}'

    return jsonify({'response': response})

if __name__ == '__main__':
    # Start the Stockfish analysis in a separate thread

    app.run()
