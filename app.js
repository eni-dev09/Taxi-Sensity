/* ═══════════════════════════════════════════════════════════
   TAXI DOWNTOWN · Script principal
   ═══════════════════════════════════════════════════════════ */

(function(){
'use strict';

/* ═══ CONFIG WORKER ═══ */
var WORKER_URL = 'https://taxi-downtown.TON-PSEUDO.workers.dev';
var WORKER_CONFIGURED = !!(WORKER_URL && WORKER_URL.indexOf('https://') === 0 && WORKER_URL.indexOf('TON-PSEUDO') === -1);

/* ═══ CODE ADMIN OBFUSQUÉ (XOR 0x1F sur "DOWNTOWN26") ═══ */
var _K = [0x5b,0x50,0x48,0x51,0x4b,0x50,0x48,0x51,0x2d,0x29];
var ADMIN_CODE = String.fromCharCode.apply(null, _K.map(function(c){ return c ^ 0x1F; }));

var $ = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
var body = document.body;

/* ═══ UTILS ═══ */
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
  });
}
function fmt(n){
  try { return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' $'; }
  catch(e){ return Math.round(n) + ' $'; }
}
function initials(s){
  return String(s || '?').split(/\s+/).map(function(w){ return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
}
function fmtDate(ts){
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  catch(e){ return '—'; }
}
function ago(ts){
  if (!ts) return 'Jamais';
  var d = Date.now() - ts;
  if (d < 60000) return "à l'instant";
  if (d < 3600000) return 'il y a ' + Math.floor(d/60000) + ' min';
  if (d < 86400000) return 'il y a ' + Math.floor(d/3600000) + ' h';
  return 'il y a ' + Math.floor(d/86400000) + ' j';
}
function safeKey(k){
  return k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && typeof k === 'string' && k.length <= 20;
}
function isValidPlate(plate){
  return /^[A-Z0-9]{4,8}$/.test(plate);
}

/* ═══ STORAGE ═══ */
var LS = {
  get: function(k, def){ try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch(e){ return def; } },
  set: function(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};

/* ═══ STATE ═══ */
var STATE = LS.get('td-state', null) || {
  invoices: [],
  employees: [],
  vehicles: [],
  assignments: {},
  history: [],
  baseOverrides: {},
  updatedAt: null
};
['invoices','employees','vehicles','history'].forEach(function(k){
  if (!Array.isArray(STATE[k])) STATE[k] = [];
});
if (!STATE.assignments || typeof STATE.assignments !== 'object') STATE.assignments = {};
if (!STATE.baseOverrides || typeof STATE.baseOverrides !== 'object') STATE.baseOverrides = {};
/* ═══ SAUVEGARDES AUTOMATIQUES ═══ */
var BACKUPS_KEY = 'td-backups';
var MAX_BACKUPS = 10;
var _previousSnapshot = null;
var _skipBackupOnce = false;

function getBackups(){
  try { return JSON.parse(localStorage.getItem(BACKUPS_KEY) || '[]'); }
  catch(e){ return []; }
}
function setBackups(arr){
  try { localStorage.setItem(BACKUPS_KEY, JSON.stringify(arr)); } catch(e){}
}
function captureSnapshot(){
  return {
    invoices: JSON.parse(JSON.stringify(STATE.invoices || [])),
    employees: JSON.parse(JSON.stringify(STATE.employees || [])),
    vehicles: JSON.parse(JSON.stringify(STATE.vehicles || [])),
    assignments: JSON.parse(JSON.stringify(STATE.assignments || {})),
    history: JSON.parse(JSON.stringify(STATE.history || [])),
    baseOverrides: JSON.parse(JSON.stringify(STATE.baseOverrides || {}))
  };
}
function createBackup(label){
  var current = captureSnapshot();
  // Évite les backups identiques consécutifs
  if (_previousSnapshot){
    var a = JSON.stringify(_previousSnapshot);
    var b = JSON.stringify(current);
    if (a === b) return false;
    var backups = getBackups();
    backups.unshift({
      id: 'bak-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      label: label || 'Modification',
      snapshot: _previousSnapshot
    });
    backups = backups.slice(0, MAX_BACKUPS);
    setBackups(backups);
  }
  _previousSnapshot = current;
  return true;
}
function restoreBackup(id){
  var backups = getBackups();
  var b = backups.filter(function(x){ return x.id === id; })[0];
  if (!b) return false;
  _skipBackupOnce = true;
  STATE.invoices = JSON.parse(JSON.stringify(b.snapshot.invoices || []));
  STATE.employees = JSON.parse(JSON.stringify(b.snapshot.employees || []));
  STATE.vehicles = JSON.parse(JSON.stringify(b.snapshot.vehicles || []));
  STATE.assignments = JSON.parse(JSON.stringify(b.snapshot.assignments || {}));
  STATE.history = JSON.parse(JSON.stringify(b.snapshot.history || []));
  STATE.baseOverrides = JSON.parse(JSON.stringify(b.snapshot.baseOverrides || {}));
  STATE.updatedAt = Date.now();
  STATE.history.unshift({ action: '🔄 Restauration · ' + b.label, ts: Date.now(), by: 'Direction' });
  applyBaseOverrides();
  saveState();
  _previousSnapshot = captureSnapshot();
  return true;
}
function deleteBackup(id){
  var backups = getBackups().filter(function(x){ return x.id !== id; });
  setBackups(backups);
}
function clearAllBackups(){
  setBackups([]);
}
/* ═══ SYNC ═══ */
var SYNC = {
  setState: function(state, label){
    var el = document.getElementById('hudSync');
    if (!el) return;
    el.dataset.state = state;
    el.textContent = label || (state === 'ok' ? 'Synchro' : state === 'pending' ? 'Envoi...' : state === 'error' ? 'Hors-ligne' : 'Local');
  },
  load: function(){
    if (!WORKER_CONFIGURED){ this.setState('idle', 'Local'); return Promise.resolve(null); }
    this.setState('pending', 'Chargement...');
    var self = this;
    var ctrl = window.AbortController ? new AbortController() : null;
    var tid = setTimeout(function(){ if (ctrl) ctrl.abort(); }, 5000);
    return fetch(WORKER_URL + '/data', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function(r){ clearTimeout(tid); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data){ body.classList.remove('offline'); self.setState('ok', 'Synchro'); return data; })
      .catch(function(err){
        clearTimeout(tid);
        console.warn('[Sync] Load:', err);
        self.setState('error', 'Hors-ligne');
        if (!navigator.onLine) body.classList.add('offline');
        return null;
      });
  },
  save: function(payload, attempt){
    attempt = attempt || 1;
    if (!WORKER_CONFIGURED){ this.setState('idle', 'Local'); return Promise.resolve(false); }
    var self = this;
    var max = 3;
    this.setState('pending', attempt > 1 ? 'Envoi ' + attempt + '/' + max : 'Envoi...');
    return fetch(WORKER_URL + '/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Code': ADMIN_CODE },
      body: JSON.stringify(payload)
    }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      body.classList.remove('offline');
      self.setState('ok', 'Synchro');
      return true;
    }).catch(function(err){
      console.warn('[Sync] Save (' + attempt + '):', err);
      if (attempt < max){
        return new Promise(function(res){ setTimeout(res, Math.pow(2, attempt) * 500); })
          .then(function(){ return self.save(payload, attempt + 1); });
      }
      self.setState('error', 'Erreur sync');
      if (!navigator.onLine) body.classList.add('offline');
      return false;
    });
  },
  notify: function(msg){
    if (!WORKER_CONFIGURED) return Promise.resolve();
    return fetch(WORKER_URL + '/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Code': ADMIN_CODE },
      body: JSON.stringify({ message: msg })
    }).catch(function(){});
  }
};

/* ═══ SAVE avec debounce ═══ */
var _saveDebounce = null;
function saveState(){
  STATE.updatedAt = Date.now();
  LS.set('td-state', STATE);
  if (_saveDebounce) clearTimeout(_saveDebounce);
  _saveDebounce = setTimeout(function(){
    if (!WORKER_CONFIGURED) return;
    SYNC.save({
      invoices: STATE.invoices,
      employees: STATE.employees,
      vehicles: STATE.vehicles,
      assignments: STATE.assignments,
      history: STATE.history,
      baseOverrides: STATE.baseOverrides,
      updatedAt: STATE.updatedAt
    });
  }, 400);
}

function logAction(action, by){
  STATE.history.unshift({ action: action, ts: Date.now(), by: by || 'Direction' });
  STATE.history = STATE.history.slice(0, 200);
}

