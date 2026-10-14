/* TAXI DOWNTOWN · app.js v7.0 — MODE LOCAL (sans Cloudflare Worker) */
(function(){
'use strict';

/* ═══ CONFIG ═══ */
var WORKER_URL=''; // ⚠️ Worker désactivé — mode local uniquement
var WORKER_CONFIGURED=false;
var _K=[0x5b,0x50,0x48,0x51,0x4b,0x50,0x48,0x51,0x2d,0x29];
var ADMIN_CODE=String.fromCharCode.apply(null,_K.map(function(c){return c^0x1F;}));
var $=function(s,r){return (r||document).querySelector(s);};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
var body=document.body;

/* ═══ UTILS ═══ */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
function fmt(n){try{return new Intl.NumberFormat('fr-FR').format(Math.round(n))+' $';}catch(e){return Math.round(n)+' $';}}
function initials(s){return String(s||'?').split(/\s+/).map(function(w){return w.charAt(0);}).slice(0,2).join('').toUpperCase();}
function fmtDate(ts){if(!ts)return '—';try{return new Date(ts).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '—';}}
function ago(ts){if(!ts)return 'Jamais';var d=Date.now()-ts;if(d<60000)return "à l'instant";if(d<3600000)return 'il y a '+Math.floor(d/60000)+' min';if(d<86400000)return 'il y a '+Math.floor(d/3600000)+' h';return 'il y a '+Math.floor(d/86400000)+' j';}
function safeKey(k){return k!=='__proto__'&&k!=='constructor'&&k!=='prototype'&&typeof k==='string'&&k.length<=20;}
function isValidPlate(p){return /^[A-Z0-9]{4,8}$/.test(p);}
function normalize(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,'').trim();}
function fuzzyMatch(text,q){var t=normalize(text),n=normalize(q);if(!n)return true;if(t.indexOf(n)!==-1)return true;var ti=0;for(var i=0;i<n.length;i++){var idx=t.indexOf(n[i],ti);if(idx===-1)return false;ti=idx+1;}return true;}

/* ═══ STORAGE ═══ */
var LS={get:function(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}},set:function(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){console.warn('[Storage] Quota dépassé');return false;}},remove:function(k){try{localStorage.removeItem(k);}catch(e){}}};

/* ═══ ÉTAT GLOBAL ═══ */
var STATE=LS.get('td-state',null)||{
  invoices:[],employees:[],vehicles:[],
  assignments:{'CW6683ZV':'Bob Musar','CJ8249YD':'Noah Dupont','BX5408WL':'Arthur Bendal','FD3839EL':'Maxime Rivière','YP7603HL':'Sacha Mermoud','LX4255HP':'Sofian Badhaoui','RM1393GV':'Filou Pepito','WN5307RY':'Jimy Smith','DIR0001':'Jimy Smith','JZ0498AE':'Sam Le Gros','DIR0002':'Sam Le Gros','DC3624SY':'Romeo Cali','DIR0003':'Romeo Cali'},
  history:[],baseOverrides:{},planner:{},plannerWeek:Date.now(),updatedAt:null
};
['invoices','employees','vehicles','history'].forEach(function(k){if(!Array.isArray(STATE[k]))STATE[k]=[];});
if(!STATE.assignments||typeof STATE.assignments!=='object')STATE.assignments={};
if(!STATE.baseOverrides||typeof STATE.baseOverrides!=='object')STATE.baseOverrides={};
if(!STATE.planner||typeof STATE.planner!=='object')STATE.planner={};
if(!STATE.plannerWeek)STATE.plannerWeek=Date.now();

