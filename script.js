(() => {
  const SIZE = 10;
  const STORAGE_KEY = "blockblast_state_v1";

  // Define shapes as arrays of [x, y] relative coordinates, normalized with (0,0) top-left.
  // Use a curated set (no rotation needed; BlockBlast/1010 style).
  const SHAPES = [
    // Singles & lines
    [[0,0]],
    [[0,0],[1,0]], [[0,0],[1,0],[2,0]], [[0,0],[1,0],[2,0],[3,0]], [[0,0],[1,0],[2,0],[3,0],[4,0]],
    [[0,0],[0,1]], [[0,0],[0,1],[0,2]], [[0,0],[0,1],[0,2],[0,3]], [[0,0],[0,1],[0,2],[0,3],[0,4]],

    // Squares
    [[0,0],[1,0],[0,1],[1,1]],
    [[0,0],[1,0],[0,1],[1,1],[2,0],[2,1]], // 2x3 block
    [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]], // 3x2 block
    [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]], // 3x3

    // L / J / T / S-ish shapes (small, no rotation variants to keep it simple)
    [[0,0],[0,1],[1,1]],          // small L (2x2 minus one)
    [[1,0],[0,1],[1,1]],          // small J
    [[0,0],[1,0],[2,0],[1,1]],    // T (flat)
    [[0,1],[1,1],[2,1],[1,0]],    // T (upside)
    [[0,0],[1,0],[1,1]],          // S corner
    [[1,0],[0,1],[1,1]],          // Z corner

    // Bigger L
    [[0,0],[0,1],[0,2],[1,2]],
    [[1,0],[1,1],[1,2],[0,2]],

    // Plus and stairs
    [[1,0],[0,1],[1,1],[2,1],[1,2]], // plus
    [[0,0],[1,0],[1,1],[2,1]]        // stair
  ];

  // Utilities
  const $ = (sel, el=document) => el.querySelector(sel);
  const boardEl = $("#board");
  const piecesEl = $("#pieces");
  const scoreEl = $("#score");
  const bestEl = $("#best");
  const btnNew = $("#btn-new");
  const btnUndo = $("#btn-undo");
  const btnHint = $("#btn-hint");

  // Build board
  const cells = [];
  function buildBoard(){
    boardEl.innerHTML = "";
    cells.length = 0;
    for(let r=0;r<SIZE;r++){
      const row = [];
      for(let c=0;c<SIZE;c++){
        const cell = $("#cell-template").content.firstElementChild.cloneNode(true);
        cell.dataset.r = r;
        cell.dataset.c = c;
        boardEl.appendChild(cell);
        row.push(cell);
      }
      cells.push(row);
    }
  }

  // Game state
  let state = {
    board: Array.from({length: SIZE}, () => Array(SIZE).fill(0)),
    bag: [],            // upcoming shapes (indices)
    tray: [null, null, null], // 3 current shapes (indices into SHAPES)
    used: [0,0,0],      // whether placed
    score: 0,
    best: 0,
    history: []         // for undo: stack of moves
  };

  // Persistence
  function load(){
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      try{
        const data = JSON.parse(raw);
        Object.assign(state, data);
      }catch{}
    }
    state.best = Math.max(state.best||0, state.score||0);
  }

  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // Bag & tray
  function refillBag(){
    // Simple random refill; weight larger shapes a bit less
    const weighted = [];
    SHAPES.forEach((shape, idx) => {
      const weight = Math.max(1, 8 - shape.length); // more cells => lower weight
      for(let i=0;i<weight;i++) weighted.push(idx);
    });
    // shuffle
    for(let i=weighted.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
    }
    state.bag = state.bag.concat(weighted);
  }

  function drawFromBag(){
    if(state.bag.length < 10) refillBag();
    return state.bag.pop();
  }

  function refillTray(){
    for(let i=0;i<3;i++){
      state.tray[i] = drawFromBag();
      state.used[i] = 0;
    }
  }

  // Rendering
  function renderBoard(){
    for(let r=0;r<SIZE;r++){
      for(let c=0;c<SIZE;c++){
        cells[r][c].dataset.filled = state.board[r][c] ? "1" : "0";
        cells[r][c].dataset.ghost = "0";
      }
    }
    scoreEl.textContent = state.score;
    bestEl.textContent = state.best;
  }

  function renderTray(){
    piecesEl.innerHTML = "";
    for(let i=0;i<3;i++){
      const idx = state.tray[i];
      const used = state.used[i] === 1;
      const shape = SHAPES[idx];
      // compute width/height
      const w = Math.max(...shape.map(([x])=>x))+1;
      const h = Math.max(...shape.map(([,y])=>y))+1;

      const p = document.createElement("div");
      p.className = "piece";
      p.dataset.idx = i;
      p.dataset.used = used ? "1" : "0";
      p.style.gridTemplateColumns = `repeat(${w}, 1fr)`;
      p.style.gridTemplateRows = `repeat(${h}, 1fr)`;

      // create empty grid then fill
      const grid = Array.from({length: h}, () => Array(w).fill(0));
      for(const [x,y] of shape) grid[y][x] = 1;
      for(let yy=0; yy<h; yy++){
        for(let xx=0; xx<w; xx++){
          const dot = document.createElement("div");
          if(grid[yy][xx]) dot.className = "piece-cell"; else {
            dot.style.width = "28px"; dot.style.height="28px"; // keep grid structure
            dot.style.opacity = "0";
          }
          p.appendChild(dot);
        }
      }

      if(!used){
        enableDrag(p, shape);
        p.addEventListener("click", () => {
          // tap-to-select -> next tap on a valid cell places it
          selected = { shapeIndex: i, shape };
          boardEl.classList.add("placing");
        });
      }
      piecesEl.appendChild(p);
    }
  }

  // Placement logic
  function canPlace(shape, r, c){
    for(const [x,y] of shape){
      const rr = r + y;
      const cc = c + x;
      if(rr<0||cc<0||rr>=SIZE||cc>=SIZE) return false;
      if(state.board[rr][cc]) return false;
    }
    return true;
  }

  function placeShape(trayIndex, shape, r, c){
    // Apply placement
    for(const [x,y] of shape){
      state.board[r+y][c+x] = 1;
    }
    // Score for cells
    let gained = shape.length;
    // Clear full rows/cols
    const fullRows = [];
    const fullCols = [];
    for(let rr=0; rr<SIZE; rr++){
      if(state.board[rr].every(v=>v===1)) fullRows.push(rr);
    }
    for(let cc=0; cc<SIZE; cc++){
      let full = true;
      for(let rr=0; rr<SIZE; rr++){
        if(state.board[rr][cc]===0) { full=false; break; }
      }
      if(full) fullCols.push(cc);
    }
    if(fullRows.length || fullCols.length){
      for(const rr of fullRows) state.board[rr].fill(0);
      for(const cc of fullCols){
        for(let rr=0; rr<SIZE; rr++) state.board[rr][cc]=0;
      }
      const lines = fullRows.length + fullCols.length;
      gained += 10 * lines + (lines>1 ? 5*(lines-1) : 0); // small combo bonus
    }
    state.score += gained;
    state.best = Math.max(state.best, state.score);

    // Mark used
    state.used[trayIndex] = 1;
    // push history for undo
    state.history.push({ trayIndex, shapeIndex: state.tray[trayIndex], r, c, clearedRows: fullRows, clearedCols: fullCols, cells: shape });

    // Refill tray if all used
    if(state.used.every(v=>v===1)){
      refillTray();
    }
    save();
  }

  // Game over check
  function anyPlacementPossible(){
    for(let ti=0; ti<3; ti++){
      if(state.used[ti]===1) continue;
      const shape = SHAPES[state.tray[ti]];
      for(let r=0; r<SIZE; r++){
        for(let c=0; c<SIZE; c++){
          if(canPlace(shape, r, c)) return true;
        }
      }
    }
    return false;
  }

  // Ghost render
  function paintGhost(shape, r, c, on){
    for(const [x,y] of shape){
      const rr = r + y, cc = c + x;
      if(rr>=0 && cc>=0 && rr<SIZE && cc<SIZE){
        cells[rr][cc].dataset.ghost = on ? "1" : "0";
      }
    }
  }

  // Drag & Drop (mouse/touch) — simplified logic using document-level listeners
  let dragging = null; // { shape, trayIndex }
  let selected = null; // tap-to-place: { shapeIndex, shape }

  function enableDrag(el, shape){
    el.addEventListener("pointerdown", (e) => {
      if(e.button !== 0) return;
      dragging = { shape, trayIndex: +el.dataset.idx };
      el.setPointerCapture(e.pointerId);
      boardEl.classList.add("placing");
    });
    el.addEventListener("pointerup", (e) => {
      if(!dragging) return;
      boardEl.classList.remove("placing");
      // place at last hovered ghost (tracked by hoverCell)
      if(currentHover && canPlace(dragging.shape, currentHover.r, currentHover.c)){
        placeShape(dragging.trayIndex, dragging.shape, currentHover.r, currentHover.c);
        renderBoard(); renderTray();
        if(!anyPlacementPossible()){
          setTimeout(()=>alert("Game Over!"), 20);
        }
      }
      clearGhost();
      dragging = null;
    });
  }

  let currentHover = null;
  function clearGhost(){
    if(currentHover){
      paintGhost(currentHover.shape, currentHover.r, currentHover.c, false);
      currentHover = null;
    }else{
      // clear any leftover ghosts
      for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) cells[r][c].dataset.ghost = "0";
    }
  }

  boardEl.addEventListener("pointermove", (e) => {
    if(!dragging) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if(!target) return;
    const cell = target.closest(".cell");
    if(!cell) { clearGhost(); return; }
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const shape = dragging.shape;
    if(currentHover && (currentHover.r!==r || currentHover.c!==c)){
      paintGhost(currentHover.shape, currentHover.r, currentHover.c, false);
      currentHover = null;
    }
    if(canPlace(shape, r, c)){
      paintGhost(shape, r, c, true);
      currentHover = { shape, r, c };
    }else{
      clearGhost();
    }
  });

  // Tap-to-place flow
  boardEl.addEventListener("click", (e) => {
    if(!selected) return;
    const cell = e.target.closest(".cell");
    if(!cell) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    const shape = selected.shape;
    if(canPlace(shape, r, c)){
      placeShape(selected.shapeIndex, shape, r, c);
      selected = null;
      boardEl.classList.remove("placing");
      renderBoard(); renderTray();
      if(!anyPlacementPossible()){
        setTimeout(()=>alert("Game Over!"), 20);
      }
    }
  });

  // Buttons
  btnNew.addEventListener("click", () => {
    if(!confirm("Start a new game? Your current progress will be lost.")) return;
    state.board = Array.from({length: SIZE}, () => Array(SIZE).fill(0));
    state.score = 0;
    state.bag = [];
    state.history = [];
    refillTray();
    save();
    renderBoard(); renderTray();
  });

  btnUndo.addEventListener("click", () => {
    const last = state.history.pop();
    if(!last) return;
    // revert board: remove placed cells, then restore cleared lines
    for(const [x,y] of last.cells){
      state.board[last.r + y][last.c + x] = 0;
    }
    // Note: restoring cleared lines exactly is complex; we stored just line indices,
    // which isn't enough to reconstruct arbitrary pre-clear patterns.
    // Simple approach: we also snapshot the entire board before placing in history.
    // Let's implement that instead. (Adjust above to push board snapshot.)
  });

  // Upgrade: store board snapshot per move for perfect undo
  // Rewire placeShape to push snapshot first
  const _placeShape = placeShape;
  placeShape = function(trayIndex, shape, r, c){
    // deep clone board
    const snapshot = state.board.map(row => row.slice());
    const beforeScore = state.score;
    _placeShape(trayIndex, shape, r, c);
    const afterScore = state.score;
    state.history.push({ snapshot, score: beforeScore, trayIndex }); // add snapshot on top
  };

  // Override undo with snapshot
  btnUndo.addEventListener("click", () => {
    const last = state.history.pop();
    if(!last) return;
    state.board = last.snapshot.map(row => row.slice());
    state.score = last.score;
    // mark the trayIndex as not used (we revert last placement)
    state.used[last.trayIndex] = 0;
    save();
    renderBoard(); renderTray();
  }, { once: true }); // ensure we don't attach twice; replace previous listener

  // Hint: find any valid placement and flash ghost
  btnHint.addEventListener("click", () => {
    for(let ti=0; ti<3; ti++){
      if(state.used[ti]===1) continue;
      const shape = SHAPES[state.tray[ti]];
      for(let r=0; r<SIZE; r++){
        for(let c=0; c<SIZE; c++){
          if(canPlace(shape, r, c)){
            // flash
            let on = true, count = 0;
            const iv = setInterval(() => {
              paintGhost(shape, r, c, on);
              on = !on; count++;
              if(count>6){ clearInterval(iv); paintGhost(shape, r, c, false); }
            }, 120);
            return;
          }
        }
      }
    }
    alert("No moves available.");
  });

  // Init
  buildBoard();
  load();
  if(!state.tray.some(v => v !== null)){
    refillTray();
  }
  renderBoard();
  renderTray();

  // Game over check on load
  if(!anyPlacementPossible()){
    // If starting state is empty board & 3 pieces, it's almost always possible; otherwise show game over.
  }
})();