/* ═══ EMPLOYÉS DE BASE ═══ */
var BASE_EMPLOYEES = [
  { id:'base-1', name:'Jimy Smith', role:'Directeur', hiredAt: Date.now() - 30*86400000 },
  { id:'base-2', name:'Sam Le Gros', role:'Directeur Adjoint', hiredAt: Date.now() - 30*86400000 },
  { id:'base-3', name:'Romeo Cali', role:'Responsable CM', hiredAt: Date.now() - 30*86400000 },
  { id:'base-4', name:'Bob Musar', role:'Novice', hiredAt: Date.now() - 15*86400000 },
  { id:'base-5', name:'Noah Dupont', role:'Novice', hiredAt: Date.now() - 15*86400000 },
  { id:'base-6', name:'Luca Safi', role:'Chauffeur Confirmé', hiredAt: Date.now() - 20*86400000 },
  { id:'base-7', name:'Maxime Rivière', role:'Novice', hiredAt: Date.now() - 10*86400000 },
  { id:'base-8', name:'Sofia Fernandez', role:'Chauffeur Senior', hiredAt: Date.now() - 25*86400000 },
  { id:'base-9', name:'Arthur Bendal', role:'Novice', hiredAt: Date.now() - 8*86400000 },
  { id:'base-10', name:'Sacha Mermoud', role:'Novice', hiredAt: Date.now() - 5*86400000 },
  { id:'base-11', name:'Theo Roberto', role:'Novice', hiredAt: Date.now() - 5*86400000 }
];

/* ═══ FLOTTE DE BASE ═══ */
var BASE_FLEET = [
  { id:'td-001', model:'Taxi', plate:'RW4968NN', ref:'TD-001', cat:'standard' },
  { id:'td-002', model:'Taxi', plate:'XV7016ED', ref:'TD-002', cat:'standard' },
  { id:'td-003', model:'Taxi', plate:'QZ1841HW', ref:'TD-003', cat:'standard' },
  { id:'td-004', model:'Taxi', plate:'KS5711ZT', ref:'TD-004', cat:'standard' },
  { id:'td-005', model:'Taxi', plate:'CK9589YD', ref:'TD-005', cat:'standard' },
  { id:'td-006', model:'Taxi Argento 7F', plate:'YP7603HL', ref:'TD-006', cat:'argento' },
  { id:'td-007', model:'Taxi Eon', plate:'CW6683ZV', ref:'TD-007', cat:'eon' },
  { id:'td-008', model:'Taxi Starlight', plate:'GW6000KN', ref:'TD-008', cat:'starlight' },
  { id:'td-009', model:'Taxi Stanier LE', plate:'RM1393GV', ref:'TD-009', cat:'stanier' },
  { id:'td-010', model:'Taxi Starlight', plate:'WS8791NL', ref:'TD-010', cat:'starlight' },
  { id:'td-011', model:'Taxi Starlight', plate:'NJ1919MD', ref:'TD-011', cat:'starlight' },
  { id:'td-012', model:'Taxi Argento 7F', plate:'CJ8249YD', ref:'TD-012', cat:'argento' },
  { id:'td-013', model:'Taxi Eon', plate:'BX5408WL', ref:'TD-013', cat:'eon' },
  { id:'td-014', model:'Taxi Eon', plate:'FD3839EL', ref:'TD-014', cat:'eon' },
  { id:'td-015', model:'Taxi', plate:'BP5989FB', ref:'TD-015', cat:'standard' },
  { id:'td-016', model:'Taxi Argento 7F', plate:'LX4255HP', ref:'TD-016', cat:'argento' }
];

var CATS = { standard:'Standard', eon:'Eon', starlight:'Starlight', stanier:'Stanier LE', argento:'Argento 7F', custom:'Personnalisé' };
var ROLES = ['Novice','Chauffeur Confirmé','Chauffeur Senior','Chef de service','Superviseur','Responsable CM','Directeur Adjoint','Directeur'];
var HIGH_ROLES = ['Directeur','Directeur Adjoint','Responsable CM','Superviseur','Chef de service'];

var TARIFS = [
  ['En ville','1 000 $ / km'],
  ['Hors ville','1 500 $ / km'],
  ['Cayo Perico','1 750 $ / km'],
  ['Nouveaux arrivants','-50 %']
];

var HERO_LINES = [
  { veh:'Taxi Downtown', price:'' },
  { veh:'Service 24 h / 24', price:'Tangerine Street · Los Santos' },
  { veh:"Partenariat exclusif", price:'+80 $ dans ta poche' },
  { veh:"Primes hebdomadaires", price:'20 000 $ · 15 000 $ · 10 000 $' },
  { veh:"Rejoins l'équipe", price:'Recrutement ouvert' }
];
var HERO_CATS = ['Accueil','Service',"Horny's",'Primes','Recrutement'];

/* ═══ SELECTORS ═══ */
function applyBaseOverrides(){
  Object.keys(STATE.baseOverrides).forEach(function(id){
    var b = BASE_EMPLOYEES.filter(function(e){ return e.id === id; })[0];
    if (b){
      var ov = STATE.baseOverrides[id];
      Object.keys(ov).forEach(function(k){ b[k] = ov[k]; });
    }
  });
}
function getAllEmployees(){ return BASE_EMPLOYEES.concat(STATE.employees); }
function getActiveEmployees(){ return getAllEmployees().filter(function(e){ return !e.firedAt; }); }
function getFiredEmployees(){ return getAllEmployees().filter(function(e){ return e.firedAt; }); }
function getFleet(){
  return BASE_FLEET.concat(STATE.vehicles.map(function(v){
    return { id: v.id, model: v.model, plate: v.plate, ref: v.ref || 'TD-NEW', cat: 'custom' };
  }));
}
function findEmployeeById(id){
  return getAllEmployees().filter(function(e){ return e.id === id; })[0] || null;
}
function findEmployeeByName(name){
  return getAllEmployees().filter(function(e){ return e.name === name; })[0] || null;
}
function findVehicleByPlate(plate){
  return getFleet().filter(function(v){ return v.plate === plate; })[0] || null;
}
function getVehicleForEmployee(name){
  var found = null;
  Object.keys(STATE.assignments).forEach(function(plate){
    if (STATE.assignments[plate] === name) found = plate;
  });
  return found;
}
function getEmployeeForVehicle(plate){ return STATE.assignments[plate] || null; }

function updateEmployee(id, patch){
  var base = BASE_EMPLOYEES.filter(function(e){ return e.id === id; })[0];
  if (base){
    STATE.baseOverrides[id] = Object.assign({}, STATE.baseOverrides[id] || {}, patch);
    applyBaseOverrides();
    return true;
  }
  var custom = STATE.employees.filter(function(e){ return e.id === id; })[0];
  if (custom){
    Object.keys(patch).forEach(function(k){ custom[k] = patch[k]; });
    return true;
  }
  return false;
}
function addEmployee(name, role){
  var id = 'emp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  STATE.employees.push({ id: id, name: name, role: role, hiredAt: Date.now() });
  return id;
}
function fireEmployee(id, reason){ return updateEmployee(id, { firedAt: Date.now(), firedReason: reason || 'Non spécifié' }); }
function rehireEmployee(id){ return updateEmployee(id, { firedAt: null, firedReason: null }); }
function changeRole(id, newRole){ return updateEmployee(id, { role: newRole }); }
function sanctionEmployee(id, level, reason){
  var e = findEmployeeById(id);
  if (!e) return false;
  var sanctions = (e.sanctions || []).slice();
  sanctions.push({ level: level, reason: reason || '', ts: Date.now() });
  return updateEmployee(id, { sanctions: sanctions });
}
function assignVehicle(plate, name){
  if (!safeKey(plate)) return;
  Object.keys(STATE.assignments).forEach(function(p){
    if (STATE.assignments[p] === name) delete STATE.assignments[p];
  });
  STATE.assignments[plate] = name;
}
function unassignVehicle(plate){ if (safeKey(plate)) delete STATE.assignments[plate]; }

/* ═══ TOASTS ═══ */
function toast(type, title, msg, duration){
  duration = duration || 3500;
  var stack = $('#toastStack');
  if (!stack) return;
  while (stack.children.length >= 5) stack.removeChild(stack.firstChild);
  var icons = { ok:'✓', err:'✕', info:'i', warn:'!' };
  var el = document.createElement('div');
  el.className = 'toast toast--' + type;
  el.innerHTML = '<span class="toast__icon">' + (icons[type] || '·') + '</span>' +
    '<div class="toast__body">' + (title ? '<b>' + esc(title) + '</b>' : '') +
    (msg ? '<span>' + esc(msg) + '</span>' : '') + '</div>' +
    '<button class="toast__close" type="button">✕</button>';
  stack.appendChild(el);
  requestAnimationFrame(function(){ el.classList.add('in'); });
  function close(){
    el.classList.add('out');
    el.classList.remove('in');
    setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  }
  el.querySelector('.toast__close').addEventListener('click', close);
  if (duration > 0) setTimeout(close, duration);
}