/* ═══ BACKUPS ═══ */
var BACKUPS_KEY='td-backups',MAX_BACKUPS=10,_prevSnap=null,_skipBackup=false;
function getBackups(){return LS.get(BACKUPS_KEY,[]);}
function setBackups(a){LS.set(BACKUPS_KEY,a.slice(0,MAX_BACKUPS));}
function captureSnapshot(){
  return{
    invoices:JSON.parse(JSON.stringify(STATE.invoices||[])),
    employees:JSON.parse(JSON.stringify(STATE.employees||[])),
    vehicles:JSON.parse(JSON.stringify(STATE.vehicles||[])),
    assignments:JSON.parse(JSON.stringify(STATE.assignments||{})),
    history:JSON.parse(JSON.stringify(STATE.history||[])),
    baseOverrides:JSON.parse(JSON.stringify(STATE.baseOverrides||{})),
    planner:JSON.parse(JSON.stringify(STATE.planner||{}))
  };
}
function createBackup(label){
  var c=captureSnapshot();
  if(_prevSnap){
    if(JSON.stringify(_prevSnap)===JSON.stringify(c))return false;
    var b=getBackups();
    b.unshift({id:'bak-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),ts:Date.now(),label:label||'Modification',snapshot:_prevSnap});
    setBackups(b);
  }
  _prevSnap=c;return true;
}
function restoreBackup(id){
  var b=getBackups().filter(function(x){return x.id===id;})[0];
  if(!b)return false;
  _skipBackup=true;
  STATE.invoices=JSON.parse(JSON.stringify(b.snapshot.invoices||[]));
  STATE.employees=JSON.parse(JSON.stringify(b.snapshot.employees||[]));
  STATE.vehicles=JSON.parse(JSON.stringify(b.snapshot.vehicles||[]));
  STATE.assignments=JSON.parse(JSON.stringify(b.snapshot.assignments||{}));
  STATE.history=JSON.parse(JSON.stringify(b.snapshot.history||[]));
  STATE.baseOverrides=JSON.parse(JSON.stringify(b.snapshot.baseOverrides||{}));
  STATE.planner=JSON.parse(JSON.stringify(b.snapshot.planner||{}));
  STATE.updatedAt=Date.now();
  STATE.history.unshift({action:'🔄 Restauration · '+b.label,ts:Date.now(),by:'Direction'});
  applyBaseOverrides();saveState();_prevSnap=captureSnapshot();return true;
}
function deleteBackup(id){setBackups(getBackups().filter(function(x){return x.id!==id;}));}

/* ═══ SYNC (mode local uniquement) ═══ */
var SYNC={
  setState:function(state,label){
    var el=document.getElementById('hudSync');if(!el)return;
    el.dataset.state='idle';
    el.textContent=label||'Local';
  },
  load:function(){return Promise.resolve(null);},
  save:function(){return Promise.resolve(false);},
  flushPending:function(){return Promise.resolve(false);}
};

/* ═══ SAUVEGARDE ═══ */
var _saveDebounce=null;
function saveState(){
  if(!_skipBackup){createBackup((STATE.history[0]&&STATE.history[0].action)||'Modification');}
  else{_skipBackup=false;}
  STATE.updatedAt=Date.now();
  var ok=LS.set('td-state',STATE);
  if(!ok){
    var b=getBackups();
    if(b.length>2){setBackups(b.slice(0,2));LS.set('td-state',STATE);}
  }
}
function logAction(a,by){STATE.history.unshift({action:a,ts:Date.now(),by:by||'Direction'});STATE.history=STATE.history.slice(0,200);}

/* ═══ DONNÉES DE BASE (modifie ici pour changer partout) ═══ */
var BASE_EMPLOYEES=[
  {id:'base-1',name:'Jimy Smith',role:'Directeur',hiredAt:Date.now()-30*86400000},
  {id:'base-2',name:'Sam Le Gros',role:'Directeur Adjoint',hiredAt:Date.now()-30*86400000},
  {id:'base-3',name:'Romeo Cali',role:'Responsable CM',hiredAt:Date.now()-30*86400000},
  {id:'base-4',name:'Bob Musar',role:'Chauffeur Senior',hiredAt:Date.now()-15*86400000},
  {id:'base-5',name:'Noah Dupont',role:'Novice',hiredAt:Date.now()-15*86400000},
  {id:'base-7',name:'Maxime Rivière',role:'Novice',hiredAt:Date.now()-10*86400000},
  {id:'base-8',name:'Sofia Fernandez',role:'Chauffeur Senior',hiredAt:Date.now()-25*86400000},
  {id:'base-9',name:'Arthur Bendal',role:'Novice',hiredAt:Date.now()-8*86400000},
  {id:'base-10',name:'Sacha Mermoud',role:'Novice',hiredAt:Date.now()-5*86400000},
  {id:'base-11',name:'Theo Roberto',role:'Nov