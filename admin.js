// ============================================================
//  ADMIN.JS v3 — Multi-room, kiểm soát 100%, sửa từng ô
// ============================================================
'use strict';

const MASTER_PASS = 'admin_lixi_master_2025';
const SESSION_KEY = 'lixi_admin_v3';
const pathParts   = location.pathname.split('/').filter(Boolean);
const URL_ROOM_ID = pathParts[1] || '';

let sb = null, currentRoom = null, gameData = [], players = [], roomConfig = {};
let notifCount = 0, notifs = [], isMasterAdmin = false;

const $ = id => document.getElementById(id);

/* ─── INIT ─── */
function initSB() {
  if (sb) return;
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

function getSession()    { try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');}catch{return null;} }
function saveSession(d)  { sessionStorage.setItem(SESSION_KEY, JSON.stringify(d)); }
function clearSession()  { sessionStorage.removeItem(SESSION_KEY); }

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  initSB();
  const sess = getSession();
  if (sess) {
    if (sess.master) { isMasterAdmin=true; await bootDashboard(null); }
    else if (sess.roomId) { await bootDashboard(sess.roomId); }
    else showLogin();
  } else showLogin();
});

/* ─── LOGIN ─── */
function showLogin() { $('login-screen').classList.remove('hidden'); }

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const user  = $('login-user').value.trim();
  const pass  = $('login-pass').value;
  const errEl = $('login-error');
  errEl.textContent = '';

  // Master admin
  if (user === 'admin' && pass === MASTER_PASS) {
    saveSession({ master:true });
    isMasterAdmin = true;
    $('login-screen').classList.add('hidden');
    await bootDashboard(null);
    return;
  }

  // Room admin via URL
  if (URL_ROOM_ID) {
    try {
      const { data: room } = await sb.from('rooms').select('id,title,emoji,host_name,pass_hash').eq('id', URL_ROOM_ID).single();
      if (room) {
        const hash = btoa(unescape(encodeURIComponent(pass + ':lixi_salt_2025')));
        if (hash === room.pass_hash) {
          saveSession({ roomId: room.id });
          $('login-screen').classList.add('hidden');
          await bootDashboard(room.id);
          return;
        }
      }
    } catch(_) {}
  }

  // Room admin via ID input
  if (user.length >= 6) {
    try {
      const hash = btoa(unescape(encodeURIComponent(pass + ':lixi_salt_2025')));
      const { data: room } = await sb.from('rooms').select('id').eq('id', user).eq('pass_hash', hash).single();
      if (room) {
        saveSession({ roomId: room.id });
        $('login-screen').classList.add('hidden');
        await bootDashboard(room.id);
        return;
      }
    } catch(_) {}
  }

  errEl.textContent = '⚠ Sai thông tin đăng nhập!';
  $('login-pass').value = '';
  errEl.style.animation='none'; void errEl.offsetWidth; errEl.style.animation='';
});

/* ─── DASHBOARD ─── */
async function bootDashboard(roomId) {
  $('admin-app').classList.add('visible');
  setupNavigation();
  setupControls();
  renderNotifs();

  if (isMasterAdmin) {
    $('sb-username').textContent = 'Master Admin';
    $('sb-room-title').textContent = 'Lì Xì Platform';
    await loadAllRooms();
  }

  const targetRoom = roomId || URL_ROOM_ID;
  if (targetRoom) await loadRoom(targetRoom);
  else if (isMasterAdmin) showTab('rooms');
}

/* ─── LOAD ROOM ─── */
async function loadRoom(roomId) {
  const { data: room, error } = await sb.from('rooms').select('*').eq('id', roomId).single();
  if (error || !room) { showToast('❌ Không tìm thấy phòng', 'error'); return; }

  currentRoom = room;
  roomConfig  = room.config || {};

  // Sidebar
  $('sb-room-emoji').textContent  = room.emoji || '🧧';
  $('sb-room-title').textContent  = room.title || 'Phòng Lì Xì';
  const rid = $('sb-room-id');
  if (rid) { rid.textContent = 'ID: ' + roomId; rid.style.display='block'; }
  showEl('room-nav-section');
  showEl('room-settings-nav');

  // Share links
  const base = location.origin;
  setTxt('share-room-link',  `${base}/room/${roomId}`);
  setTxt('share-admin-link', `${base}/admin/${roomId}`);

  // Status
  const gsBar = $('game-status-bar');
  if (gsBar) gsBar.style.display = 'flex';
  const tgBtn = $('toggle-game-btn');
  if (tgBtn) tgBtn.style.display = 'inline-flex';
  updateGameStatus(room.is_open);

  [gameData, players] = await Promise.all([loadEnvelopes(roomId), loadPlayers(roomId)]);
  renderAll();
  fillSettingsForm();
  setupRealtime(roomId);
}

async function loadEnvelopes(roomId) {
  const { data } = await sb.from('envelopes').select('*').eq('room_id', roomId).order('position');
  return (data||[]).map(r => ({
    id:r.position+1, displayValue:r.display_value, realValue:r.real_value,
    isSpecial:r.is_special, opened:r.opened, openedAt:r.opened_at,
    openedBy:r.opened_by||'', _dbId:r.id, position:r.position
  }));
}

async function loadPlayers(roomId) {
  const { data } = await sb.from('events').select('*').eq('room_id', roomId).order('created_at',{ascending:false});
  return data || [];
}

