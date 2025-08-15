
let chess = new Chess();
const boardElement = document.querySelector('.chessboard');
let draggedPiece = null;   // changed const → let so it can be reassigned
let sourceSquare = null;   // changed const → let so it can be reassigned
let playerRole = null;
 // Assuming friendName is defined in your context
let initialBoardReady = false;


socket.on('playerRole', (role) => {
    playerRole = role;
    if (initialBoardReady) renderBoard();
});

socket.on('boardState', (fen) => {
    chess.load(fen);
    initialBoardReady = true;
    if (playerRole) renderBoard();
});

const renderBoard = () => {
    const board = chess.board();
    boardElement.innerHTML = '';

    // Rotate whole board for black at container level
    if (playerRole === 'b') {
        boardElement.classList.add('rotate-180');
    } else {
        boardElement.classList.remove('rotate-180');
    }

    board.forEach((row, rowIndex) => {
        row.forEach((square, colIndex) => {
            const squareElement = document.createElement('div');
            squareElement.classList.add(
                'square',
                (rowIndex + colIndex) % 2 === 0 ? 'light' : 'dark'
            );
            squareElement.dataset.row = rowIndex;
            squareElement.dataset.col = colIndex;

            if (square) {
                const pieceElement = document.createElement('div');
                const colorClass = square.color === 'w' ? 'white' : 'black';

                // Assign piece + team
                pieceElement.classList.add('piece', colorClass);

                // Add pawn class if needed
                if (square.type.toLowerCase() === 'p') {
                    pieceElement.classList.add('pawn');
                }

                // Set unicode symbol
                pieceElement.textContent = getPieceUnicode(square.type);

                // Make draggable for own pieces
                pieceElement.draggable = (square.color === playerRole);

                // Flip piece itself for black player
                if (playerRole === 'b') {
                    pieceElement.classList.add('rotate-180');
                }

                // Drag handlers
                pieceElement.addEventListener('dragstart', (e) => {
                    draggedPiece = pieceElement;
                    sourceSquare = { row: rowIndex, col: colIndex };
                    e.dataTransfer.setData('text/plain', '');
                });
                pieceElement.addEventListener('dragend', () => {
                    draggedPiece = null;
                    sourceSquare = null;
                });

                squareElement.appendChild(pieceElement);
            }

            // Allow drop
            squareElement.addEventListener('dragover', (e) => e.preventDefault());
            squareElement.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedPiece && sourceSquare) {
                    const targetSquare = { row: rowIndex, col: colIndex };
                    handleMove(sourceSquare, targetSquare);
                    draggedPiece = null;
                    sourceSquare = null;
                }
            });

            // Append square (only once)
            boardElement.appendChild(squareElement);
        });
    });
};



const handleMove = (source, target) => {
    if (!draggedPiece) return;
    const move = {
        from: `${String.fromCharCode(97 + source.col)}${(8 - source.row)}`,
        to: `${String.fromCharCode(97 + target.col)}${(8 - target.row)}`,
        promotion: 'q' // Always promote to queen for simplicity
    };
    socket.emit('move', move);
    chess.move(move);
    renderBoard();
};

const getPieceUnicode = (piece) => {
    const pieceUnicode = {
        'p': '♟', // Pawn
        'r': '♜', // Rook
        'n': '♞', // Knight
        'b': '♝', // Bishop
        'q': '♛', // Queen
        'k': '♚'  // King
    };
    return pieceUnicode[piece] || '';
};

socket.on('move', (move) => {
    chess.move(move);
    renderBoard();
});

socket.on('resetBoard', (initialFen) => {
    chess.load(initialFen);
    renderBoard();
});
socket.on('playerDisconnected', (socketId) => {
    const playerDisconnected = document.getElementsByClassName('right-side-message')[0];
    playerDisconnected.innerText = `player ${socketId} has disconnected, setting you as white in 5 seconds`;
    setTimeout(() => {
        playerDisconnected.innerText = '';
    }, 5000);
    socket.emit('reload', socket.id);
});


socket.on('gameEnd', ({ result, winner, reason }) => {
    const area = document.getElementById('message-area');
    if (result === 'checkmate') {
        area.innerHTML = `<span class="text-emerald-400 text-3xl ">${winner} wins by checkmate!</span>`;
    } else if (result === 'draw') {
        area.innerHTML = `<span class="text-amber-200 text-2xl ">Draw: ${reason}</span>`;
    } else {
        area.innerHTML = `<span class="text-gray-400 text-xl ">Game ended: ${reason}</span>`;
    }
});


socket.on('connected', (data) => {
    const playerconnected = document.getElementsByClassName('right-side-message')[0];
    playerconnected.innerText = ` ${ data} has connected, its now you vs him !!!`;
});


renderBoard();
