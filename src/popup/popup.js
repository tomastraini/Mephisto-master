import { Chess } from "../../lib/chess.min.js";

let stockfish;
let board;
let fenCache;
let config;

let isCalculating = false;
let prog = 0;
let lastFen = '';
let lastPv = '';
let lastScore = '';
let lastBestMove = '';
let lastResponseMove = '';
let turn = '';

async function fetchStockfishAPI(fen, fromWhere) {
    var callworstmove = false;
    var url = callworstmove ? 'http://127.0.0.1:5000/stockfish/worst' : 'http://127.0.0.1:5000/stockfish';
    if (fen == undefined || fen == "" || fen.includes("undef")) return;
    if (fen === '[object Object]') { fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }
    var objectToSend = config.depth_or_time ?
        {
            fen: fen,
            type: fromWhere,
            depth: config.compute_depth,
            movetime: null,
            bookmoves: config.bookmoves,
            maximum_book_move: config.maximum_book_move,
            play_elo: config.play_elo,
            preferred_responses: config.preferred_responses,
            change_evaluation: config.change_evaluation,
            evaluation_color: config.evaluation_color,
            evaluation_type: config.evaluation_type
        } :
        {
            fen: fen,
            type: fromWhere,
            depth: null,
            movetime: config.compute_time,
            bookmoves: config.bookmoves,
            maximum_book_move: config.maximum_book_move,
            play_elo: config.play_elo,
            preferred_responses: config.preferred_responses,
            change_evaluation: config.change_evaluation,
            evaluation_color: config.evaluation_color,
            evaluation_type: config.evaluation_type
        };
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(objectToSend)
    });
    return response.json();
}
const pieceNameMap = {
    'P': 'Pawn',
    'R': 'Rook',
    'N': 'Knight',
    'B': 'Bishop',
    'Q': 'Queen',
    'K': 'King',
};

document.addEventListener('DOMContentLoaded', function () {
    // load extension configurations from localStorage
    config = {
        // general settings
        compute_time: JSON.parse(localStorage.getItem('compute_time')) || 200,
        compute_depth: JSON.parse(localStorage.getItem('compute_depth')) || 16,
        depth_or_time: JSON.parse(localStorage.getItem('depth_or_time')) || false,
        preferred_responses: JSON.parse(localStorage.getItem('preferred_responses')) || false,

        change_evaluation: JSON.parse(localStorage.getItem('change_evaluation')) || false,
        evaluation_color: JSON.parse(localStorage.getItem('evaluation_color')) || 3,
        evaluation_type: JSON.parse(localStorage.getItem('evaluation_type')) || 2,


        maximum_book_move: JSON.parse(localStorage.getItem('maximum_book_move')) || 8,
        bookmoves: JSON.parse(localStorage.getItem('bookmoves')) || false,
        play_elo: JSON.parse(localStorage.getItem('play_elo')) || 1200,
        fen_refresh: JSON.parse(localStorage.getItem('fen_refresh')) || 20,
        think_time: JSON.parse(localStorage.getItem('think_time')) || 20,
        think_variance: JSON.parse(localStorage.getItem('think_variance')) || 20,
        move_time: JSON.parse(localStorage.getItem('move_time')) || 20,
        move_variance: JSON.parse(localStorage.getItem('move_variance')) || 20,
        simon_says_mode: JSON.parse(localStorage.getItem('simon_says_mode')) || false,
        autoplay: JSON.parse(localStorage.getItem('autoplay')) || false,
        puzzle_mode: JSON.parse(localStorage.getItem('puzzle_mode')) || false,
        python_autoplay_backend: JSON.parse(localStorage.getItem('python_autoplay_backend')) || false,
        // appearance settings
        pieces: JSON.parse(localStorage.getItem('pieces')) || 'wikipedia.svg',
        board: JSON.parse(localStorage.getItem('board')) || 'brown',
        coordinates: JSON.parse(localStorage.getItem('coordinates')) || false,
    };
    push_config();

    // init chess board
    document.getElementById('board').classList.add(config.board);
    const [pieceSet, ext] = config.pieces.split('.');
    board = ChessBoard('board', {
        position: 'start',
        pieceTheme: `/res/chesspieces/${pieceSet}/{piece}.${ext}`,
        appearSpeed: 'fast',
        moveSpeed: 'fast',
        showNotation: config.coordinates,
        draggable: false
    });
    // new_pos("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    // init fen LRU cache
    fenCache = new LRU(1000);
    var fen = fenCache.tail !== undefined && fenCache.tail !== null ? fenCache.tail : { value: "" }

    fetchStockfishAPI(`${fen}`, "info")
        .then(response => {
            on_stockfish_response(response);
            return fetchStockfishAPI(`${fen}`, "bestmove");
        })
        .then(response => {
            toggle_calculating(false);
            on_stockfish_response(response);
        })
        .catch(error => {
            console.error('Error:', error);
            toggle_calculating(false);
        });


    chrome.runtime.onMessage.addListener(function (response) {
        if (response.fenresponse && response.dom !== 'no') {
            if (board.orientation() !== response.orient) {
                board.orientation(response.orient);
            }
            let fen = parse_fen_from_response(response.dom);
            if (lastFen !== fen) {
                new_pos(fen);
            }
        } else if (response.pullConfig) {
            push_config();
        } else if (response.click) {
            dispatchClickEvent(response.x, response.y);
        }
        else if (response.cleanfen) {
            console.log("HEYYY");
        }
    });

    // query fen periodically from content-script
    request_fen();
    setInterval(function () {
        request_fen();
    }, config.fen_refresh);

    // register button click listeners
    document.getElementById('analyze').addEventListener('click', () => {
        window.open(`https://lichess.org/analysis?fen=${lastFen}`, '_blank');
    });
    document.getElementById('config').addEventListener('click', () => {
        window.open('/src/options/options.html', '_blank');
    });

    // initialize materialize
    const instances = M.Tooltip.init(document.querySelectorAll('.tooltipped'), {});
});

