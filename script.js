/* ACO visualization on a canvas with graph-paper background drawn into the canvas.
   This file is self-contained (no external libs). It implements:
   - drawing a tiled graph-paper pattern into the canvas
   - basic ACO (Ant System) loop (visual & simplified)
   - interactive city placement and controls
*/

/* ====== Helpers & UI bindings ====== */
const $ = id => document.getElementById(id);
const canvas = $('canvas') || document.getElementById('canvas');
const ctx = canvas.getContext('2d', {alpha: false}); // non-transparent for crisp pattern
const startBtn = $('start'), pauseBtn = $('pause'), resetBtn = $('reset'), randomBtn = $('random');
const alphaRange = $('alpha'), betaRange = $('beta'), rhoRange = $('rho'), antsRange = $('ants'), speedRange = $('speed');
const alphaVal = $('alphaVal'), betaVal = $('betaVal'), rhoVal = $('rhoVal'), antsVal = $('antsVal'), speedVal = $('speedVal');
const iterEl = $('iter'), bestEl = $('best');

let dpr = Math.max(1, window.devicePixelRatio || 1);
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  drawGraphPaperOnCanvas(); // redraw pattern on resize
  redrawAll(); // redraw overlay visuals
}
window.addEventListener('resize', resizeCanvas);

/* slider display updates */
alphaRange.addEventListener('input', ()=> alphaVal.textContent = alphaRange.value);
betaRange.addEventListener('input', ()=> betaVal.textContent = betaRange.value);
rhoRange.addEventListener('input', ()=> rhoVal.textContent = rhoRange.value);
antsRange.addEventListener('input', ()=> antsVal.textContent = antsRange.value);
speedRange.addEventListener('input', ()=> speedVal.textContent = speedRange.value + 'x');

/* ====== Graph-paper drawing inside canvas ====== */
function drawGraphPaperOnCanvas() {
  // draw a repeating tile to an offscreen canvas, then fill canvas with pattern
  const tileSize = 90;         // major cell size
  const dotSpacing = 18;       // small spacing (dots)
  const tile = document.createElement('canvas');
  tile.width = tileSize; tile.height = tileSize;
  const t = tile.getContext('2d');

  // warm paper base
  t.fillStyle = '#f9fbfb';
  t.fillRect(0,0,tileSize,tileSize);

  // fine dots
  t.fillStyle = 'rgba(0,0,0,0.10)';
  const dotR = 0.9;
  for(let x=dotSpacing/2; x<tileSize; x+=dotSpacing){
    for(let y=dotSpacing/2; y<tileSize; y+=dotSpacing){
      t.beginPath(); t.arc(x + 0.2, y + 0.2, dotR, 0, Math.PI*2); t.fill();
    }
  }

  // thin grid lines
  t.strokeStyle = 'rgba(0,0,0,0.055)';
  t.lineWidth = 1;
  for(let p=0;p<=tileSize;p+=dotSpacing){
    t.beginPath(); t.moveTo(0.5, p+0.5); t.lineTo(tileSize+0.5, p+0.5); t.stroke();
    t.beginPath(); t.moveTo(p+0.5, 0.5); t.lineTo(p+0.5, tileSize+0.5); t.stroke();
  }

  // darker major border lines (frame the tile to give graph-paper feel)
  t.strokeStyle = 'rgba(0,0,0,0.12)';
  t.lineWidth = 1.4;
  t.beginPath(); t.moveTo(0.5,0.5); t.lineTo(tileSize+0.5,0.5); t.moveTo(0.5,tileSize+0.5); t.lineTo(tileSize+0.5,tileSize+0.5);
  t.moveTo(0.5,0.5); t.lineTo(0.5,tileSize+0.5); t.moveTo(tileSize+0.5,0.5); t.lineTo(tileSize+0.5,tileSize+0.5); t.stroke();

  // create pattern and fill main canvas
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(0,0, canvas.width/dpr, canvas.height/dpr);
  ctx.restore();
}

/* ====== Simple ACO model + visuals ====== */
let cities = []; // {x,y}
let pher = {};   // edge key -> pheromone value
let running = false, iter = 0, bestDist = Infinity, bestTour = null;
let animId = null;

function resetModel() {
  running = false;
  cancelAnimationFrame(animId);
  iter = 0; bestDist = Infinity; bestTour = null;
  pher = {};
  iterEl.textContent = '0'; bestEl.textContent = '—';
  drawGraphPaperOnCanvas(); redrawAll();
}

function randomizeCities(n=14) {
  cities = [];
  const pad = 32;
  const W = canvas.clientWidth - pad*2;
  const H = canvas.clientHeight - pad*2;
  for(let i=0;i<n;i++){
    cities.push({x: pad + Math.random()*W, y: pad + Math.random()*H});
  }
  initPheromones();
  drawGraphPaperOnCanvas(); redrawAll();
}

function initPheromones() {
  pher = {};
  for(let i=0;i<cities.length;i++){
    for(let j=i+1;j<cities.length;j++){
      pher[edgeKey(i,j)] = 1.0;
    }
  }
}