/* ═══ MODAL ═══ */
function openModal(html, opts){
  opts = opts || {};
  var root = $('#modalRoot');
  var wrapper = document.createElement('div');
  wrapper.className = 'modal ' + (opts.className || '');
  wrapper.innerHTML = '<div class="modal__c ' + (opts.small ? 'modal__c--sm' : '') + '">' + html + '</div>';
  root.appendChild(wrapper);
  var escFn = function(e){
    if (e.key === 'Escape' && wrapper.parentNode){
      wrapper.parentNode.removeChild(wrapper);
      document.removeEventListener('keydown', escFn);
    }
  };
  document.addEventListener('keydown', escFn);
  return wrapper;
}
function closeTopModal(){
  var root = $('#modalRoot');
  if (root && root.lastChild) root.removeChild(root.lastChild);
}
function showConfirm(title, text, opts){
  opts = opts || {};
  return new Promise(function(resolve){
    var html = '<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
      '<div class="actions">' +
        '<button type="button" class="btn" data-act="cancel">Annuler</button>' +
        '<button type="button" class="btn ' + (opts.danger !== false ? 'btn--danger' : 'btn--primary') + '" data-act="ok">' +
          esc(opts.okLabel || 'Confirmer') + '</button></div>';
    var m = openModal(html, { small: true, className: 'modal-confirm' });
    var done = false;
    function finish(result){
      if (done) return;
      done = true;
      if (m.parentNode) m.parentNode.removeChild(m);
      resolve(result);
    }
    m.addEventListener('click', function(e){
      if (e.target === m) return finish(false);
      var act = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!act) return;
      finish(act.dataset.act === 'ok');
    });
  });
}

/* ═══ SVG TAXI ═══ */
var TAXI_SVG = '<svg viewBox="0 0 200 90" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/></linearGradient><linearGradient id="winGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0d5ff"/><stop offset="1" stop-color="#4c1d95"/></linearGradient></defs><ellipse cx="100" cy="80" rx="82" ry="4" fill="#a78bfa" opacity=".3"/><path d="M30 62 Q30 48 46 44 L64 26 Q72 20 84 20 L118 20 Q130 20 138 26 L156 44 Q172 48 172 62 L172 68 Q172 72 168 72 L32 72 Q28 72 28 68 Z" fill="url(#bodyGrad)"/><rect x="86" y="8" width="28" height="10" rx="3" fill="#0a0a0c"/><rect x="90" y="10" width="20" height="6" rx="2" fill="#f5f5f7"/><path d="M74 30 L88 24 L88 42 L68 42 Z" fill="url(#winGrad)"/><path d="M94 24 L114 24 L114 42 L94 42 Z" fill="url(#winGrad)"/><path d="M120 24 L132 30 L132 42 L120 42 Z" fill="url(#winGrad)"/><circle cx="34" cy="58" r="4" fill="#f5f5f7"/><circle cx="166" cy="58" r="4" fill="#f5f5f7"/><circle cx="60" cy="72" r="11" fill="#050506"/><circle cx="60" cy="72" r="5" fill="#2a2a30"/><circle cx="140" cy="72" r="11" fill="#050506"/><circle cx="140" cy="72" r="5" fill="#2a2a30"/></svg>';

/* ═══ HERO ═══ */
var heroIdx = 0, heroTimer = null;
function prepareHeroLetters(){
  $$('.hero__title').forEach(function(t){
    var parts = (t.dataset.letters || '').split('|');
    function makeL(word, base){
      return word.split('').map(function(ch, i){
        return '<span class="letter" style="transition-delay:' + (base + i * 0.035) + 's">' +
          (ch === ' ' ? '&nbsp;' : esc(ch)) + '</span>';
      }).join('');
    }
    t.innerHTML = '<span class="w"><span>' + makeL(parts[0] || '', 0) + '</span></span>' +
      '<span class="w"><span>' + makeL(parts[1] || '', 0.15 + (parts[0] || '').length * 0.035) + '</span></span>';
  });
}
function renderHeroPager(){
  var p = $('#heroPager'); if (!p) return;
  $$('#heroPager > i').forEach(function(el){ el.remove(); });
  var ticks = HERO_LINES.map(function(_, i){
    return '<i style="left:' + (i / (HERO_LINES.length - 1)) * 100 + '%"></i>';
  }).join('');
  p.insertAdjacentHTML('afterbegin', ticks);
}
function setHero(i){
  heroIdx = ((i % HERO_LINES.length) + HERO_LINES.length) % HERO_LINES.length;
  $$('.hero__title').forEach(function(el, idx){ el.classList.toggle('is-active', idx === heroIdx); });
  var line = HERO_LINES[heroIdx];
  var v = $('#heroVeh'); if (v) v.textContent = line.veh;
  var pr = $('#heroPrice');
  if (pr){
    if (heroIdx === 0){
      var f = getFleet().length, e = getActiveEmployees().length;
      pr.textContent = f + ' véhicules · ' + e + ' chauffeurs';
    } else {
      pr.textContent = line.price;
    }
  }
  var d = $('#heroPagerDot'); if (d) d.style.left = ((heroIdx / (HERO_LINES.length - 1)) * 100) + '%';
  var hi = $('#hudIdx'); if (hi) hi.textContent = String(heroIdx + 1).padStart(2, '0');
  var hc = $('#hudCat'); if (hc) hc.textContent = HERO_CATS[heroIdx];
}
function nextHero(){ setHero(heroIdx + 1); }
function prevHero(){ setHero(heroIdx - 1); }
function stopHeroAuto(){ if (heroTimer){ clearInterval(heroTimer); heroTimer = null; } }
function startHeroAuto(){ stopHeroAuto(); heroTimer = setInterval(nextHero, 5200); }
function setupHero(){
  prepareHeroLetters(); renderHeroPager(); setHero(0); startHeroAuto();
  var prev = $('#heroPrev'), next = $('#heroNext');
  if (prev) prev.addEventListener('click', function(){ prevHero(); startHeroAuto(); });
  if (next) next.addEventListener('click', function(){ nextHero(); startHeroAuto(); });
  var pg = $('#heroPager');
  if (pg) pg.addEventListener('click', function(e){
    var r = pg.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHero(Math.round(ratio * (HERO_LINES.length - 1)));
  });
}

/* ═══ RENDER PUBLIC ═══ */
function renderHeroStats(){
  var fleet = getFleet();
  var hc = $('#hudCount'); if (hc) hc.textContent = fleet.length;
  var fc = $('#fleetCount'); if (fc) fc.textContent = fleet.length;
  var today = new Date(); today.setHours(0,0,0,0);
  var c = 0;
  STATE.invoices.forEach(function(inv){
    if (inv.date && inv.date >= today.getTime()) c += inv.count || 1;
  });
  var hd = $('#heroDay'); if (hd) hd.textContent = c + ' course' + (c > 1 ? 's' : '');
}

var activeCat = 'all', searchQuery = '';
function renderFleetFilters(){
  var wrap = $('#fleetFilters'); if (!wrap) return;
  var fleet = getFleet();
  var counts = {};
  fleet.forEach(function(v){ counts[v.cat] = (counts[v.cat] || 0) + 1; });
  var cats = [['all','Tous']].concat(Object.keys(counts).map(function(k){ return [k, CATS[k] || k]; }));
  wrap.innerHTML = cats.map(function(c){
    return '<button class="chip" type="button" data-cat="' + esc(c[0]) + '" aria-selected="' + (c[0] === activeCat) + '">' +
      esc(c[1]) + ' <small>' + (c[0] === 'all' ? fleet.length : counts[c[0]]) + '</small></button>';
  }).join('');
  wrap.querySelectorAll('.chip').forEach(function(btn){
    btn.addEventListener('click', function(){
      activeCat = btn.dataset.cat;
      wrap.querySelectorAll('.chip').forEach(function(b){ b.setAttribute('aria-selected', b === btn ? 'true' : 'false'); });
      renderFleet();
    });
  });
}

function renderFleet(){
  var grid = $('#fleetGrid'); if (!grid) return;
  var fleet = getFleet();
  var q = searchQuery.trim().toLowerCase();
  var filtered = activeCat === 'all' ? fleet : fleet.filter(function(v){ return v.cat === activeCat; });
  if (q) filtered = filtered.filter(function(v){
    if (v.model.toLowerCase().indexOf(q) !== -1) return true;
    if (v.plate.toLowerCase().indexOf(q) !== -1) return true;
    var d = getEmployeeForVehicle(v.plate);
    if (d && d.toLowerCase().indexOf(q) !== -1) return true;
    return false;
  });
  var title = $('#fleetTitle'); if (title) title.textContent = activeCat === 'all' ? 'Tous les véhicules' : (CATS[activeCat] || activeCat);
  var meta = $('#fleetMeta'); if (meta) meta.textContent = filtered.length + ' affiché' + (filtered.length > 1 ? 's' : '');
  var rc = $('#fleetResultCount'); if (rc) rc.textContent = filtered.length;
  if (!filtered.length){ grid.innerHTML = '<div class="vcard-empty">Aucun véhicule.</div>'; return; }
  grid.innerHTML = filtered.map(function(v){
    var driver = getEmployeeForVehicle(v.plate);
    var driverHTML = driver
      ? '<span class="vcard-driver"><span class="vcard-driver-av online">' + esc(initials(driver)) + '</span>' + esc(driver) + '</span>'
      : '<span class="vcard-driver unassigned">Non attribué</span>';
    return '<div class="vcard">' +
      '<div class="vcard-top"><span class="vcard-cat">' + esc(CATS[v.cat] || v.cat) + '</span><span class="vcard-num">' + esc(v.ref) + '</span></div>' +
      '<div class="vcard-media">' + TAXI_SVG + '</div>' +
      '<div class="vcard-name">' + esc(v.model) + '</div>' +
      '<span class="vcard-plate">' + esc(v.plate) + '</span>' + driverHTML + '</div>';
  }).join('');
}