function new_pos(fen) {
    document.getElementById('chess_line_1').innerHTML = `
        <div>Calculating...<div>
        <progress id="progBar" value="2" max="100">
    `;
    document.getElementById('chess_line_2').innerText = '';
    fetchStockfishAPI(`${fen}`, "info")
        .then(response => {
            on_stockfish_response(response);
            return fetchStockfishAPI(`${fen}`, "bestmove");
        })
        .then(response => {
            toggle_calculating(false);
            on_stockfish_response(response);
        })
        .catch(error => {
            console.error('Error:', error);
            toggle_calculating(false);
        });

    board.position(fen);
    lastFen = fen;
    if (config.simon_says_mode) {
        draw_arrow(lastBestMove, 'blue', document.getElementById('move-arrow'));
        draw_arrow(lastResponseMove, 'red', document.getElementById('response-arrow'));
        request_console_log(`Best Move: ${lastBestMove}`);
    } else {
        clear_arrows();
    }
    toggle_calculating(true);
}

function parse_fen_from_response(txt) {
    const prefixMap = {
        li: 'Game detected on Lichess.org',
        cc: 'Game detected on Chess.com',
        bt: 'Game detected on BlitzTactics.com'
    };
    const metaTag = txt.substring(3, 8);
    const prefix = metaTag.substring(0, 2);
    document.getElementById('game-detection').innerText = prefixMap[prefix];
    txt = txt.substring(11);
    const chess = new Chess();

    const lastMoveRegex = /([\w-+=#]+[*]+)$/;
    const cacheKey = txt.replace(lastMoveRegex, "");
    const indirectHit = fenCache.get(cacheKey);
    const fenPosition = createFenFromMoves(cacheKey);

    if (metaTag.includes("puz")) { // chess.com & blitztactics.com puzzle pages
        chess.clear(); // clear the board so we can place our pieces
        const [playerTurn, ...pieces] = txt.split("*****").slice(0, -1);
        for (const piece of pieces) {
            const attributes = piece.split("-");
            chess.put({ type: attributes[1], color: attributes[0] }, attributes[2]);
        }
        chess.setTurn(playerTurn);
        turn = chess.turn();
        return chess.fen();
    } else {
        const lastMove = txt.match(lastMoveRegex)[0].split('*****')[0];
        chess.load(fenPosition);
        var move = lastMove.includes('=') ?
            makeMoveWithObject(lastMove) : lastMove;
        chess.move(move)

        turn = chess.turn();
        const fen = chess.fen();

        fenCache.set(txt, fenPosition);
        return fen;
    }
}

function createFenFromMoves(moves) {
    const chess = new Chess();
    const movesArray = moves.split('*****');
    for (const move of movesArray) {
        var movef = move.includes('=') ?
            makeMoveWithObject(move) : move;
        chess.move(movef);
    }

    return chess.fen();
}

function makeMoveWithObject(lastMove) {
    const chess = new Chess();
    if (!lastMove.includes('x')) {
        const [fromTo, promotion] = lastMove.split('=');
        const to = fromTo.substring(1, 3);
        const rank = to[1];
        const file = to[0];
        const rankfrom = (parseInt(rank) === 8) ? (parseInt(rank) - 1) : (parseInt(rank) + 1);

        const from = file + rankfrom;

        const piece = "p";
        const flags = "n";
        const promotions = lastMove[0].toLowerCase();
        const color = chess.turn();
        var movementInfo = { from, to, promotion: promotions, piece, color, flags };
        return movementInfo;
    } else {
        const [fromTo, promotion] = lastMove.split('=');
        const to = fromTo.substring(3, 5); // Extract 'h1' from 'Qgxh1='
        const rank = to[1];
        const file = fromTo[1]; // Extract 'g' from 'Qgxh1='
        const calculateRank = to.includes("8") ? 7 : 2;
        const from = file + calculateRank;
        const promotionpiece = fromTo[0].toLowerCase();

        const piece = "p"; // Retrieve the piece type from the starting position
        const color = from === 7 ? "w" : "b";
        var objectToSend = { color, from, to, flags: 'pc', piece, promotion: promotionpiece };

        return objectToSend;
    }
}

function on_stockfish_response(event) {

    if (event == undefined) {
        return;
    }
    if (event.play_yes == true) {
        request_automove("e2e4")
    }
    let message = event.response;
    if (message.includes('bestmove')) {
        const arr = message.split(' ');
        console.log(board.position())
        const best = arr[1];
        const threat = arr[3].replace(/\n/g, "");
        const toplay = (turn === 'w') ? 'White' : 'Black';
        const next = (turn === 'w') ? 'Black' : 'White';
        draw_arrow(best, 'blue', document.getElementById('move-arrow'));
        draw_arrow(threat, 'red', document.getElementById('response-arrow'));
        if (config.simon_says_mode) {
            const startSquare = best.substring(2, 4);
            console.log(best)
            console.log(startSquare)
            let startPiece = board.position()[startSquare];
            if (!startPiece) {
                board.move(best)
            }
            startPiece = board.position()[startSquare];
            console.log(startPiece)
            const startPieceType = (startPiece) ? startPiece.substring(1) : null;
            if (startPieceType) {
                document.getElementById('chess_line_1').innerText = pieceNameMap[startPieceType];
            }
        } if (best === '(none)') {
            document.getElementById('chess_line_1').innerText = `${next} Wins`;
        } else if (threat && threat !== '(none)') {
            document.getElementById('chess_line_1').innerText = `${toplay} to play, best move is ${best}`;
            document.getElementById('chess_line_2').innerText = `Best response for ${next} is ${threat}`;
        } else {
            document.getElementById('chess_line_1').innerText = `${toplay} to play, best move is ${best}`;
            document.getElementById('chess_line_2').innerText = '';
        }
        if (toplay.toLowerCase() === board.orientation()) {
            lastBestMove = best;
            lastResponseMove = threat;
            if (config.simon_says_mode) {
                const startSquare = best.substring(0, 2);
                const startPiece = board.position()[startSquare].substring(1);
                request_console_log(`${pieceNameMap[startPiece]} ==> ${lastScore}`);
            }
            if (config.autoplay) {
                request_automove(best);
            }
        }
        toggle_calculating(false);
    } else if (message.includes('info depth')) {
        const pvSplit = message.split(" pv ");
        const info = pvSplit[0];
        if (info.includes('score mate')) {
            const arr = message.split('score mate ');
            const mateArr = arr[1].split(' ');
            const mateNum = Math.abs(parseInt(mateArr[0]));
            if (mateNum === 0) {
                document.getElementById('evaluation').innerText = 'Checkmate!';
                document.getElementById('chess_line_2').innerText = '';
            } else {
                document.getElementById('evaluation').innerText = `Checkmate in ${mateNum}`;
            }
            toggle_calculating(false);
        } else if (info.includes('score')) {
            const infoArr = info.split(" ");
            const depth = infoArr[2];
            const score = infoArr[9] * -1;
            document.getElementById('evaluation').innerText = `Score: ${score / 100.0} at depth ${depth}`;
            lastScore = score / 100.0;
        }
        lastPv = pvSplit[1];
    }
    if (isCalculating) {
        prog++;
        let progMapping = 100 * (1 - Math.exp(-prog / 30));
        document.getElementById('progBar').setAttribute('value', `${Math.round(progMapping)}`);
    }
}

function request_fen() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { queryfen: true });
    });
}