function edgeKey(a,b){ return a<b?`${a}-${b}`:`${b}-${a}`; }
function distance(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

/* run one ACO iteration (ant system, simplified & synchronous) */
function runIteration() {
  if(cities.length < 2) return;
  const params = {
    alpha: parseFloat(alphaRange.value),
    beta: parseFloat(betaRange.value),
    rho: parseFloat(rhoRange.value),
    ants: parseInt(antsRange.value),
  };

  const n = cities.length;
  const tours = [], tourD = [];

  for(let k=0;k<params.ants;k++){
    const start = Math.floor(Math.random()*n);
    const visited = new Set([start]);
    const tour = [start];
    let cur = start;
    while(visited.size < n){
      // compute probabilities
      const probs = [];
      let denom = 0;
      for(let j=0;j<n;j++){
        if(visited.has(j)) continue;
        const key = edgeKey(cur,j);
        const tau = Math.max(pher[key]||0.0001, 1e-6);
        const eta = 1 / (distance(cities[cur], cities[j]) + 1e-6);
        const val = Math.pow(tau, params.alpha) * Math.pow(eta, params.beta);
        probs.push({j, val}); denom += val;
      }
      // roulette
      let r = Math.random() * denom;
      let chosen = probs[0].j;
      for(const p of probs){
        r -= p.val;
        if(r <= 0){ chosen = p.j; break; }
      }
      visited.add(chosen); tour.push(chosen); cur = chosen;
    }
    tour.push(start);
    // distance
    let D=0; for(let t=0;t<tour.length-1;t++) D += distance(cities[tour[t]], cities[tour[t+1]]);
    tours.push(tour); tourD.push(D);
  }

  // evaporation
  for(const k in pher) pher[k] *= (1 - params.rho);

  // deposit
  for(let a=0;a<tours.length;a++){
    const t = tours[a], D = tourD[a];
    const delta = 1 / (D + 1e-6);
    for(let i=0;i<t.length-1;i++){
      const k = edgeKey(t[i], t[i+1]);
      pher[k] = (pher[k] || 0) + delta;
    }
    if(D < bestDist){ bestDist = D; bestTour = t.slice(); bestEl.textContent = bestDist.toFixed(2); }
  }

  iter++; iterEl.textContent = iter;
  // redraw pheromone-weighted edges
  redrawAll();
}

/* ====== Drawing primitives (over pattern) ====== */
function redrawAll(){
  // pattern already in canvas background; clear overlay by redrawing pattern then drawing
  drawGraphPaperOnCanvas();

  // draw pheromone edges under cities
  drawEdges();

  // draw cities on top
  drawCities();

  // optionally draw best tour highlight
  if(bestTour) drawTour(bestTour, 'rgba(200,40,40,0.9)', 3);
}

function drawEdges(){
  for(let i=0;i<cities.length;i++){
    for(let j=i+1;j<cities.length;j++){
      const k = edgeKey(i,j);
      const p = Math.max(pher[k]||0, 0);
      // map pheromone to alpha/width
      const alpha = Math.min(0.9, 0.06 + Math.tanh(p)*0.85);
      const w = 1 + Math.tanh(p)*4.5;
      const a = cities[i], b = cities[j];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(30,30,30,${alpha})`;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
}

function drawCities(){
  for(const c of cities){
    // outer dashed-like ring (draw small dashes by multiple arcs)
    ctx.beginPath();
    ctx.fillStyle = '#ffcc4d';
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.lineWidth = 2;
    ctx.arc(c.x, c.y, 7, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();

    // small central white spot
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(c.x-1.5, c.y-1.2, 2.6, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawTour(tour, color, lineW=2.8){
  if(!tour) return;
  ctx.beginPath();
  for(let i=0;i<tour.length-1;i++){
    const a = cities[tour[i]], b = cities[tour[i+1]];
    if(i===0) ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/* ====== Animation loop (controls speed) ====== */
let lastTick = 0;
function animate(time) {
  if(!running){ animId = null; return; }
  const speed = parseFloat(speedRange.value);
  const msPerIter = 600 / Math.max(0.25, speed); // controls iteration frequency
  if(time - lastTick >= msPerIter){
    lastTick = time;
    // run one iteration (or more if speed > 1)
    runIteration();
  }
  // animate ants along best tour visually (lightweight)
  if(bestTour) drawTour(bestTour, 'rgba(30,120,200,0.2)', 6); // soft highlight
  animId = requestAnimationFrame(animate);
}

/* ====== Interaction: clicking canvas to add/remove cities ====== */
canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left);
  const y = (ev.clientY - rect.top);
  // if clicking near an existing city, remove it
  for(let i=cities.length-1;i>=0;i--){
    const c = cities[i];
    if(Math.hypot(c.x - x, c.y - y) < 10){ cities.splice(i,1); initPheromones(); redrawAll(); return; }
  }
  // otherwise add
  cities.push({x,y}); initPheromones(); redrawAll();
});

/* ====== UI wiring ====== */
startBtn.addEventListener('click', ()=> {
  if(cities.length < 2) return alert('Add at least 2 cities');
  if(!running){
    running = true; lastTick = performance.now(); animId = requestAnimationFrame(animate);
  }
});
pauseBtn.addEventListener('click', ()=> { running = false; });
resetBtn.addEventListener('click', ()=> { resetModel(); randomizeCities(12); });
randomBtn.addEventListener('click', ()=> { randomizeCities(12); });

/* init */
(function init(){
  // set canvas size to computed CSS size
  resizeCanvas();
  // seed some cities
  randomizeCities(12);
  // show current slider values
  alphaVal.textContent = alphaRange.value;
  betaVal.textContent = betaRange.value;
  rhoVal.textContent = rhoRange.value;
  antsVal.textContent = antsRange.value;
  speedVal.textContent = speedRange.value + 'x';
})();