async function loadAllRooms() {
  const { data } = await sb.from('rooms')
    .select('id,title,host_name,emoji,is_open,envelope_count,opened_count,created_at')
    .order('created_at', { ascending:false }).limit(50);
  renderRoomsPicker(data || []);
}

/* ─── REALTIME ─── */
function setupRealtime(roomId) {
  sb.channel('admin-rt-'+roomId)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'envelopes',filter:`room_id=eq.${roomId}`}, async () => {
      gameData = await loadEnvelopes(roomId);
      players  = await loadPlayers(roomId);
      renderAll();
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'events',filter:`room_id=eq.${roomId}`}, p => {
      const ev = p.new;
      if (ev.is_special) {
        notifCount++;
        updateNotifBadge();
        notifs.unshift({msg:`🔥 ${escHtml(ev.player_name||'Ai đó')} bốc ô đặc biệt ${ev.real_value}k!`, time:new Date()});
        renderNotifs();
      }
      players.unshift(ev);
      renderPlayers();
      renderTimeline();
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`id=eq.${roomId}`}, p => {
      if (currentRoom) { currentRoom.is_open = p.new.is_open; updateGameStatus(p.new.is_open); }
    })
    .subscribe();
}

/* ─── RENDER ALL ─── */
function renderAll() {
  renderMetrics();
  renderEnvTable($('env-filter')?.value, $('env-search')?.value);
  renderEnvBulkEditor();
  renderSpecial();
  renderPlayers();
  renderCharts();
  renderTimeline();
}

/* ─── METRICS ─── */
function renderMetrics() {
  if (!gameData.length) return;
  const total   = gameData.length;
  const opened  = gameData.filter(e=>e.opened).length;
  const specs   = gameData.filter(e=>e.isSpecial);
  const sOpen   = specs.filter(e=>e.opened).length;
  const dTot    = gameData.filter(e=>e.opened).reduce((s,e)=>s+e.displayValue,0);
  const rTot    = gameData.filter(e=>e.opened).reduce((s,e)=>s+e.realValue,0);
  const pct     = total>0 ? Math.round(opened/total*100) : 0;

  setTxt('m-total',          total);
  setTxt('m-opened',         opened);
  setTxt('m-pending',        total-opened);
  setTxt('m-special-opened', `${sOpen}/${specs.length}`);
  setTxt('m-display-total',  dTot+'k');
  setTxt('m-real-total',     rTot+'k');
  setTxt('m-players',        players.length);
  setTxt('m-pct',            pct+'%');
  setTxt('ring-pct',         pct+'%');

  const rf = $('ring-fill');
  if (rf) rf.style.strokeDashoffset = 226-(226*pct/100);
}

function setTxt(id,v) { const e=$(id); if(e) e.textContent=v; }
function showEl(id)   { const e=$(id); if(e) e.style.display='block'; }
function setVal(id,v) { const e=$(id); if(e) e.value=v; }
function setChk(id,v) { const e=$(id); if(e) e.checked=v; }

function updateGameStatus(open) {
  setTxt('game-open-label', open ? '🟢 Game đang MỞ' : '🔴 Game đang ĐÓNG');
  const dot = $('gs-dot');
  if (dot) dot.className = 'gs-dot '+(open?'open':'closed');
}

/* ─── ENV TABLE ─── */
function renderEnvTable(filter='all', search='') {
  const tbody = $('env-tbody');
  if (!tbody) return;
  let data = [...gameData];
  if (filter==='opened')  data = data.filter(e=>e.opened);
  if (filter==='pending') data = data.filter(e=>!e.opened);
  if (filter==='special') data = data.filter(e=>e.isSpecial);
  if (search) {
    const s = search.toLowerCase();
    data = data.filter(e => String(e.id).includes(s)||String(e.displayValue).includes(s)||String(e.realValue).includes(s)||(e.openedBy||'').toLowerCase().includes(s));
  }
  tbody.innerHTML = data.map(env=>`
    <tr>
      <td class="mono">#${String(env.id).padStart(2,'0')}</td>
      <td><span class="badge ${env.isSpecial?'badge-special':'badge-normal'}">${env.isSpecial?'🔥 Đặc biệt':'📦 Thường'}</span></td>
      <td class="mono">${env.displayValue}k</td>
      <td class="mono" style="color:${env.isSpecial?'var(--gold-300)':'var(--text-secondary)'}">${env.realValue}k${env.isSpecial?' ⭐':''}</td>
      <td><span class="badge ${env.opened?'badge-opened':'badge-pending'}">${env.opened?'✓ Đã mở':'○ Chờ'}</span></td>
      <td style="font-size:.82rem;color:var(--text-secondary)">${escHtml(env.openedBy)||'—'}</td>
      <td style="font-size:.76rem;color:var(--text-muted)">${env.openedAt?new Date(env.openedAt).toLocaleTimeString('vi-VN'):'—'}</td>
      <td class="action-cell">
        <button class="icon-btn" onclick="adminQuickEdit(${env.id-1})" title="Sửa nhanh">✏️</button>
        <button class="icon-btn" onclick="adminToggle(${env.id-1})" title="${env.opened?'Đặt lại':'Đánh dấu đã mở'}">${env.opened?'↺':'✓'}</button>
      </td>
    </tr>`).join('')
  || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:28px">Không có dữ liệu</td></tr>';
}