function renderTeam(){
  var top = $('#teamTop'), rest = $('#teamRest');
  if (!top || !rest) return;
  var actives = getActiveEmployees();
  var direction = actives.filter(function(e){ return HIGH_ROLES.indexOf(e.role) !== -1; });
  var drivers = actives.filter(function(e){ return HIGH_ROLES.indexOf(e.role) === -1; });
  top.innerHTML = direction.map(function(e, i){
    return '<div class="tcard ' + (i === 0 ? 'highlight' : '') + '">' +
      '<span class="tcard__num">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<div class="tcard__role">' + esc(e.role) + '</div>' +
      '<h3 class="tcard__name">' + esc(e.name) + '</h3></div>';
  }).join('') || '<div class="tcard"><div class="tcard__role">Direction</div><h3 class="tcard__name">—</h3></div>';
  rest.innerHTML = drivers.map(function(e){
    var plate = getVehicleForEmployee(e.name);
    return '<div class="pcard">' +
      '<div class="pcard__av online">' + esc(initials(e.name)) + '</div>' +
      '<div class="pcard__info"><b>' + esc(e.name) + '</b><span>' + esc(e.role) + '</span>' +
      (plate ? '<span class="pcard__plate">' + esc(plate) + '</span>' : '') + '</div></div>';
  }).join('') || '<div class="pcard"><div class="pcard__info"><b>Aucun chauffeur</b><span>Recrutement ouvert</span></div></div>';
}

function renderTarifs(){
  var tb = $('#tarifBody'); if (!tb) return;
  tb.innerHTML = TARIFS.map(function(t){
    return '<tr><td>' + esc(t[0]) + '</td><td>' + esc(t[1]) + '</td></tr>';
  }).join('');
}

function renderAllPublic(){
  renderHeroStats();
  renderFleetFilters();
  renderFleet();
  renderTeam();
  renderTarifs();
  var hu = $('#hudUpdated'); if (hu) hu.textContent = ago(STATE.updatedAt);
}