function request_automove(move) {
    const message = (config.puzzle_mode)
        ? { automove: true, pv: lastPv || move }
        : { automove: true, move: move };
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, message);
    });
}

function request_console_log(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { consoleMessage: message });
    });
}

function push_config() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, { pushConfig: true, config: config });
    });
}

function getCoords(move) {
    const x0 = move[0].charCodeAt(0) - 'a'.charCodeAt(0) + 1;
    const y0 = parseInt(move.substring(1, 2));
    const x1 = move[2].charCodeAt(0) - 'a'.charCodeAt(0) + 1;
    const y1 = parseInt(move.substring(3, 4));
    return (board.orientation() === 'white')
        ? { x0: x0, y0: y0, x1: x1, y1: y1 }
        : { x0: 9 - x0, y0: 9 - y0, x1: 9 - x1, y1: 9 - y1 };
}

function draw_arrow(move, color, overlay) {
    if (!move || move === '(none)') {
        overlay.lastElementChild?.remove();
        return;
    }

    const bodyWidth = document.body.clientWidth;
    const boardSide = document.querySelector('#board .board-b72b1').clientWidth;
    const marginLeft = (bodyWidth - boardSide) / 2;

    const coords = getCoords(move);
    let x0 = 0.5 + (coords.x0 - 1);
    let y0 = 8 - (0.5 + (coords.y0 - 1));
    let x1 = 0.5 + (coords.x1 - 1);
    let y1 = 8 - (0.5 + (coords.y1 - 1));

    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.sqrt(dx * dx + dy * dy);
    x0 = x0 + 0.1 * ((x1 - x0) / d);
    y0 = y0 + 0.1 * (dy / d);
    x1 = x1 - 0.4 * ((x1 - x0) / d);
    y1 = y1 - 0.4 * (dy / d);

    overlay.innerHTML = `
        <svg width="${boardSide}" height="${boardSide}" viewBox="0, 0, 8, 8" style="margin-left: ${marginLeft}px">
            <defs>
                <marker id="arrow-${color}" markerWidth="13" markerHeight="13" refX="1" refY="7" orient="auto">
                    <path d="M1,5.75 L3,7 L1,8.25" fill="${color}" />
                </marker>
            </defs>
            <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" fill=${color}" stroke-width="0.225" 
                marker-end="url(#arrow-${color})"/>
        </svg>
    `;
}