/* ─── BULK EDITOR ─── */
function renderEnvBulkEditor() {
  const grid = $('env-bulk-grid');
  if (!grid || !gameData.length) return;
  grid.innerHTML = gameData.map((env,idx)=>`
    <div class="ebc ${env.isSpecial?'special':''}" id="ebc-${idx}">
      <div class="ebc-id">
        Ô #${String(env.id).padStart(2,'0')}
        ${env.opened?'<span style="color:var(--green);font-size:.62rem;margin-left:4px">✓ Đã mở</span>':''}
      </div>
      <div class="ebc-fields">
        <div class="ebc-field">
          <label>Hiển thị (k)</label>
          <input class="ebc-input" type="number" id="ebc-d-${idx}" value="${env.displayValue}" min="1" max="100000"/>
        </div>
        <div class="ebc-field">
          <label>Thực tế (k)</label>
          <input class="ebc-input" type="number" id="ebc-r-${idx}" value="${env.realValue}" min="1" max="100000"/>
        </div>
      </div>
      <label class="ebc-check">
        <input type="checkbox" id="ebc-sp-${idx}" ${env.isSpecial?'checked':''}/>
        🔥 Ô đặc biệt
      </label>
      <button class="ebc-save-btn" onclick="saveOneEnv(${idx})">💾 Lưu ô này</button>
    </div>`).join('');
}

window.saveOneEnv = async function(idx) {
  const env = gameData[idx];
  if (!env) return;
  const d = parseInt($(`ebc-d-${idx}`)?.value); if (d>0) env.displayValue=d;
  const r = parseInt($(`ebc-r-${idx}`)?.value); if (r>0) env.realValue=r;
  env.isSpecial = !!$(`ebc-sp-${idx}`)?.checked;
  await sb.from('envelopes').update({display_value:env.displayValue, real_value:env.realValue, is_special:env.isSpecial}).eq('id',env._dbId);
  renderSpecial(); renderEnvTable($('env-filter')?.value,$('env-search')?.value);
  showToast(`✓ Ô #${String(env.id).padStart(2,'0')} đã lưu`, 'success');
  const card=$(`ebc-${idx}`);
  if(card){card.style.outline='2px solid var(--green)';setTimeout(()=>card.style.outline='',1200);}
};

window.adminQuickEdit = function(idx) {
  const env = gameData[idx];
  if (!env) return;
  showModal({
    title: `✏️ Sửa ô #${String(env.id).padStart(2,'0')}`,
    body:`
      <div class="form-group"><label class="form-label">Mệnh giá hiển thị (k)</label><input type="number" id="qe-d" value="${env.displayValue}" min="1" class="modal-input"/></div>
      <div class="form-group"><label class="form-label">Mệnh giá thực (k)</label><input type="number" id="qe-r" value="${env.realValue}" min="1" class="modal-input"/></div>
      <div class="form-group"><label class="form-label">Loại</label>
        <select id="qe-sp" class="modal-input">
          <option value="0" ${!env.isSpecial?'selected':''}>📦 Thường</option>
          <option value="1" ${env.isSpecial?'selected':''}>🔥 Đặc biệt</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Trạng thái</label>
        <select id="qe-op" class="modal-input">
          <option value="0" ${!env.opened?'selected':''}>○ Chưa mở</option>
          <option value="1" ${env.opened?'selected':''}>✓ Đã mở</option>
        </select>
      </div>
      ${env.opened?`<div class="form-group"><label class="form-label">Người bốc</label><input type="text" id="qe-by" value="${escHtml(env.openedBy)}" class="modal-input"/></div>`:''}`,
    confirmText: '💾 Lưu',
    async onConfirm() {
      const d=parseInt($('qe-d').value); if(d>0) env.displayValue=d;
      const r=parseInt($('qe-r').value); if(r>0) env.realValue=r;
      env.isSpecial = $('qe-sp').value==='1';
      const nowOpen = $('qe-op').value==='1';
      if (nowOpen!==env.opened){env.opened=nowOpen;env.openedAt=nowOpen?new Date().toISOString():null;if(!nowOpen)env.openedBy='';}
      if ($('qe-by')) env.openedBy=$('qe-by').value;
      await sb.from('envelopes').update({display_value:env.displayValue,real_value:env.realValue,is_special:env.isSpecial,opened:env.opened,opened_at:env.openedAt,opened_by:env.openedBy}).eq('id',env._dbId);
      renderAll();
      showToast(`✓ Đã cập nhật ô #${String(env.id).padStart(2,'0')}`, 'success');
    }
  });
};

window.adminToggle = async function(idx) {
  const env = gameData[idx];
  if (!env) return;
  env.opened=!env.opened; env.openedAt=env.opened?new Date().toISOString():null;
  if(!env.opened) env.openedBy='';
  await sb.from('envelopes').update({opened:env.opened,opened_at:env.openedAt,opened_by:env.openedBy}).eq('id',env._dbId);
  renderAll();
  showToast(`${env.opened?'✓ Đã mở':'↺ Đặt lại'} ô #${String(env.id).padStart(2,'0')}`, 'success');
};