/* ═══ ADMIN PANEL ═══ */
function buildAdminHTML(activeTab){
  activeTab = activeTab || 'vehicules';
  var tabs = [
    ['vehicules','Véhicules'],
    ['employes','Employés'],
    ['attributions','Attributions'],
    ['historique','Historique'],
    ['parametres','Paramètres']
  ];
  var tabsHTML = tabs.map(function(t){
    return '<button type="button" class="tab ' + (t[0] === activeTab ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('');
  return '<button class="modal__x" type="button" aria-label="Fermer" id="adminClose">✕</button>' +
    '<h2>Administration <small id="adminStats">—</small></h2>' +
    '<p class="intro">Gestion complète de la compagnie.</p>' +
    '<div class="tabs" id="adminTabs">' + tabsHTML + '</div>' +
    '<div class="panel" id="adminPanelRoot"></div>';
}

function renderAdminContent(tab){
  var root = $('#adminPanelRoot');
  if (!root) return;
  LS.set('td-admin-tab', tab);
  root.innerHTML = (function(){
    if (tab === 'vehicules') return buildPanelVehicules();
    if (tab === 'employes') return buildPanelEmployes();
    if (tab === 'attributions') return buildPanelAttributions();
    if (tab === 'historique') return buildPanelHistorique();
    if (tab === 'parametres') return buildPanelParametres();
    return '';
  })();
  bindPanelEvents(tab);
  updateAdminStats();
}

function updateAdminStats(){
  var el = $('#adminStats'); if (!el) return;
  var total = STATE.invoices.reduce(function(s, i){ return s + (i.amount || 0); }, 0);
  el.textContent = fmt(total) + ' · ' + getActiveEmployees().length + ' employés · ' + getFleet().length + ' véhicules';
}

/* ─── FACTURES ─── */
function buildPanelFactures(){
  var invoices = STATE.invoices;
  var total = invoices.reduce(function(s, i){ return s + (i.amount || 0); }, 0);
  var count = invoices.reduce(function(s, i){ return s + (i.count || 1); }, 0);
  var avg = invoices.length ? total / invoices.length : 0;
  var topDriver = '—';
  if (invoices.length){
    var stats = {};
    invoices.forEach(function(inv){ stats[inv.driver] = (stats[inv.driver] || 0) + (inv.amount || 0); });
    var entries = Object.keys(stats).filter(function(k){ return stats[k] > 0; });
    entries.sort(function(a, b){ return stats[b] - stats[a]; });
    if (entries[0]) topDriver = entries[0];
  }
  var empList = getActiveEmployees().map(function(e){ return e.name; });
  var listHTML = invoices.length
    ? invoices.slice().reverse().map(function(inv, ridx){
        var realIdx = invoices.length - 1 - ridx;
        return '<div class="item"><div class="item__av">' + esc(initials(inv.driver)) + '</div>' +
          '<div class="item__body"><b>' + esc(inv.driver) + '</b>' +
          '<small>' + fmtDate(inv.date) + ' · ' + inv.count + ' facture' + (inv.count > 1 ? 's' : '') + '</small></div>' +
          '<div class="item__amt">' + fmt(inv.amount) + '</div>' +
          '<div class="item__btns"><button type="button" class="item__btn item__btn--danger" data-del-invoice="' + realIdx + '">Supprimer</button></div></div>';
      }).join('')
    : '<div class="empty">Aucune facture</div>';
  return '<div class="stats">' +
      '<div class="stat"><small>CA total</small><b>' + total.toLocaleString('fr-FR') + ' $</b></div>' +
      '<div class="stat"><small>Factures</small><b>' + count + '</b></div>' +
      '<div class="stat"><small>Moyenne</small><b>' + Math.round(avg).toLocaleString('fr-FR') + ' $</b></div>' +
      '<div class="stat"><small>Top</small><b>' + esc(topDriver.split(' ')[0]) + '</b></div></div>' +
    '<div class="sec">Ajouter une facture</div>' +
    '<form class="form" id="addInvoiceForm">' +
      '<div class="row">' +
        '<label>Chauffeur<input type="text" id="invDriver" list="invDriverList" required placeholder="Nom"><datalist id="invDriverList">' +
          empList.map(function(n){ return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist></label>' +
        '<label>Nombre<input type="number" id="invCount" min="1" max="99" value="1" required></label></div>' +
      '<label>Montant ($)<input type="number" id="invAmount" min="1" max="1000000" step="1" required placeholder="1500"></label>' +
      '<div class="actions"><button type="submit" class="btn btn--primary">Ajouter</button></div></form>' +
    '<div class="sec">Toutes les factures <small id="invCountLabel">' + invoices.length + '</small></div>' +
    '<div class="filter"><input type="search" id="invSearch" placeholder="Rechercher un chauffeur..."></div>' +
    '<div class="list" id="invList">' + listHTML + '</div>' +
    '<div class="tools">' +
      '<button type="button" data-action="export-json">Exporter JSON</button>' +
      '<button type="button" data-action="export-csv">Exporter CSV</button>' +
      '<button type="button" data-action="print">Imprimer</button>' +
      '<button type="button" data-action="import">Importer</button>' +
      '<button type="button" class="danger" data-action="clear-invoices">Vider</button></div>';
}

/* ─── VÉHICULES ─── */
function buildPanelVehicules(){
  var fleet = getFleet();
  var listHTML = fleet.map(function(v){
    var isCustom = v.cat === 'custom';
    var driver = getEmployeeForVehicle(v.plate);
    return '<div class="item"><div class="item__av">' + esc(v.ref.split('-')[1] || '00') + '</div>' +
      '<div class="item__body"><b>' + esc(v.model) + '</b>' +
      '<small>' + esc(v.plate) + ' · ' + esc(CATS[v.cat] || v.cat) + (driver ? ' · ' + esc(driver) : '') + '</small></div>' +
      '<div class="item__meta">' + (isCustom ? 'Custom' : 'Base') + '</div>' +
      '<div class="item__btns">' + (isCustom ? '<button type="button" class="item__btn item__btn--danger" data-del-vehicle="' + esc(v.id) + '">Suppr.</button>' : '') + '</div></div>';
  }).join('');
  return '<div class="sec">Ajouter un véhicule</div>' +
    '<form class="form" id="addVehicleForm">' +
      '<div class="row">' +
        '<label>Modèle<input type="text" id="vehModel" required placeholder="Taxi Eon" maxlength="40"></label>' +
        '<label>Plaque<input type="text" id="vehPlate" required maxlength="8" style="text-transform:uppercase" placeholder="AB1234CD"></label></div>' +
      '<div class="actions"><button type="submit" class="btn btn--primary">Ajouter</button></div></form>' +
    '<div class="sec">Flotte complète <small>' + fleet.length + ' véhicules</small></div>' +
    '<div class="list">' + listHTML + '</div>';
}

/* ─── EMPLOYÉS ─── */
function buildPanelEmployes(){
  var actives = getActiveEmployees();
  var fired = getFiredEmployees();
  function card(e){
    var isFired = !!e.firedAt;
    var plate = getVehicleForEmployee(e.name);
    var sanctions = e.sanctions || [];
    var badges = sanctions.slice(-3).map(function(s){
      var cls = s.level === 3 ? 'tag--red' : 'tag--warn';
      return '<span class="tag ' + cls + '">Avert. ' + s.level + '</span>';
    }).join(' ');
    return '<div class="item ' + (isFired ? 'item--fired' : '') + '">' +
      '<div class="item__av">' + esc(initials(e.name)) + '</div>' +
      '<div class="item__body"><b>' + esc(e.name) + '</b>' +
        '<small>' + esc(e.role) + (plate ? ' · ' + esc(plate) : ' · aucun véhicule') + '</small>' +
        (isFired ? '<span class="tag tag--red">Viré · ' + esc(e.firedReason || 'N/A') + '</span>' : '') +
        (badges ? ' ' + badges : '') + '</div>' +
      '<div class="item__meta">' + (e.hiredAt ? ago(e.hiredAt) : '—') + '</div>' +
      '<div class="item__btns">' +
        (isFired
          ? '<button type="button" class="item__btn item__btn--ok" data-act="rehire" data-id="' + esc(e.id) + '">Réembaucher</button>'
          : '<button type="button" class="item__btn" data-act="change-role" data-id="' + esc(e.id) + '">Rôle</button>' +
            '<button type="button" class="item__btn item__btn--warn" data-act="sanction" data-id="' + esc(e.id) + '">Sanction</button>' +
            '<button type="button" class="item__btn item__btn--danger" data-act="fire" data-id="' + esc(e.id) + '">Virer</button>'
        ) + '</div></div>';
  }
  return '<div class="sec">Ajouter un employé</div>' +
    '<form class="form" id="addEmployeeForm">' +
      '<div class="row">' +
        '<label>Nom RP<input type="text" id="empName" required placeholder="Jean Dupont" maxlength="60"></label>' +
        '<label>Rôle<select id="empRole">' + ROLES.map(function(r){ return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="actions"><button type="submit" class="btn btn--primary">Ajouter</button></div></form>' +
    '<div class="sec">Équipe active <small>' + actives.length + ' employés</small></div>' +
    '<div class="list">' + (actives.map(card).join('') || '<div class="empty">Aucun employé actif</div>') + '</div>' +
    (fired.length ? '<div class="sec">Anciens employés <small>' + fired.length + '</small></div><div class="list">' + fired.map(card).join('') + '</div>' : '');
}

/* ─── ATTRIBUTIONS ─── */
function buildPanelAttributions(){
  var fleet = getFleet();
  var actives = getActiveEmployees();
  var assign = STATE.assignments;
  var assignCount = Object.keys(assign).length;
  var empOptions = actives.map(function(e){
    var plate = getVehicleForEmployee(e.name);
    var suffix = plate ? ' (a ' + plate + ')' : '';
    return '<option value="' + esc(e.name) + '">' + esc(e.name) + ' · ' + esc(e.role) + suffix + '</option>';
  }).join('');
  var vehOptions = fleet.map(function(v){
    return '<option value="' + esc(v.plate) + '">' + esc(v.plate) + ' · ' + esc(v.model) + '</option>';
  }).join('');
  var listHTML = assignCount
    ? Object.keys(assign).map(function(plate){
        var emp = findEmployeeByName(assign[plate]);
        var veh = findVehicleByPlate(plate);
        return '<div class="item"><div class="item__av">' + esc(initials(assign[plate])) + '</div>' +
          '<div class="item__body"><b>' + esc(assign[plate]) + '</b>' +
          '<small>' + esc(plate) + ' · ' + esc(veh ? veh.model : '?') + '</small></div>' +
          '<div class="item__meta">' + esc(emp ? emp.role : '—') + '</div>' +
          '<div class="item__btns"><button type="button" class="item__btn item__btn--danger" data-unassign="' + esc(plate) + '">Retirer</button></div></div>';
      }).join('')
    : '<div class="empty">Aucune attribution</div>';
  var unassigned = fleet.filter(function(v){ return !assign[v.plate]; });
  return '<div class="sec">Attribuer un véhicule</div>' +
    '<form class="form" id="assignForm">' +
      '<label>Employé<select id="assignDriver" required><option value="">— Choisir —</option>' + empOptions + '</select></label>' +
      '<label>Véhicule<select id="assignVehicle" required><option value="">— Choisir —</option>' + vehOptions + '</select></label>' +
      '<div class="actions"><button type="submit" class="btn btn--primary">Attribuer</button></div></form>' +
    '<div class="sec">Attributions actives <small>' + assignCount + '</small></div>' +
    '<div class="list">' + listHTML + '</div>' +
    (unassigned.length ? '<div class="sec">Véhicules libres <small>' + unassigned.length + '</small></div>' +
      '<div class="list">' + unassigned.map(function(v){
        return '<div class="item item--full"><div class="item__body"><b>' + esc(v.model) + '</b>' +
        '<small>' + esc(v.plate) + ' · ' + esc(CATS[v.cat] || v.cat) + '</small></div></div>';
      }).join('') + '</div>' : '') +
    (assignCount ? '<div class="tools"><button type="button" class="danger" data-action="clear-assignments">Tout retirer</button></div>' : '');
}

/* ─── HISTORIQUE ─── */
function buildPanelHistorique(){
  var h = STATE.history;
  var listHTML = h.length
    ? h.map(function(item){
        return '<div class="item item--full"><div class="item__body"><b>' + esc(item.action) + '</b>' +
          '<small>' + fmtDate(item.ts) + ' · par ' + esc(item.by || 'Direction') + '</small></div></div>';
      }).join('')
    : '<div class="empty">Aucune action</div>';
  return '<div class="sec">Journal <small>' + h.length + ' entrées</small></div>' +
    '<div class="list">' + listHTML + '</div>' +
    (h.length ? '<div class="tools"><button type="button" class="danger" data-action="clear-history">Vider</button></div>' : '');
}

/* ─── PARAMÈTRES ─── */
function buildPanelParametres(){
  var raw = JSON.stringify(STATE);
  var sizeKB = (raw.length / 1024).toFixed(1);
  return '<div class="sec">Statistiques</div>' +
    '<div class="stats">' +
      '<div class="stat"><small>Factures</small><b>' + STATE.invoices.length + '</b></div>' +
      '<div class="stat"><small>Employés</small><b>' + getActiveEmployees().length + '</b></div>' +
      '<div class="stat"><small>Véhicules</small><b>' + getFleet().length + '</b></div>' +
      '<div class="stat"><small>Attributions</small><b>' + Object.keys(STATE.assignments).length + '</b></div></div>' +
    '<div class="sec">Sauvegarde</div>' +
    '<div class="tools">' +
      '<button type="button" data-action="export-json">Export JSON</button>' +
      '<button type="button" data-action="export-csv">Export CSV</button>' +
      '<button type="button" data-action="import">Import</button></div>' +
    '<div class="sec">Zone dangereuse</div>' +
    '<p style="color:var(--ink-2);font-size:13px;margin-bottom:12px">Ces actions sont irréversibles.</p>' +
    '<div class="tools">' +
      '<button type="button" class="danger" data-action="clear-invoices">Vider factures</button>' +
      '<button type="button" class="danger" data-action="clear-employees">Vider employés</button>' +
      '<button type="button" class="danger" data-action="clear-vehicles">Vider véhicules</button>' +
      '<button type="button" class="danger" data-action="clear-all">Tout effacer</button></div>' +
    '<div class="sec">Stockage</div>' +
    '<p style="color:var(--ink-3);font-family:var(--f-mono);font-size:11px;letter-spacing:.14em">' + sizeKB + ' Ko utilisés</p>';
}

/* ─── ÉVÉNEMENTS ADMIN ─── */
function bindPanelEvents(tab){
  var form = $('#addInvoiceForm');
  if (form) form.addEventListener('submit', function(e){
    e.preventDefault();
    var driver = $('#invDriver').value.trim();
    var count = Math.max(1, parseInt($('#invCount').value, 10) || 1);
    var amount = Math.max(0, parseInt($('#invAmount').value, 10) || 0);
    if (!driver || !amount) return;
    if (amount > 1000000){ toast('err', 'Montant trop élevé', 'Max 1 000 000 $.'); return; }
    STATE.invoices.push({ driver: driver, count: count, amount: amount, date: Date.now() });
    logAction('Facture · ' + driver + ' (' + count + '×' + amount + '$)');
    saveState();
    toast('ok', 'Facture ajoutée', driver + ' · ' + fmt(amount));
    renderAdminContent('factures');
    renderAllPublic();
  });

  var invSearch = $('#invSearch');
  if (invSearch) invSearch.addEventListener('input', function(){
    var q = invSearch.value.trim().toLowerCase();
    $$('#invList .item').forEach(function(el){
      var name = (el.querySelector('b') || {}).textContent || '';
      el.style.display = !q || name.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
    });
  });

  $$('[data-del-invoice]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var idx = parseInt(btn.dataset.delInvoice, 10);
      showConfirm('Supprimer cette facture ?', 'Action définitive.', { danger: true }).then(function(ok){
        if (!ok) return;
        var inv = STATE.invoices.splice(idx, 1)[0];
        logAction('Facture supprimée · ' + (inv ? inv.driver : '?'));
        saveState();
        toast('ok', 'Facture supprimée');
        renderAdminContent('factures');
        renderAllPublic();
      });
    });
  });

  var vf = $('#addVehicleForm');
  if (vf) vf.addEventListener('submit', function(e){
    e.preventDefault();
    var model = $('#vehModel').value.trim();
    var plate = $('#vehPlate').value.trim().toUpperCase();
    if (!model || !plate) return;
    if (!isValidPlate(plate)){ toast('err', 'Plaque invalide', '4 à 8 caractères A-Z et 0-9.'); return; }
    if (getFleet().some(function(v){ return v.plate === plate; })){ toast('warn', 'Plaque existante'); return; }
    var id = 'veh-' + Date.now();
    var ref = 'TD-' + String(getFleet().length + 1).padStart(3, '0');
    STATE.vehicles.push({ id: id, model: model, plate: plate, ref: ref });
    logAction('Véhicule ajouté · ' + model + ' (' + plate + ')');
    saveState();
    toast('ok', 'Véhicule ajouté', model + ' · ' + plate);
    renderAdminContent('vehicules');
    renderAllPublic();
  });

  $$('[data-del-vehicle]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.dataset.delVehicle;
      showConfirm('Supprimer ce véhicule ?', 'Action définitive.', { danger: true }).then(function(ok){
        if (!ok) return;
        var v = STATE.vehicles.filter(function(x){ return x.id === id; })[0];
        if (!v) return;
        if (STATE.assignments[v.plate]) delete STATE.assignments[v.plate];
        STATE.vehicles = STATE.vehicles.filter(function(x){ return x.id !== id; });
        logAction('Véhicule supprimé · ' + v.plate);
        saveState();
        toast('ok', 'Véhicule supprimé');
        renderAdminContent('vehicules');
        renderAllPublic();
      });
    });
  });

  var ef = $('#addEmployeeForm');
  if (ef) ef.addEventListener('submit', function(e){
    e.preventDefault();
    var name = $('#empName').value.trim();
    var role = $('#empRole').value;
    if (!name) return;
    if (name.length < 2 || name.length > 60){ toast('err', 'Nom invalide', 'Entre 2 et 60 caractères.'); return; }
    if (getAllEmployees().some(function(emp){ return emp.name.toLowerCase() === name.toLowerCase() && !emp.firedAt; })){
      toast('warn', 'Déjà employé', 'Ce nom est déjà utilisé.'); return;
    }
    addEmployee(name, role);
    logAction('Employé ajouté · ' + name + ' (' + role + ')');
    saveState();
    toast('ok', 'Employé ajouté', name + ' · ' + role);
    renderAdminContent('employes');
    renderAllPublic();
  });

  $$('[data-act]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var act = btn.dataset.act;
      var id = btn.dataset.id;
      var emp = findEmployeeById(id);
      if (!emp) return;
      if (act === 'fire') openFireModal(emp);
      else if (act === 'rehire'){
        rehireEmployee(id);
        logAction('Réembauche · ' + emp.name);
        saveState();
        toast('ok', 'Réembauché', emp.name);
        renderAdminContent('employes');
        renderAllPublic();
      }
      else if (act === 'change-role') openChangeRoleModal(emp);
      else if (act === 'sanction') openSanctionModal(emp);
    });
  });

  var af = $('#assignForm');
  if (af) af.addEventListener('submit', function(e){
    e.preventDefault();
    var driver = $('#assignDriver').value;
    var plate = $('#assignVehicle').value;
    if (!driver || !plate) return;
    assignVehicle(plate, driver);
    logAction('Attribution · ' + driver + ' → ' + plate);
    saveState();
    toast('ok', 'Attribution créée', driver + ' → ' + plate);
    renderAdminContent('attributions');
    renderAllPublic();
  });

  $$('[data-unassign]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var plate = btn.dataset.unassign;
      var driver = STATE.assignments[plate];
      showConfirm('Retirer cette attribution ?', driver + ' sera détaché du véhicule ' + plate, { danger: false }).then(function(ok){
        if (!ok) return;
        unassignVehicle(plate);
        logAction('Attribution retirée · ' + plate);
        saveState();
        toast('ok', 'Attribution retirée');
        renderAdminContent('attributions');
        renderAllPublic();
      });
    });
  });

  $$('[data-action]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var act = btn.dataset.action;
      if (act === 'export-json') exportJSON();
      else if (act === 'export-csv') exportCSV();
      else if (act === 'print') printInvoices();
      else if (act === 'import') $('#adminFileInput').click();
      else if (act === 'clear-invoices') clearInvoices();
      else if (act === 'clear-employees') clearEmployees();
      else if (act === 'clear-vehicles') clearVehicles();
      else if (act === 'clear-assignments') clearAssignments();
      else if (act === 'clear-history') clearHistory();
      else if (act === 'clear-all') clearAll();
    });
  });
}