function clear_arrows() {
    if (!config.simon_says_mode) {
        document.getElementById('move-arrow').lastElementChild?.remove();
        document.getElementById('response-arrow').lastElementChild?.remove();
    }
}

function toggle_calculating(on) {
    prog = 0;
    isCalculating = on;
}

async function dispatchClickEvent(x, y) {
    if (config.python_autoplay_backend) {
        await requestPythonBackendClick(x, y);
    } else {
        await requestDebuggerClick(x, y);
    }
}

async function requestDebuggerClick(x, y) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const debugee = { tabId: tabs[0].id };
        chrome.debugger.attach(debugee, "1.3", async () => {
            await dispatchMouseEvent(debugee, "Input.dispatchMouseEvent", {
                type: 'mousePressed',
                button: 'left',
                clickCount: 1,
                x: x,
                y: y,
            });
            await dispatchMouseEvent(debugee, "Input.dispatchMouseEvent", {
                type: 'mouseReleased',
                button: 'left',
                clickCount: 1,
                x: x,
                y: y,
            });
        });
    });
}

async function dispatchMouseEvent(debugee, mouseEvent, mouseEventOpts) {
    return new Promise(resolve => {
        chrome.debugger.sendCommand(debugee, mouseEvent, mouseEventOpts, resolve);
    });
}

async function requestPythonBackendClick(x, y) {
    return callPythonBackend(`http://localhost:8080/performClick`, { x: x, y: y });
}

async function requestPythonBackendMove(x0, y0, x1, y1) {
    return callPythonBackend('http://localhost:8080/performMove', { x0: x0, y0: y0, x1: x1, y1: y1 });
}

async function callPythonBackend(url, data) {
    return fetch(url, {
        method: "POST",
        credentials: "include",
        cache: "no-cache",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });
}