/* ─── SAVE ALL ENVELOPES ─── */
async function saveAllEnvelopes() {
  if (!gameData.length) return;
  const btn = $('save-all-envs-btn');
  if(btn){btn.disabled=true;btn.textContent='⏳ Đang lưu...';}
  let saved=0;
  for(let idx=0;idx<gameData.length;idx++){
    const env=gameData[idx];
    const d=parseInt($(`ebc-d-${idx}`)?.value); if(d>0) env.displayValue=d;
    const r=parseInt($(`ebc-r-${idx}`)?.value); if(r>0) env.realValue=r;
    env.isSpecial=!!$(`ebc-sp-${idx}`)?.checked;
    await sb.from('envelopes').update({display_value:env.displayValue,real_value:env.realValue,is_special:env.isSpecial}).eq('id',env._dbId);
    saved++;
  }
  if(btn){btn.disabled=false;btn.textContent='💾 Lưu tất cả thay đổi';}
  renderSpecial(); renderEnvTable();
  showToast(`✓ Đã lưu ${saved} phong bì`, 'success');
}

/* ─── SHUFFLE ENVELOPES (xáo lại vị trí) ─── */
async function shuffleEnvelopes() {
  if (!gameData.length || !currentRoom) return;
  showConfirm('Xáo trộn thứ tự?','Sẽ xáo ngẫu nhiên vị trí các ô (giữ nguyên mệnh giá). Ô đã mở giữ nguyên.', async()=>{
    const shuffled = shuffle([...gameData]);
    for(let i=0;i<shuffled.length;i++){
      const env=shuffled[i];
      await sb.from('envelopes').update({position:i}).eq('id',env._dbId);
      env.position=i; env.id=i+1;
    }
    gameData=shuffled;
    renderAll();
    showToast('🔀 Đã xáo trộn thứ tự phong bì','success');
  });
}

/* ─── SPECIAL CARDS ─── */
function renderSpecial() {
  const c=$('special-cards');
  if(!c) return;
  const specs=gameData.filter(e=>e.isSpecial);
  if(!specs.length){c.innerHTML='<p style="color:var(--text-muted);font-size:.84rem">Không có ô đặc biệt nào. Tick "Đặc biệt" trong tab Sửa mệnh giá.</p>';return;}
  c.innerHTML=specs.map(env=>`
    <div class="special-env-card" onclick="adminQuickEdit(${env.id-1})">
      <div class="senv-num">Ô #${String(env.id).padStart(2,'00')}</div>
      <div class="senv-display">Hiển thị: ${env.displayValue}k</div>
      <div class="senv-real">${env.realValue}k 🏆</div>
      <div class="senv-by">${env.openedBy?'Bởi: '+escHtml(env.openedBy):''}</div>
      <div class="senv-status"><span class="badge ${env.opened?'badge-opened':'badge-pending'}">${env.opened?'✓ Đã bốc':'○ Chưa mở'}</span></div>
    </div>`).join('');
}