/* ═══ MODALES SPÉCIALES ═══ */
function openFireModal(emp){
  var html = '<button class="modal__x" type="button" id="modalClose">✕</button>' +
    '<h2>Virer ' + esc(emp.name) + '</h2>' +
    '<p class="intro">Cette action marque l\'employé comme viré.</p>' +
    '<form class="form" id="fireForm">' +
      '<label>Motif<select id="fireReason" required>' +
        '<option value="Inactivité">Inactivité</option>' +
        '<option value="Non-respect du règlement">Non-respect du règlement</option>' +
        '<option value="Comportement inapproprié">Comportement inapproprié</option>' +
        '<option value="Faute professionnelle">Faute professionnelle</option>' +
        '<option value="Démission">Démission</option>' +
        '<option value="Autre">Autre</option></select></label>' +
      '<label>Détails (optionnel)<textarea id="fireDetails" placeholder="Contexte..." maxlength="300"></textarea></label>' +
      '<div class="actions">' +
        '<button type="button" class="btn" id="fireCancel">Annuler</button>' +
        '<button type="submit" class="btn btn--danger">Virer</button></div></form>';
  var m = openModal(html, { small: true });
  m.querySelector('#modalClose').addEventListener('click', function(){ if (m.parentNode) m.parentNode.removeChild(m); });
  m.querySelector('#fireCancel').addEventListener('click', function(){ if (m.parentNode) m.parentNode.removeChild(m); });
  m.querySelector('#fireForm').addEventListener('submit', function(e){
    e.preventDefault();
    var reason = m.querySelector('#fireReason').value;
    var details = m.querySelector('#fireDetails').value.trim();
    var fullReason = details ? reason + ' — ' + details : reason;
    fireEmployee(emp.id, fullReason);
    var plate = getVehicleForEmployee(emp.name);
    if (plate) unassignVehicle(plate);
    logAction('Renvoi · ' + emp.name + ' (' + fullReason + ')');
    saveState();
    toast('warn', 'Employé viré', emp.name);
    if (m.parentNode) m.parentNode.removeChild(m);
    renderAdminContent('employes');
    renderAllPublic();
  });
}

function openChangeRoleModal(emp){
  var html = '<button class="modal__x" type="button" id="modalClose">✕</button>' +
    '<h2>Changer le rôle</h2>' +
    '<p class="intro">' + esc(emp.name) + ' · actuellement <b>' + esc(emp.role) + '</b></p>' +
    '<form class="form" id="changeRoleForm">' +
      '<label>Nouveau rôle<select id="newRole" required>' +
        ROLES.map(function(r){
          return '<option value="' + esc(r) + '"' + (r === emp.role ? ' selected' : '') + '>' + esc(r) + '</option>';
        }).join('') + '</select></label>' +
      '<div class="actions">' +
        '<button type="button" class="btn" id="crCancel">Annuler</button>' +
        '<button type="submit" class="btn btn--primary">Valider</button></div></form>';
  var m = openModal(html, { small: true });
  m.querySelector('#modalClose').addEventListener('click', function(){ if (m.parentNode) m.parentNode.removeChild(m); });
  m.querySelector('#crCancel').addEventListener('click', function(){ if (m.parentNode) m.parentNode.removeChild(m); });
  m.querySelector('#changeRoleForm').addEventListener('submit', function(e){
    e.preventDefault();
    var newRole = m.querySelector('#newRole').value;
    if (newRole === emp.role){ if (m.parentNode) m.parentNode.removeChild(m); return; }
    changeRole(emp.id, newRole);
    logAction('Rôle · ' + emp.name + ' : ' + emp.role + ' → ' + newRole);
    saveState();
    toast('ok', 'Rôle mis à jour', emp.name + ' · ' + newRole);
    if (m.parentNode) m.parentNode.removeChild(m);
    renderAdminContent('employes');
    renderAllPublic();
  });
}

