// ════════════════════════════════════════════════════════════════
// FITFLOW PRO — Weekly Report Card
// Auto-generated weekly summary shown every Monday
// ════════════════════════════════════════════════════════════════

function openWeeklyReport() {
  showPage('page-weekly-report');
  renderWeeklyReport();
}

function renderWeeklyReport() {
  const user     = APP.currentUser;
  const allLogs  = Store.getUserLogs(user.id);
  const runLogs  = Store.getUserRunLogs(user.id);
  const cwLogs   = allLogs.filter(l => l.module.startsWith('custom_'));
  const stdLogs  = allLogs.filter(l => !l.module.startsWith('custom_'));

  // ── This week ──────────────────────────────────────────────────
  const monday    = getMonday();
  const sunday    = getSunday();
  const weekLogs  = stdLogs.filter(l => l.date >= monday && l.date <= sunday);
  const weekRuns  = runLogs.filter(r => r.date >= monday && r.date <= sunday);
  const weekCW    = cwLogs.filter(l => l.date >= monday && l.date <= sunday);

  // ── Last week ──────────────────────────────────────────────────
  const lastMon   = getPrevMonday();
  const lastSun   = getPrevSunday();
  const lastLogs  = stdLogs.filter(l => l.date >= lastMon && l.date <= lastSun);
  const lastRuns  = runLogs.filter(r => r.date >= lastMon && r.date <= lastSun);

  // ── Stats ──────────────────────────────────────────────────────
  const activeDays    = [...new Set(weekLogs.map(l=>l.date))].length;
  const totalWorkouts = weekLogs.length + weekCW.length;
  const totalRunKm    = weekRuns.reduce((a,r)=>a+(r.distance||0),0);
  const totalRunTime  = weekRuns.reduce((a,r)=>a+(r.duration||0),0);
  const streak        = calcStreak(user.id);

  // Module breakdown
  const modCounts = {};
  weekLogs.forEach(l => { modCounts[l.module] = (modCounts[l.module]||0)+1; });

  // Vs last week
  const lastTotal   = lastLogs.length;
  const lastRunKm   = lastRuns.reduce((a,r)=>a+(r.distance||0),0);
  const wowWorkouts = totalWorkouts - lastTotal;
  const wowKm       = totalRunKm - lastRunKm;

  // Day-by-day activity grid
  const days7 = getLast7Days();
  const dayGrid = days7.map(d => {
    const dayLogs = allLogs.filter(l => l.date === d);
    // FIX: custom_* module IDs should always map to the custom emoji fallback
    const emojis  = [...new Set(dayLogs.map(l => getModuleEmoji(l.module.startsWith('custom_') ? 'custom' : l.module)))];
    const isToday = d === todayStr();
    const isFuture = d > todayStr();
    return { date: d, emojis, isToday, isFuture, count: dayLogs.length };
  });

  // Grade
  const grade = activeDays >= 6 ? { letter:'A+', label:'Outstanding!', color:'var(--g4)'     }
              : activeDays >= 5 ? { letter:'A',  label:'Excellent!',   color:'var(--g4)'     }
              : activeDays >= 4 ? { letter:'B',  label:'Great job!',   color:'#43a05a'        }
              : activeDays >= 3 ? { letter:'C',  label:'Good effort',  color:'var(--accent)'  }
              : activeDays >= 2 ? { letter:'D',  label:'Keep going!',  color:'#fb8c00'        }
              :                   { letter:'F',  label:"Let's start!", color:'var(--danger)'  };

  // ── Render ─────────────────────────────────────────────────────
  const container = document.getElementById('weekly-report-content');
  container.innerHTML = `

    <!-- Header card with grade -->
    <div class="card" style="background:linear-gradient(135deg,var(--g1),var(--bg2));margin-bottom:16px;text-align:center;padding:28px 20px">
      <div style="font-size:13px;color:var(--text2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em">Week of ${formatDate(monday)}</div>
      <div style="font-family:var(--font-display);font-size:80px;color:${grade.color};line-height:1;margin:8px 0">${grade.letter}</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:4px">${grade.label}</div>
      <div style="font-size:14px;color:var(--text2)">${activeDays} active days this week · ${streak} day streak 🔥</div>
    </div>

    <!-- Stats grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      ${statCard(totalWorkouts, 'Workouts', wowWorkouts, '💪')}
      ${statCard(activeDays, 'Active Days', activeDays - [...new Set(lastLogs.map(l=>l.date))].length, '📅')}
      ${statCard(totalRunKm.toFixed(1)+'km', 'Distance Run', null, '🏃', wowKm !== 0 ? (wowKm > 0 ? '+'+wowKm.toFixed(1)+'km' : wowKm.toFixed(1)+'km') : null)}
      ${statCard(fmtTime(totalRunTime), 'Time Running', null, '⏱')}
    </div>

    <!-- 7-day activity grid -->
    <div class="card card-sm" style="margin-bottom:16px">
      <div class="section-title" style="margin-bottom:12px">This Week</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
        ${['M','T','W','T','F','S','S'].map(d=>`<div style="text-align:center;font-size:11px;color:var(--text3);font-weight:600">${d}</div>`).join('')}
        ${dayGrid.map(d => `
          <div style="
            aspect-ratio:1; border-radius:8px; display:flex; flex-direction:column;
            align-items:center; justify-content:center; font-size:11px;
            background:${d.isFuture ? 'transparent' : d.count > 0 ? 'var(--g3)' : 'rgba(229,57,53,0.2)'};
            border:${d.isToday ? '2px solid var(--accent)' : d.isFuture ? '1px dashed var(--border)' : 'none'};
            color:${d.isFuture ? 'var(--text3)' : d.count > 0 ? 'white' : '#ef9a9a'};
          " title="${d.date}">
            ${d.isFuture ? '' : d.count > 0
              ? `<span style="font-size:14px">${d.emojis[0]||'💪'}</span>${d.count>1?`<span style="font-size:9px">+${d.count-1}</span>`:''}`
              : '<span style="font-size:14px">✕</span>'}
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--text3)">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--g3);margin-right:4px;vertical-align:middle"></span>Active</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(229,57,53,0.2);margin-right:4px;vertical-align:middle"></span>Missed</span>
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;border:2px solid var(--accent);margin-right:4px;vertical-align:middle"></span>Today</span>
      </div>
    </div>

    <!-- Module breakdown -->
    ${Object.keys(modCounts).length > 0 ? `
    <div class="card card-sm" style="margin-bottom:16px">
      <div class="section-title" style="margin-bottom:12px">Activity Breakdown</div>
      ${Object.entries(modCounts).map(([mod, count]) => `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:20px;width:28px;text-align:center">${getModuleEmoji(mod)}</span>
          <div style="flex:1">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:13px;font-weight:600">${getModuleName(mod)}</span>
              <span style="font-size:13px;color:var(--text3)">${count} session${count>1?'s':''}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${Math.min(100, count/7*100)}%"></div>
            </div>
          </div>
        </div>`).join('')}
    </div>` : ''}

    <!-- Running summary -->
    ${weekRuns.length > 0 ? `
    <div class="card card-sm" style="margin-bottom:16px;background:linear-gradient(135deg,rgba(67,160,90,0.1),rgba(30,136,229,0.1))">
      <div class="section-title" style="margin-bottom:12px">🏃 Running This Week</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
        <div><div style="font-family:var(--font-display);font-size:28px;color:var(--g5)">${weekRuns.length}</div><div style="font-size:11px;color:var(--text3)">Runs</div></div>
        <div><div style="font-family:var(--font-display);font-size:28px;color:var(--g5)">${totalRunKm.toFixed(1)}</div><div style="font-size:11px;color:var(--text3)">km</div></div>
        <div><div style="font-family:var(--font-display);font-size:28px;color:var(--g5)">${fmtTime(totalRunTime)}</div><div style="font-size:11px;color:var(--text3)">Time</div></div>
      </div>
    </div>` : ''}

    <!-- Motivational message based on grade -->
    <div class="card" style="background:rgba(46,125,70,0.1);border-color:rgba(46,125,70,0.25);text-align:center;padding:20px">
      <div style="font-size:24px;margin-bottom:8px">${getMotivationalEmoji(activeDays)}</div>
      <div style="font-size:14px;color:var(--text);line-height:1.6;font-style:italic">"${getMotivationalMessage(activeDays)}"</div>
    </div>
  `;
}

// ── HELPERS ───────────────────────────────────────────────────────
function statCard(val, label, diff, emoji, diffLabel) {
  const diffStr = diffLabel || (diff !== null && diff !== undefined
    ? (diff > 0 ? `+${diff} vs last week` : diff < 0 ? `${diff} vs last week` : 'Same as last week')
    : '');
  const diffColor = diff > 0 ? 'var(--g5)' : diff < 0 ? '#ef9a9a' : 'var(--text3)';
  return `
    <div class="stat-card">
      <div style="font-size:18px;margin-bottom:4px">${emoji}</div>
      <div style="font-family:var(--font-display);font-size:32px;color:var(--g5);line-height:1">${val}</div>
      <div style="font-size:12px;color:var(--text3);margin-top:3px">${label}</div>
      ${diffStr ? `<div style="font-size:11px;color:${diffColor};margin-top:3px">${diffStr}</div>` : ''}
    </div>`;
}

function getSunday() {
  const d = new Date(getMonday());
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}
function getPrevMonday() {
  const d = new Date(getMonday());
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}
function getPrevSunday() {
  const d = new Date(getPrevMonday());
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}
function getLast7Days() {
  const days = [];
  const mon  = new Date(getMonday());
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { month:'short', day:'numeric', year:'numeric' });
}
function getMotivationalEmoji(days) {
  return days >= 5 ? '🔥' : days >= 3 ? '💪' : days >= 1 ? '👍' : '💡';
}
function getMotivationalMessage(days) {
  const msgs = {
    6: "You crushed it this week! Elite consistency. Keep this energy going!",
    5: "Phenomenal week! 5 active days shows real dedication. You're building something special.",
    4: "Solid week! 4 days of training puts you ahead of 90% of people. Keep pushing!",
    3: "Good effort this week! 3 days is a great foundation. Can we hit 4 next week?",
    2: "You showed up twice — that matters. Every session builds the habit. Keep going!",
    1: "One session is better than zero. The hardest part is starting. See you tomorrow?",
    0: "New week, fresh start. Your body is ready. Let's make this week count! 🚀",
  };
  return msgs[Math.min(days, 6)] || msgs[0];
}