/* ─── PLAYERS ─── */
function renderPlayers() {
  const tbody=$('players-tbody');
  if(!tbody) return;
  if(!players.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px">Chưa có người chơi</td></tr>';return;}
  tbody.innerHTML=players.slice(0,100).map((p,i)=>`
    <tr>
      <td class="mono">#${String(i+1).padStart(2,'0')}</td>
      <td style="font-weight:600;color:var(--text-primary)">${escHtml(p.player_name||'—')}</td>
      <td class="mono">${p.display_value||'—'}k</td>
      <td class="mono" style="color:${p.is_special?'var(--gold-300)':'var(--text-secondary)'}">${p.real_value||'—'}k${p.is_special?' ⭐':''}</td>
      <td><span class="badge ${p.is_special?'badge-special':'badge-normal'}">${p.is_special?'🔥 Đặc biệt':'📦 Thường'}</span></td>
      <td style="font-size:.76rem;color:var(--text-muted)">${p.created_at?new Date(p.created_at).toLocaleString('vi-VN'):'—'}</td>
    </tr>`).join('');
}

/* ─── CHARTS ─── */
function renderCharts() {
  // Distribution by real value
  const dist={};
  gameData.forEach(e=>{ dist[e.realValue]=(dist[e.realValue]||0)+1; });
  const dc=$('chart-dist');
  if(dc){
    const max=Math.max(...Object.values(dist),1);
    const colors={1:'#555',2:'#666',3:'#777',5:'#3498db',10:'#5dade2',15:'#9b59b6',20:'#e67e22',50:'#e74c3c',100:'#ffd700'};
    dc.innerHTML=Object.entries(dist).sort((a,b)=>+a[0]-+b[0]).map(([v,c])=>`
      <div class="bar-row">
        <div class="bar-label-row"><span class="bar-label-text">${v}k</span><span class="bar-label-val">${c} ô</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:0%;background:${colors[v]||'#888'}" data-w="${c/max*100}"></div></div>
      </div>`).join('');
  }
  // Open rate
  const total=gameData.length, opened=gameData.filter(e=>e.opened).length;
  const rc=$('chart-rate');
  if(rc) rc.innerHTML=`
    <div class="bar-row"><div class="bar-label-row"><span class="bar-label-text">Đã mở</span><span class="bar-label-val">${opened}</span></div><div class="bar-track"><div class="bar-fill" style="width:0%;background:linear-gradient(90deg,#27ae60,#2ecc71)" data-w="${total>0?opened/total*100:0}"></div></div></div>
    <div class="bar-row"><div class="bar-label-row"><span class="bar-label-text">Chưa mở</span><span class="bar-label-val">${total-opened}</span></div><div class="bar-track"><div class="bar-fill" style="width:0%;background:linear-gradient(90deg,#d4a017,#f1c40f)" data-w="${total>0?(total-opened)/total*100:0}"></div></div></div>
    <div class="bar-row" style="margin-top:14px"><div class="bar-label-row"><span class="bar-label-text">Đặc biệt đã mở</span><span class="bar-label-val">${gameData.filter(e=>e.isSpecial&&e.opened).length}/${gameData.filter(e=>e.isSpecial).length}</span></div><div class="bar-track"><div class="bar-fill" style="width:0%;background:linear-gradient(90deg,var(--gold-500),var(--gold-300))" data-w="${gameData.filter(e=>e.isSpecial).length>0?gameData.filter(e=>e.isSpecial&&e.opened).length/gameData.filter(e=>e.isSpecial).length*100:0}"></div></div></div>`;
  // Hourly
  const hourly={};
  players.forEach(p=>{if(p.created_at){const h=new Date(p.created_at).getHours();hourly[h]=(hourly[h]||0)+1;}});
  const hc=$('chart-hourly');
  if(hc){
    const hmax=Math.max(...Object.values(hourly),1);
    hc.innerHTML=Object.keys(hourly).length?Object.entries(hourly).sort((a,b)=>+a[0]-+b[0]).map(([h,c])=>`
      <div class="bar-row">
        <div class="bar-label-row"><span class="bar-label-text">${h}:00</span><span class="bar-label-val">${c} lượt</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:0%;background:linear-gradient(90deg,#2980b9,#5dade2)" data-w="${c/hmax*100}"></div></div>
      </div>`).join(''):'<p style="color:var(--text-muted);font-size:.84rem;padding:14px 0">Chưa có dữ liệu hoạt động</p>';
  }
  setTimeout(()=>{ document.querySelectorAll('.bar-fill').forEach(f=>f.style.width=(f.dataset.w||0)+'%'); },200);
}

/* ─── TIMELINE ─── */
function renderTimeline() {
  const c=$('timeline-container');
  if(!c) return;
  if(!players.length){c.innerHTML='<p style="color:var(--text-muted);font-size:.84rem;text-align:center;padding:20px">Chưa có sự kiện nào</p>';return;}
  c.innerHTML=players.slice(0,30).map(p=>`
    <div class="timeline-item ${p.is_special?'tl-special':''}">
      <div class="tl-dot ${p.is_special?'special':'normal'}"></div>
      <div class="tl-content">
        <div class="tl-main">
          <strong>${escHtml(p.player_name||'Ẩn danh')}</strong>
          bốc được <span class="tl-val">${p.display_value||'?'}k</span>
          ${p.is_special?`<span class="badge badge-special" style="font-size:.65rem">🔥 Thực: ${p.real_value}k</span>`:''}
        </div>
        <div class="tl-time">${p.created_at?new Date(p.created_at).toLocaleTimeString('vi-VN'):''}</div>
      </div>
    </div>`).join('');
}

/* ─── NOTIFICATIONS ─── */
function updateNotifBadge() {
  const b=$('notif-badge');
  if(b){b.textContent=notifCount;b.style.display=notifCount>0?'flex':'none';}
}
function renderNotifs() {
  const el=$('notif-list');
  if(!el) return;
  if(!notifs.length){el.innerHTML='<p style="color:var(--text-muted);font-size:.84rem;padding:18px;text-align:center">Chưa có thông báo realtime</p>';return;}
  el.innerHTML=notifs.map(n=>`
    <div class="notif-item">
      <span>${n.msg}</span>
      <span class="notif-time">${n.time.toLocaleTimeString('vi-VN')}</span>
    </div>`).join('');
}

/* ─── ROOMS PICKER ─── */
function renderRoomsPicker(rooms) {
  const g=$('rooms-picker-grid');
  if(!g) return;
  if(!rooms.length){g.innerHTML='<div class="no-room-msg"><h3>Chưa có phòng nào</h3><p>Về trang chủ để tạo phòng lì xì.</p><br><a href="/" style="color:var(--gold-300)">→ Trang chủ</a></div>';return;}
  g.innerHTML=rooms.map(r=>`
    <div class="rp-card ${currentRoom?.id===r.id?'active-room':''}" onclick="switchRoom('${r.id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:1.7rem">${r.emoji||'🧧'}</span>
        <span class="badge ${r.is_open?'badge-open':'badge-closed'}">${r.is_open?'MỞ':'ĐÓNG'}</span>
      </div>
      <div style="font-weight:700;font-size:.95rem;margin-bottom:3px;color:var(--text-primary)">${escHtml(r.title||'Phòng lì xì')}</div>
      <div style="font-size:.74rem;color:rgba(255,215,0,.5);margin-bottom:8px">👤 ${escHtml(r.host_name||'—')}</div>
      <div style="font-size:.7rem;color:var(--text-muted)">🧧 ${r.envelope_count||0} ô &nbsp;·&nbsp; ✅ ${r.opened_count||0} đã mở</div>
      <div style="font-size:.68rem;color:var(--text-muted);margin-top:5px">ID: ${r.id}</div>
    </div>`).join('');
}

window.switchRoom = async function(roomId) {
  saveSession(isMasterAdmin ? { master:true, lastRoom:roomId } : { roomId });
  await loadRoom(roomId);
  showTab('dashboard');
  document.querySelectorAll('[data-tab]').forEach(l=>l.classList.remove('active'));
  document.querySelector('[data-tab="dashboard"]')?.classList.add('active');
  $('top-bar-title').textContent = 'Dashboard';
};

/* ─── SETTINGS ─── */
function fillSettingsForm() {
  if (!currentRoom) return;
  setVal('cfg-title',        currentRoom.title||'');
  setVal('cfg-subtitle',     currentRoom.subtitle||'');
  setVal('cfg-footer',       roomConfig.footerText||'✦ Chúc mừng năm mới ✦');
  setVal('cfg-section-label',roomConfig.sectionLabel||'✦ Chọn một phong bì may mắn ✦');
  setVal('cfg-closed-title', roomConfig.gameClosedTitle||'Game đã đóng');
  setVal('cfg-closed-msg',   roomConfig.gameClosedMsg||'Trò chơi hiện không mở. Liên hệ chủ phòng!');
  setChk('cfg-game-open',    currentRoom.is_open!==false);
  setChk('cfg-show-players', roomConfig.showPlayerCount!==false);
  setChk('cfg-show-value',   roomConfig.showValue!==false);
  setVal('cfg-confetti',     roomConfig.confettiCount||80);
  setVal('cfg-total-envs',   roomConfig.totalEnvelopes||gameData.length||20);
  setVal('cfg-num-specials', (roomConfig.specialValues||[50,100]).length);

  buildDistGrid();
  buildSpecialValInputs(roomConfig.specialValues||[50,100]);

  const msgs = roomConfig.messages||{};
  setVal('msg-low',  (msgs.low||['Năm mới vạn sự như ý! 🌸']).join('\n'));
  setVal('msg-mid',  (msgs.mid||['Phú quý vinh hoa! 🎋']).join('\n'));
  setVal('msg-high', (msgs.high||['Đại cát đại lợi! 💰']).join('\n'));

  $('cfg-num-specials')?.addEventListener('change', () => {
    const n=parseInt($('cfg-num-specials').value)||2;
    buildSpecialValInputs(Array.from({length:n},(_,i)=>(roomConfig.specialValues||[])[i]||(i+1)*50));
  });
}

function buildDistGrid() {
  const dg=$('dist-grid');
  if(!dg) return;
  const dist=roomConfig.distribution||{1:2,2:2,3:2,5:3,10:4,15:2,20:5};
  dg.innerHTML=[1,2,3,5,10,15,20].map(v=>`
    <div class="dist-item">
      <label>${v}k</label>
      <input type="number" id="dist-${v}" min="0" max="50" value="${dist[v]||0}"/>
    </div>`).join('');
}

function buildSpecialValInputs(vals) {
  const c=$('special-val-inputs');
  if(!c) return;
  const n=Array.isArray(vals)?vals.length:2;
  c.innerHTML=Array.from({length:Math.min(n,10)},(_,i)=>`
    <div class="form-group">
      <label class="form-label">Giải đặc biệt ${i+1} (k)</label>
      <input class="form-input" id="sv-${i}" type="number" value="${vals[i]||(i+1)*50}" min="1"/>
    </div>`).join('');
}

async function saveConfig(updates) {
  if (!currentRoom) return false;
  const newCfg = { ...roomConfig, ...updates };
  const { error } = await sb.from('rooms').update({ config:newCfg }).eq('id', currentRoom.id);
  if (error) { showToast('❌ Lỗi lưu: '+error.message,'error'); return false; }
  roomConfig = newCfg;
  return true;
}

/* ─── SAVE TEXT ─── */
async function saveTextSettings() {
  const updates = {
    footerText:    $('cfg-footer')?.value||'',
    sectionLabel:  $('cfg-section-label')?.value||'',
    gameClosedTitle: $('cfg-closed-title')?.value||'',
    gameClosedMsg: $('cfg-closed-msg')?.value||'',
  };
  // Also update room title/subtitle directly
  await sb.from('rooms').update({
    title:    $('cfg-title')?.value||currentRoom.title,
    subtitle: $('cfg-subtitle')?.value||currentRoom.subtitle,
  }).eq('id',currentRoom.id);
  currentRoom.title    = $('cfg-title')?.value||currentRoom.title;
  currentRoom.subtitle = $('cfg-subtitle')?.value||currentRoom.subtitle;
  const ok = await saveConfig(updates);
  if (ok) showToast('✓ Đã lưu nội dung','success');
}

/* ─── SAVE GAME ─── */
async function saveGameSettings() {
  const open = $('cfg-game-open')?.checked ?? true;
  await sb.from('rooms').update({ is_open:open }).eq('id',currentRoom.id);
  currentRoom.is_open = open;
  updateGameStatus(open);
  const ok = await saveConfig({
    showPlayerCount: $('cfg-show-players')?.checked ?? true,
    showValue:       $('cfg-show-value')?.checked ?? true,
    confettiCount:   parseInt($('cfg-confetti')?.value)||80,
  });
  if (ok) showToast('✓ Đã lưu cài đặt game','success');
}

/* ─── SAVE DISTRIBUTION ─── */
async function saveDistSettings() {
  const dist={};
  [1,2,3,5,10,15,20].forEach(v=>{const n=parseInt($(`dist-${v}`)?.value)||0;if(n>0)dist[v]=n;});
  const total   = parseInt($('cfg-total-envs')?.value)||20;
  const nSpec   = parseInt($('cfg-num-specials')?.value)||0;
  const svArr   = Array.from({length:nSpec},(_,i)=>parseInt($(`sv-${i}`)?.value)||(i+1)*50);
  const ok = await saveConfig({ distribution:dist, totalEnvelopes:total, specialValues:svArr });
  if (ok) showToast('✓ Đã lưu cấu hình mệnh giá. Tạo game mới để áp dụng.','success');
}

/* ─── SAVE MESSAGES ─── */
async function saveMsgSettings() {
  const messages = {
    low:  ($('msg-low')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
    mid:  ($('msg-mid')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
    high: ($('msg-high')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
  };
  const ok = await saveConfig({ messages });
  if (ok) showToast('✓ Đã lưu lời chúc','success');
}

/* ─── SAVE ACCOUNT ─── */
async function saveAccountSettings() {
  const newPass    = $('cfg-new-pass')?.value;
  const confirmPass= $('cfg-confirm-pass')?.value;
  if (!newPass) { showToast('Nhập mật khẩu mới','error'); return; }
  if (newPass !== confirmPass) { showToast('Mật khẩu không khớp!','error'); return; }
  const newHash = btoa(unescape(encodeURIComponent(newPass + ':lixi_salt_2025')));
  const { error } = await sb.from('rooms').update({ pass_hash:newHash }).eq('id',currentRoom.id);
  if (error) { showToast('❌ Lỗi: '+error.message,'error'); return; }
  saveSession(isMasterAdmin ? { master:true } : { roomId:currentRoom.id });
  showToast('✓ Đã đổi mật khẩu thành công','success');
  $('cfg-new-pass').value=''; $('cfg-confirm-pass').value='';
}

/* ─── GAME ACTIONS ─── */
async function toggleGameOpen() {
  if (!currentRoom) return;
  const newOpen = !currentRoom.is_open;
  await sb.from('rooms').update({ is_open:newOpen }).eq('id',currentRoom.id);
  currentRoom.is_open = newOpen;
  updateGameStatus(newOpen);
  showToast(newOpen ? '🟢 Game đã MỞ' : '🔴 Game đã ĐÓNG', newOpen?'success':'info');
}

async function resetGame() {
  if (!currentRoom) return;
  for (const e of gameData) {
    await sb.from('envelopes').update({opened:false,opened_at:null,opened_by:null}).eq('id',e._dbId);
    e.opened=false; e.openedAt=null; e.openedBy='';
  }
  await sb.from('events').delete().eq('room_id',currentRoom.id);
  await sb.from('rooms').update({opened_count:0}).eq('id',currentRoom.id);
  players=[]; renderAll();
  showToast('✓ Đã reset game thành công','success');
}

async function createNewGame() {
  if (!currentRoom) return;
  const dist  = roomConfig.distribution||{1:2,2:2,3:2,5:3,10:4,15:2,20:5};
  const sv    = roomConfig.specialValues||[50,100];
  const total = roomConfig.totalEnvelopes||20;

  // Build pool
  let pool=[];
  Object.entries(dist).forEach(([v,c])=>{ for(let i=0;i<c;i++) pool.push(parseInt(v)); });
  while(pool.length < total-sv.length) pool.push(10);
  pool = shuffle(pool).slice(0, total-sv.length);

  const svShuffled = shuffle([...sv]);
  const allPos = shuffle(Array.from({length:total},(_,i)=>i));
  const spPos  = new Set(allPos.slice(0,sv.length));

  // Delete old envelopes
  await sb.from('envelopes').delete().eq('room_id',currentRoom.id);
  await sb.from('events').delete().eq('room_id',currentRoom.id);

  // Insert new
  const rows=[];
  let ni=0, si=0;
  for(let i=0;i<total;i++){
    if(spPos.has(i)){
      const displayVals=Object.keys(dist).map(Number).filter(v=>v<=20);
      const display=displayVals[Math.floor(Math.random()*displayVals.length)]||10;
      rows.push({room_id:currentRoom.id,position:i,display_value:display,real_value:svShuffled[si%svShuffled.length],is_special:true,opened:false,opened_at:null,opened_by:null});
      si++;
    } else {
      rows.push({room_id:currentRoom.id,position:i,display_value:pool[ni%pool.length]||10,real_value:pool[ni%pool.length]||10,is_special:false,opened:false,opened_at:null,opened_by:null});
      ni++;
    }
  }
  const { data, error } = await sb.from('envelopes').insert(rows).select();
  if(error){showToast('❌ '+error.message,'error');return;}
  await sb.from('rooms').update({opened_count:0,envelope_count:total}).eq('id',currentRoom.id);
  gameData=data.map(r=>({id:r.position+1,displayValue:r.display_value,realValue:r.real_value,isSpecial:r.is_special,opened:false,openedAt:null,openedBy:'',_dbId:r.id,position:r.position}));
  players=[];
  renderAll();
  showToast('🎉 Đã tạo game mới thành công!','success');
}

/* ─── EXPORT CSV ─── */
function exportCSV() {
  if (!currentRoom) { showToast('Chưa chọn phòng','error'); return; }
  const rows=[
    ['ID','Loại','Hiển thị','Thực','Trạng thái','Người bốc','Thời gian mở'],
    ...gameData.map(e=>[
      '#'+String(e.id).padStart(2,'0'),
      e.isSpecial?'Đặc biệt':'Thường',
      e.displayValue+'k', e.realValue+'k',
      e.opened?'Đã mở':'Chưa mở',
      e.openedBy||'—',
      e.openedAt?new Date(e.openedAt).toLocaleString('vi-VN'):'—'
    ])
  ];
  const csv=rows.map(r=>r.join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`lixi-${currentRoom.id}-${new Date().toLocaleDateString('vi-VN').replace(/\//g,'-')}.csv`;
  a.click();
  showToast('📥 Đã xuất CSV','success');
}

/* ─── NAVIGATION ─── */
function setupNavigation() {
  document.querySelectorAll('[data-tab]').forEach(link=>{
    link.addEventListener('click',()=>{
      document.querySelectorAll('[data-tab]').forEach(l=>l.classList.remove('active'));
      link.classList.add('active');
      const tab=link.dataset.tab;
      showTab(tab);
      $('top-bar-title').textContent=link.querySelector('.nav-label')?.textContent||tab;
      if(tab==='notifications'){notifCount=0;updateNotifBadge();renderNotifs();}
      if(tab==='rooms'&&isMasterAdmin) loadAllRooms();
      if(tab==='edit-envelopes') renderEnvBulkEditor();
    });
  });
}

function showTab(tab) {
  document.querySelectorAll('.tab-section').forEach(s=>s.classList.remove('active'));
  $('tab-'+tab)?.classList.add('active');
}

/* ─── CONTROLS ─── */
function setupControls() {
  $('env-search')?.addEventListener('input',()=>renderEnvTable($('env-filter')?.value,$('env-search').value));
  $('env-filter')?.addEventListener('change',()=>renderEnvTable($('env-filter').value,$('env-search')?.value));
  $('logout-btn')?.addEventListener('click',()=>{clearSession();location.href='/';});
  $('refresh-btn')?.addEventListener('click',async()=>{
    if(currentRoom){[gameData,players]=await Promise.all([loadEnvelopes(currentRoom.id),loadPlayers(currentRoom.id)]);renderAll();}
    if(isMasterAdmin) loadAllRooms();
    showToast('↺ Đã làm mới','info');
  });
  $('export-btn')?.addEventListener('click', exportCSV);
  $('new-game-btn')?.addEventListener('click',()=>showConfirm('Tạo game mới?','Xóa toàn bộ dữ liệu hiện tại và tạo phân phối mới.',createNewGame));
  $('reset-game-btn')?.addEventListener('click',()=>showConfirm('Reset trạng thái?','Tất cả ô trở về chưa mở, xóa lịch sử bốc.',resetGame));
  $('toggle-game-btn')?.addEventListener('click', toggleGameOpen);
  $('save-all-envs-btn')?.addEventListener('click', saveAllEnvelopes);
  $('shuffle-envs-btn')?.addEventListener('click', shuffleEnvelopes);
  $('save-text-btn')?.addEventListener('click', saveTextSettings);
  $('save-game-btn')?.addEventListener('click', saveGameSettings);
  $('save-dist-btn')?.addEventListener('click', saveDistSettings);
  $('save-msg-btn')?.addEventListener('click', saveMsgSettings);
  $('save-account-btn')?.addEventListener('click', saveAccountSettings);
}

/* ─── MODAL ─── */
function showModal({title,body,confirmText='✓ Xác nhận',onConfirm}) {
  $('generic-modal')?.remove();
  const m=document.createElement('div');
  m.id='generic-modal'; m.className='admin-modal-overlay';
  m.innerHTML=`
    <div class="admin-modal-card">
      <div class="admin-modal-header">
        <span class="admin-modal-title">${title}</span>
        <button class="admin-modal-close" id="mc-x">✕</button>
      </div>
      <div class="admin-modal-body">${body}</div>
      <div class="admin-modal-footer">
        <button class="action-btn action-btn-gold" style="width:auto;margin-top:0" id="mc-ok">${confirmText}</button>
        <button class="action-btn" style="width:auto;margin-top:0;background:rgba(255,255,255,.04);color:var(--text-secondary);border:1px solid var(--border)" id="mc-cancel">Huỷ</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  $('mc-x').onclick=$('mc-cancel').onclick=()=>m.remove();
  $('mc-ok').onclick=()=>{m.remove();onConfirm();};
  m.addEventListener('click',e=>{if(e.target===m)m.remove();});
}

function showConfirm(title,msg,onConfirm) {
  showModal({title,body:`<p style="color:var(--text-secondary);line-height:1.65;font-size:.9rem">${msg}</p>`,confirmText:'✓ Xác nhận',onConfirm});
}

/* ─── TOAST ─── */
const toastEl=$('toast');
let toastTimer;
function showToast(msg,type='info') {
  if(!toastEl) return;
  toastEl.textContent=msg;
  toastEl.className=`toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.classList.remove('show'),3500);
}

/* ─── UTILS ─── */
function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