function openSanctionModal(emp){
  var html = '<button class="modal__x" type="button" id="modalClose">✕</button>' +
    '<h2>Sanctionner ' + esc(emp.name) + '</h2>' +
    '<p class="intro">Niveau 3 = licenciement automatique.</p>' +
    '<form class="form" id="sanctionForm">' +
      '<label>Niveau<select id="sanctionLevel" required>' +
        '<option value="1">Niveau 1 — Avertissement</option>' +
        '<option value="2">Niveau 2 — Mise à pied</option>' +
        '<option value="3">Niveau 3 — Licenciement</option></select></label>' +
      '<label>Motif<textarea id="sanctionReason" placeholder="Raison..." maxlength="300"></textarea></label>' +
      '<div class="actions">' +
        '<button type="button" class="btn" id="scCancel">Annuler</button>' +
        '<button type="submit" class="btn btn--warn">Appliquer</button></div></form>';
  var m = openModal(html, { small: true });
  m.querySelector('#modalClose').addEventListener('click', function(){ if (m.parentNode) m.parentNode.removeChild(m); });
  m.querySelector('#scCancel').addEventListener('click', function(){ if (m.parentNode) m.parentNode.removeChild(m); });
  m.querySelector('#sanctionForm').addEventListener('submit', function(e){
    e.preventDefault();
    var level = parseInt(m.querySelector('#sanctionLevel').value, 10);
    var reason = m.querySelector('#sanctionReason').value.trim();
    sanctionEmployee(emp.id, level, reason);
    if (level === 3){
      fireEmployee(emp.id, 'Licenciement · ' + (reason || 'Niveau 3'));
      var plate = getVehicleForEmployee(emp.name);
      if (plate) unassignVehicle(plate);
    }
    logAction('Sanction N' + level + ' · ' + emp.name + (reason ? ' (' + reason + ')' : ''));
    saveState();
    toast(level === 3 ? 'err' : 'warn', 'Sanction N' + level, emp.name);
    if (m.parentNode) m.parentNode.removeChild(m);
    renderAdminContent('employes');
    renderAllPublic();
  });
}

/* ═══ ACTIONS GLOBALES ═══ */
function exportJSON(){
  var data = {
    invoices: STATE.invoices, employees: STATE.employees, vehicles: STATE.vehicles,
    assignments: STATE.assignments, history: STATE.history,
    baseOverrides: STATE.baseOverrides,
    exportedAt: new Date().toISOString(), version: 2
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'taxi-downtown-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 500);
  toast('ok', 'Export JSON', 'Fichier téléchargé.');
}

function exportCSV(){
  if (!STATE.invoices.length){ toast('warn', 'Aucune facture'); return; }
  var rows = [['Date','Chauffeur','Nb factures','Montant','Entreprise 60%','Chauffeur 40%']];
  STATE.invoices.forEach(function(inv){
    rows.push([
      inv.date ? new Date(inv.date).toLocaleString('fr-FR') : '',
      inv.driver || '', inv.count || 1, inv.amount || 0,
      Math.round((inv.amount || 0) * 0.6), Math.round((inv.amount || 0) * 0.4)
    ]);
  });
  var csv = rows.map(function(r){
    return r.map(function(c){ return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
  }).join('\n');
  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'taxi-downtown-factures-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 500);
  toast('ok', 'Export CSV', STATE.invoices.length + ' factures.');
}

function printInvoices(){
  var w = window.open('', '', 'width=900,height=700');
  var html = '<!doctype html><html><head><title>Factures Taxi Downtown</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left}h1{font-size:18px}</style></head><body>';
  html += '<h1>Taxi Downtown — Factures</h1><p>Généré le ' + new Date().toLocaleString('fr-FR') + '</p>';
  html += '<table><thead><tr><th>Date</th><th>Chauffeur</th><th>Nb</th><th>Montant</th></tr></thead><tbody>';
  STATE.invoices.forEach(function(inv){
    html += '<tr><td>' + (inv.date ? new Date(inv.date).toLocaleDateString('fr-FR') : '') + '</td>';
    html += '<td>' + esc(inv.driver) + '</td>';
    html += '<td>' + (inv.count || 1) + '</td>';
    html += '<td>' + fmt(inv.amount) + '</td></tr>';
  });
  html += '</tbody></table></body></html>';
  w.document.write(html);
  w.document.close();
  setTimeout(function(){ w.print(); }, 500);
}

function importJSON(file){
  var reader = new FileReader();
  reader.onload = function(ev){
    try {
      var data = JSON.parse(ev.target.result);
      if (Array.isArray(data.invoices)) STATE.invoices = data.invoices;
      if (Array.isArray(data.employees)) STATE.employees = data.employees;
      if (Array.isArray(data.vehicles)) STATE.vehicles = data.vehicles;
      if (data.assignments && typeof data.assignments === 'object') STATE.assignments = data.assignments;
      if (Array.isArray(data.history)) STATE.history = data.history;
      if (data.baseOverrides && typeof data.baseOverrides === 'object') STATE.baseOverrides = data.baseOverrides;
      applyBaseOverrides();
      logAction('Import de données');
      saveState();
      toast('ok', 'Import réussi');
      closeTopModal();
      openAdminPanel();
      renderAllPublic();
    } catch(err){ toast('err', 'Fichier invalide', 'JSON corrompu.'); }
  };
  reader.readAsText(file);
}

function clearInvoices(){
  showConfirm('Vider toutes les factures ?', 'Définitif.', { danger: true }).then(function(ok){
    if (!ok) return;
    STATE.invoices = [];
    logAction('Factures vidées');
    saveState();
    toast('ok', 'Factures vidées');
    renderAdminContent('factures');
    renderAllPublic();
  });
}
function clearEmployees(){
  showConfirm('Vider les employés custom ?', 'Les employés de base restent.', { danger: true }).then(function(ok){
    if (!ok) return;
    STATE.employees = [];
    logAction('Employés custom vidés');
    saveState();
    toast('ok', 'Employés vidés');
    renderAdminContent('employes');
    renderAllPublic();
  });
}
function clearVehicles(){
  showConfirm('Vider les véhicules custom ?', 'Les véhicules de base restent.', { danger: true }).then(function(ok){
    if (!ok) return;
    STATE.vehicles = [];
    logAction('Véhicules custom vidés');
    saveState();
    toast('ok', 'Véhicules vidés');
    renderAdminContent('vehicules');
    renderAllPublic();
  });
}
function clearAssignments(){
  showConfirm('Retirer toutes les attributions ?', '', { danger: true }).then(function(ok){
    if (!ok) return;
    STATE.assignments = {};
    logAction('Attributions vidées');
    saveState();
    toast('ok', 'Attributions vidées');
    renderAdminContent('attributions');
    renderAllPublic();
  });
}
function clearHistory(){
  showConfirm('Vider le journal ?', '', { danger: true }).then(function(ok){
    if (!ok) return;
    STATE.history = [];
    saveState();
    toast('ok', 'Journal vidé');
    renderAdminContent('historique');
  });
}
function clearAll(){
  showConfirm('TOUT réinitialiser ?', 'Factures, employés, véhicules, attributions — tout effacé.', { danger: true, okLabel: 'Tout effacer' }).then(function(ok){
    if (!ok) return;
    STATE = { invoices: [], employees: [], vehicles: [], assignments: {}, history: [], baseOverrides: {}, updatedAt: Date.now() };
    saveState();
    toast('err', 'Réinitialisation', 'Toutes les données effacées.');
    closeTopModal();
    renderAllPublic();
  });
}

/* ═══ ADMIN ENTRY ═══ */
function openAdminPanel(){
  closeTopModal();
  var savedTab = LS.get('td-admin-tab', 'vehicules');
   if (savedTab === 'factures') savedTab = 'vehicules';
  var m = openModal(buildAdminHTML(savedTab));
  m.querySelector('#adminClose').addEventListener('click', function(){ if (m.parentNode) m.parentNode.removeChild(m); });
  m.addEventListener('click', function(e){ if (e.target === m && m.parentNode) m.parentNode.removeChild(m); });
  m.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click', function(){
      m.querySelectorAll('.tab').forEach(function(x){ x.classList.remove('on'); });
      t.classList.add('on');
      renderAdminContent(t.dataset.tab);
    });
  });
  renderAdminContent(savedTab);
}

/* ═══ LOGIN ═══ */
var LOGIN_KEY = 'td-login';
var ADMIN_SESSION_KEY = 'td-admin-session';
var ADMIN_SESSION_DURATION = 2 * 60 * 60 * 1000;
function getLoginState(){ return LS.get(LOGIN_KEY, { attempts: 0, lockUntil: 0 }); }
function setLoginState(s){ LS.set(LOGIN_KEY, s); }
function canAttemptLogin(){
  var s = getLoginState();
  if (s.lockUntil > Date.now()) return { ok: false, secs: Math.ceil((s.lockUntil - Date.now()) / 1000) };
  return { ok: true };
}
function recordLoginAttempt(success){
  var s = getLoginState();
  if (success){ s.attempts = 0; s.lockUntil = 0; }
  else {
    s.attempts = (s.attempts || 0) + 1;
    if (s.attempts >= 5){ s.lockUntil = Date.now() + 60000; s.attempts = 0; }
  }
  setLoginState(s);
}
function isAdminSessionValid(){
  try {
    var s = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!s) return false;
    return JSON.parse(s).expiresAt > Date.now();
  } catch(e){ return false; }
}
function setAdminSession(){
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ expiresAt: Date.now() + ADMIN_SESSION_DURATION }));
}

function openLoginModal(){
  closeTopModal();
  var html = '<button class="modal__x" type="button" id="loginClose">✕</button>' +
    '<h2>Accès restreint</h2>' +
    '<p class="intro">Réservé à la direction.</p>' +
    '<form class="form" id="loginForm">' +
      '<label>Code secret<input type="password" id="loginCode" autocomplete="off" required autofocus></label>' +
      '<p class="err" id="loginErr"></p>' +
      '<div class="actions"><button type="submit" class="btn btn--primary">Valider</button></div></form>';
  var m = openModal(html, { small: true });
  var input = m.querySelector('#loginCode');
  m.querySelector('#loginClose').addEventListener('click', function(){ if (m.parentNode) m.parentNode.removeChild(m); });
  m.addEventListener('click', function(e){ if (e.target === m && m.parentNode) m.parentNode.removeChild(m); });
  m.querySelector('#loginForm').addEventListener('submit', function(e){
    e.preventDefault();
    var attempt = canAttemptLogin();
    if (!attempt.ok){
      m.querySelector('#loginErr').textContent = 'Trop de tentatives. Réessaie dans ' + attempt.secs + 's.';
      return;
    }
    if (input.value === ADMIN_CODE){
      recordLoginAttempt(true);
      setAdminSession();
      if (m.parentNode) m.parentNode.removeChild(m);
      openAdminPanel();
    } else {
      recordLoginAttempt(false);
      m.querySelector('#loginErr').textContent = 'Code incorrect.';
      input.value = '';
      input.focus();
    }
  });
  setTimeout(function(){ if (input) input.focus(); }, 100);
}

/* ═══ MENU ═══ */
function setupMenu(){
  var btn = $('#menuBtn'), menu = $('#menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', function(){
    var open = btn.getAttribute('aria-expanded') === 'true';
    if (open){
      btn.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
      body.classList.remove('menu-open');
      setTimeout(function(){ menu.hidden = true; }, 400);
    } else {
      btn.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
      requestAnimationFrame(function(){ menu.classList.add('is-open'); });
      body.classList.add('menu-open');
    }
  });
  $$('.menu__links a').forEach(function(a){
    a.addEventListener('click', function(){
      if (btn.getAttribute('aria-expanded') === 'true') btn.click();
    });
  });
}

/* ═══ SMOOTH SCROLL ═══ */
document.addEventListener('click', function(e){
  var link = e.target.closest ? e.target.closest('[data-scroll]') : null;
  if (!link) return;
  e.preventDefault();
  var t = link.dataset.scroll;
  if (t === 'top'){ window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  var el = document.getElementById(t);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ═══ SCROLL SPY ═══ */
var SECTION_LABELS = {
  hero:'Accueil',
  primes:'Primes',
  hornys:"Horny's & Tarifs",
  infos:'Infos service',
  fleet:'Flotte',
  team:'Équipe'
};
function setupScrollSpy(){
  var sections = $$('[data-section]');
  var hud = $('#hudSection');
  var toTop = $('#toTop');
  var ticking = false;
  function update(){
    var y = window.scrollY + window.innerHeight * 0.35;
    var cur = 'hero';
    sections.forEach(function(s){ if (s.offsetTop <= y) cur = s.dataset.section; });
    if (hud) hud.textContent = SECTION_LABELS[cur] || cur;
    if (toTop) toTop.classList.toggle('is-visible', window.scrollY > window.innerHeight * 0.6);
    ticking = false;
  }
  window.addEventListener('scroll', function(){
    if (!ticking){ requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  update();
  var t = $('#toTop');
  if (t) t.addEventListener('click', function(){ window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

/* ═══ THEME ═══ */
function applyTheme(theme){
  if (['dark','light','halloween'].indexOf(theme) === -1) theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  LS.set('td-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f4f7' : theme === 'halloween' ? '#0a0606' : '#050506');
}
function setupTheme(){
  applyTheme(LS.get('td-theme', 'dark'));
  var btn = $('#themeBtn');
  if (btn) btn.addEventListener('click', function(){
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    var arr = ['dark','light','halloween'];
    applyTheme(arr[(arr.indexOf(cur) + 1) % arr.length]);
  });
}

/* ═══ ADMIN TRIGGER ═══ */
function setupAdminTrigger(){
  var trigger = $('#adminTrigger');
  if (!trigger) return;
  var cc = 0, ct = null;
  trigger.addEventListener('click', function(){
    cc++;
    trigger.classList.add('arming');
    clearTimeout(ct);
    ct = setTimeout(function(){ cc = 0; trigger.classList.remove('arming'); }, 1800);
    if (cc >= 5){
      cc = 0;
      trigger.classList.remove('arming');
      if (isAdminSessionValid()) openAdminPanel(); else openLoginModal();
    }
  });
  trigger.addEventListener('dblclick', function(e){
    e.preventDefault();
    if (isAdminSessionValid()) openAdminPanel(); else openLoginModal();
  });
  trigger.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      if (isAdminSessionValid()) openAdminPanel(); else openLoginModal();
    }
  });
}

/* ═══ RECHERCHE FLOTTE ═══ */
function setupFleetSearch(){
  var input = $('#fleetSearch'); if (!input) return;
  var d = null;
  input.addEventListener('input', function(e){
    clearTimeout(d);
    d = setTimeout(function(){ searchQuery = e.target.value; renderFleet(); }, 120);
  });
}

/* ═══ MIGRATION ancien format ═══ */
function migrateOldStorage(){
  if (LS.get('td-state') !== null) return;
  var oldInvoices = LS.get('td-custom-invoices', []);
  var oldVehicles = LS.get('td-custom-vehicles', []);
  var oldEmployees = LS.get('td-custom-employees', []);
  var oldAssignments = LS.get('td-assignments', {});
  if (oldInvoices.length || oldVehicles.length || oldEmployees.length || Object.keys(oldAssignments || {}).length){
    STATE.invoices = oldInvoices;
    STATE.vehicles = oldVehicles.map(function(v){
      return { id: v.id || 'veh-' + Date.now(), model: v.model || '?', plate: v.plate || '?', ref: v.ref || 'TD-NEW' };
    });
    STATE.employees = oldEmployees.map(function(e){
      return { id: e.id || 'emp-' + Date.now(), name: e.name || '?', role: e.role || 'Novice', hiredAt: Date.now() };
    });
    STATE.assignments = oldAssignments || {};
    saveState();
    console.log('[TD] Migration ancien format OK');
  }
}

/* ═══ INIT ═══ */
function init(){
  try {
    console.log('[TD] Init démarré');

    $$('[data-year]').forEach(function(el){ el.textContent = new Date().getFullYear(); });

    migrateOldStorage();
    applyBaseOverrides();

    setupTheme();
    setupMenu();
    setupAdminTrigger();
    setupFleetSearch();
    setupScrollSpy();

    var fi = $('#adminFileInput');
    if (fi) fi.addEventListener('change', function(e){
      var file = e.target.files[0];
      if (file) importJSON(file);
      e.target.value = '';
    });

    // Charge les données distantes
    var _remoteReady = WORKER_CONFIGURED ? SYNC.load().then(function(data){
      if (data){
        var remoteTime = data.updatedAt || 0;
        var localTime = STATE.updatedAt || 0;
        if (remoteTime >= localTime){
          STATE.invoices = Array.isArray(data.invoices) ? data.invoices : [];
          STATE.employees = Array.isArray(data.employees) ? data.employees : [];
          STATE.vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
          STATE.assignments = (data.assignments && typeof data.assignments === 'object') ? data.assignments : {};
          STATE.history = Array.isArray(data.history) ? data.history : [];
          STATE.baseOverrides = data.baseOverrides || {};
          STATE.updatedAt = remoteTime || Date.now();
          applyBaseOverrides();
          LS.set('td-state', STATE);
          console.log('[TD] Données distantes chargées');
        } else {
          console.log('[TD] Local plus récent, upload...');
          SYNC.save({
            invoices: STATE.invoices, employees: STATE.employees, vehicles: STATE.vehicles,
            assignments: STATE.assignments, history: STATE.history,
            baseOverrides: STATE.baseOverrides, updatedAt: STATE.updatedAt
          });
        }
      }
    }) : Promise.resolve();

    _remoteReady.then(function(){
      renderAllPublic();
      setupHero();

      var bar = $('#loaderBar'), pct = $('#loaderPct'), loader = $('#loader');
      var n = 0;
      var int = setInterval(function(){
        n += 18;
        if (n >= 100){
          n = 100;
          clearInterval(int);
          if (bar) bar.style.width = '100%';
          if (pct) pct.textContent = '100';
          setTimeout(function(){
            if (loader){
              loader.classList.add('out');
              setTimeout(function(){ if (loader.parentNode) loader.parentNode.removeChild(loader); }, 500);
            }
            body.classList.remove('is-loading');
          }, 200);
        }
        if (bar) bar.style.width = n + '%';
        if (pct) pct.textContent = n;
      }, 80);

      console.log('[TD] ✅ Sync OK —', WORKER_CONFIGURED ? 'Worker actif' : 'Mode local');
    });

  } catch(err){
    console.error('[TD] Erreur init :', err);
    var l = $('#loader');
    if (l && l.parentNode) l.parentNode.removeChild(l);
    body.classList.remove('is-loading');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
