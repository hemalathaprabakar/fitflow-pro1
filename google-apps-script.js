// ════════════════════════════════════════════════════════════════
// FITFLOW PRO — Google Apps Script Backend v6
// Pure VAPID Web Push — NO Firebase, NO service account JSON
//
// ── WHAT'S NEW IN v6 ─────────────────────────────────────────────
// • getAllCustomWorkouts endpoint added (admin panel fix)
// • setTempPassword endpoint added (admin force-change-on-login)
// • logCompletion now always stores email correctly
// • PBs restored correctly on reinstall via Content sheet
// • Hydration water intake now syncs to HydrationLog sheet
//
// ── FIRST TIME SETUP ─────────────────────────────────────────────
// 1. Open your Google Sheet → Extensions → Apps Script
// 2. Replace ALL existing code with this file
// 3. Project Settings (⚙️) → Script Properties → Add:
//      VAPID_PRIVATE_KEY  =  <your private key>
//      VAPID_PUBLIC_KEY   =  <your public key>
//      VAPID_SUBJECT      =  mailto:admin@yourapp.com
// 4. Run fixExistingSheet() once
// 5. Run setupSheets() once
// 6. Run migrateRunningLog() once
// 7. Deploy → Manage Deployments → Edit → New Version → Deploy
// 8. Run createDailyTrigger() to schedule 6 AM notifications
// ════════════════════════════════════════════════════════════════

const SHEETS = {
  USERS:           'Users',
  LOGS:            'CompletionLog',
  RUN_LOGS:        'RunningLog',
  HYDRATION_LOGS:  'HydrationLog',
  CONTENT:         'Content',
  FEEDBACK:        'UserFeedback',
  CUSTOM_WORKOUTS: 'CustomWorkouts',
  PUSH_SUBS:       'PushSubscriptions',
};

const COL = {
  ID: 0, NAME: 1, EMAIL: 2, PASSWORD: 3, TEMP_PASSWORD: 4,
  IS_FIRST_LOGIN: 5, ROLE: 6, STATUS: 7,
  CREATED_DATE: 8, CREATED_BY: 9, LAST_LOGIN: 10,
};

const RCOL = {
  LOG_ID: 0, USER_ID: 1, USER_EMAIL: 2, DATE: 3,
  DISTANCE: 4, DURATION: 5, PACE: 6, PLAN_TYPE: 7,
  TIMESTAMP: 8, ACTIVITY_TYPE: 9, COORDS_JSON: 10,
};

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── doGET ─────────────────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter || {};
  let result;
  try {
    switch (p.action) {
      case 'ping':               result = { success:true, message:'FitFlow Pro API v6 online!', time:new Date().toISOString() }; break;
      case 'login':
        if (p.pwcodes) {
          const pw = p.pwcodes.split('-').map(c => String.fromCharCode(parseInt(c))).join('');
          result = handleLogin(p.email, pw);
        } else {
          result = handleLogin(p.email, p.password);
        }
        break;
      case 'getAllUsers':         result = { success:true, users:getAllUsers() };            break;
      case 'getUserLogs':        result = { success:true, logs:getUserLogs(p.userId) };     break;
      case 'getAllLogs':          result = { success:true, logs:getAllLogs() };              break;
      case 'getUserRunLogs':     result = { success:true, logs:getUserRunLogs(p.userId) };  break;
      case 'getAllRunLogs':       result = { success:true, logs:getAllRunLogs() };           break;
      case 'deleteRunLog':       result = deleteRunLog(p.logId, p.userId);                   break;
      case 'getActivePlan':      result = getActivePlan(p.userId);                          break;
      case 'getPlanProgress':    result = getPlanProgress(p.userId, p.planKey);             break;
      case 'getContent':         result = { success:true, content:getContent(p.key) };     break;
      case 'getAllContent':       result = getAllContent();                                  break;
      case 'getFeedback':        result = getFeedback();                                    break;
      case 'getCustomWorkouts':  result = getCustomWorkouts(p.userId);                      break;
      case 'getAllCustomWorkouts':result = getAllCustomWorkouts();                            break; // ← NEW v6
      case 'getHydrationLogs':   result = getHydrationLogs(p.userId);                      break;
      default:                   result = { success:false, error:'Unknown action: ' + p.action };
    }
  } catch(err) { result = { success:false, error:err.message }; }
  return jsonOut(result);
}

// ── doPOST ────────────────────────────────────────────────────────
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch {}
  let result;
  try {
    switch (body.action) {
      case 'createUser':            result = createUser(body);            break;
      case 'login':                 result = handleLogin(body.email, body.password); break;
      case 'changePassword':        result = changePassword(body);        break;
      case 'setTempPassword':       result = setTempPassword(body);       break; // ← NEW v6
      case 'updateUserStatus':      result = updateUserStatus(body);      break;
      case 'deleteUser':            result = deleteUser(body);            break;
      case 'logCompletion':         result = logCompletion(body);         break;
      case 'logRun':                result = logRun(body);                break;
      case 'savePlanRegistration':  result = savePlanRegistration(body);  break;
      case 'savePlanDayCompletion': result = savePlanDayCompletion(body); break;
      case 'clearActivePlan':       result = clearActivePlan(body);       break;
      case 'saveContent':           result = saveContent(body);           break;
      case 'submitFeedback':        result = submitFeedback(body);        break;
      case 'saveCustomWorkout':     result = saveCustomWorkout(body);     break;
      case 'deleteCustomWorkout':   result = deleteCustomWorkout(body);   break;
      case 'savePushSubscription':  result = savePushSubscription(body);  break;
      case 'removePushSubscription':result = removePushSubscription(body);break;
      case 'saveHydrationLog':      result = saveHydrationLog(body);      break;
      case 'deleteRunLog':          result = deleteRunLog(body.logId, body.userId); break;
      default: result = { success:false, error:'Unknown action: ' + body.action };
    }
  } catch(err) { result = { success:false, error:err.message }; }
  return jsonOut(result);
}

// ════════════════════════════════════════════════════════════════
// SETUP & MIGRATION
// ════════════════════════════════════════════════════════════════
function fixExistingSheet() {
  const sh   = getSheet(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  const firstCell = (data[0][0] || '').toString().trim().toLowerCase();
  const isHeader  = firstCell === 'userid' || firstCell === 'id';

  if (!isHeader) {
    sh.insertRowBefore(1);
    const headers = ['UserID','Name','Email','Password','TempPassword','IsFirstLogin','Role','Status','CreatedDate','CreatedBy','LastLogin'];
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    styleHeader(sh, headers.length);
    SpreadsheetApp.flush();
  }

  const allData = sh.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    if (!row[COL.ROLE]   || !row[COL.ROLE].toString().trim())   sh.getRange(i+1,COL.ROLE+1).setValue('USER');
    if (!row[COL.STATUS] || !row[COL.STATUS].toString().trim())  sh.getRange(i+1,COL.STATUS+1).setValue('ACTIVE');
    if (row[COL.IS_FIRST_LOGIN]===''||row[COL.IS_FIRST_LOGIN]===null) {
      sh.getRange(i+1,COL.IS_FIRST_LOGIN+1).setValue(!row[COL.PASSWORD]);
    }
    if (!row[COL.CREATED_DATE]||!row[COL.CREATED_DATE].toString().trim()) {
      sh.getRange(i+1,COL.CREATED_DATE+1).setValue(new Date().toISOString().split('T')[0]);
    }
  }

  const fresh    = sh.getDataRange().getValues();
  const hasAdmin = fresh.slice(1).some(r => (r[COL.ROLE]||'').toString().toUpperCase()==='ADMIN');
  if (!hasAdmin) {
    sh.appendRow(['u_admin','Admin User','admin@fitflow.com','admin123','',false,'ADMIN','ACTIVE',
      new Date().toISOString().split('T')[0],'System','']);
  }
  SpreadsheetApp.flush();
  Logger.log('✅ Sheet fixed! Now run setupSheets() and migrateRunningLog(), then redeploy.');
}

function setupSheets() {
  const userSh = getSheet(SHEETS.USERS);
  if (userSh.getLastRow()===0) {
    userSh.appendRow(['UserID','Name','Email','Password','TempPassword','IsFirstLogin','Role','Status','CreatedDate','CreatedBy','LastLogin']);
    styleHeader(userSh,11);
    userSh.appendRow(['u_admin','Admin User','admin@fitflow.com','admin123','',false,'ADMIN','ACTIVE',new Date().toISOString().split('T')[0],'System','']);
  }
  _ensureSheet(SHEETS.LOGS,           ['LogID','UserID','UserEmail','Module','Day','Date','Timestamp']);
  _ensureSheet(SHEETS.RUN_LOGS,       ['LogID','UserID','UserEmail','Date','Distance_km','Duration_sec','Pace_min_km','PlanType','Timestamp','ActivityType','CoordsJSON','Title','Description']);
  _ensureSheet(SHEETS.HYDRATION_LOGS, ['LogID','UserID','UserEmail','Date','GlassesTarget','GlassesDone','Timestamp']);
  _ensureSheet(SHEETS.CONTENT,        ['Key','Value','UpdatedAt']);
  _ensureSheet(SHEETS.FEEDBACK,       ['FeedbackID','UserID','Name','Email','Category','Rating','Message','Date','Timestamp']);
  _ensureSheet(SHEETS.PUSH_SUBS,      ['UserID','Name','Email','Endpoint','P256DH','Auth','SavedAt','Active']);
  _ensureSheet(SHEETS.CUSTOM_WORKOUTS,['WorkoutID','UserID','UserEmail','Name','ExercisesJSON','CreatedDate','UpdatedDate','Active']);
  Logger.log('✅ All sheets ready!');
}

function _ensureSheet(name, headers) {
  const sh = getSheet(name);
  if (sh.getLastRow()===0) { sh.appendRow(headers); styleHeader(sh,headers.length); }
}

function migrateRunningLog() {
  const sh   = getSheet(SHEETS.RUN_LOGS);
  const data = sh.getDataRange().getValues();
  if (!data.length) { Logger.log('RunningLog is empty — nothing to migrate.'); return; }

  const header = data[0].map(h => (h||'').toString().trim().toLowerCase());
  const hasActivityType = header.includes('activitytype');
  const hasCoordsJson   = header.includes('coordsjson');
  const hasTitle        = header.includes('title');
  const hasDescription  = header.includes('description');

  let colsAdded = 0;
  if (!hasActivityType) {
    const nextCol = data[0].length + colsAdded + 1;
    sh.getRange(1, nextCol).setValue('ActivityType');
    sh.getRange(1, nextCol).setFontWeight('bold').setBackground('#1B5E20').setFontColor('#FFFFFF');
    for (let i = 2; i <= sh.getLastRow(); i++) sh.getRange(i, nextCol).setValue('run');
    colsAdded++;
    Logger.log('Added ActivityType column');
  }
  if (!hasCoordsJson) {
    const nextCol = data[0].length + colsAdded + 1;
    sh.getRange(1, nextCol).setValue('CoordsJSON');
    sh.getRange(1, nextCol).setFontWeight('bold').setBackground('#1B5E20').setFontColor('#FFFFFF');
    for (let i = 2; i <= sh.getLastRow(); i++) sh.getRange(i, nextCol).setValue('[]');
    colsAdded++;
    Logger.log('Added CoordsJSON column');
  }
  if (!hasTitle) {
    const nextCol = data[0].length + colsAdded + 1;
    sh.getRange(1, nextCol).setValue('Title');
    sh.getRange(1, nextCol).setFontWeight('bold').setBackground('#1B5E20').setFontColor('#FFFFFF');
    for (let i = 2; i <= sh.getLastRow(); i++) sh.getRange(i, nextCol).setValue('');
    colsAdded++;
    Logger.log('Added Title column');
  }
  if (!hasDescription) {
    const nextCol = data[0].length + colsAdded + 1;
    sh.getRange(1, nextCol).setValue('Description');
    sh.getRange(1, nextCol).setFontWeight('bold').setBackground('#1B5E20').setFontColor('#FFFFFF');
    for (let i = 2; i <= sh.getLastRow(); i++) sh.getRange(i, nextCol).setValue('');
    colsAdded++;
    Logger.log('Added Description column');
  }

  if (colsAdded === 0) {
    Logger.log('RunningLog already up to date — no migration needed.');
  }
  SpreadsheetApp.flush();
  Logger.log('✅ Migration complete! Redeploy now.');
}

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════
function handleLogin(email, password) {
  if (!email||!password) return { success:false, error:'Email and password required.' };
  const sh   = getSheet(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if ((row[COL.EMAIL]||'').toString().toLowerCase().trim() !== email.toLowerCase().trim()) continue;
    const status = (row[COL.STATUS]||'ACTIVE').toString().toUpperCase().trim();
    if (status==='INACTIVE') return { success:false, error:'Account deactivated. Contact admin.' };
    const storedPass = (row[COL.PASSWORD]||'').toString().trim();
    const tempPass   = (row[COL.TEMP_PASSWORD]||'').toString().trim();
    const entered    = (password||'').toString().trim();
    if (!(storedPass&&storedPass===entered) && !(tempPass&&tempPass===entered))
      return { success:false, error:'Invalid email or password.' };
    const firstLoginRaw = row[COL.IS_FIRST_LOGIN];
    const isFirstLogin  = firstLoginRaw===true||String(firstLoginRaw).toUpperCase().trim()==='TRUE';
    sh.getRange(i+1,COL.LAST_LOGIN+1).setValue(new Date().toISOString());
    SpreadsheetApp.flush();
    return { success:true, user:{
      id:          (row[COL.ID]  ||'').toString(),
      name:        (row[COL.NAME]||'').toString(),
      email:       (row[COL.EMAIL]||'').toString(),
      role:        (row[COL.ROLE]||'USER').toString().toUpperCase().trim(),
      status,
      isFirstLogin,
    }};
  }
  return { success:false, error:'Invalid email or password.' };
}

function changePassword(body) {
  const { userId, newPassword } = body;
  if (!userId||!newPassword) return { success:false, error:'userId and newPassword required.' };
  if (newPassword.length<6) return { success:false, error:'Password must be at least 6 characters.' };
  const sh   = getSheet(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if ((data[i][COL.ID]||'').toString()===userId.toString()) {
      sh.getRange(i+1,COL.PASSWORD+1).setValue(newPassword);
      sh.getRange(i+1,COL.TEMP_PASSWORD+1).setValue('');
      sh.getRange(i+1,COL.IS_FIRST_LOGIN+1).setValue(false);
      SpreadsheetApp.flush();
      return { success:true };
    }
  }
  return { success:false, error:'User not found.' };
}

// ── NEW v6: Set temp password — user will be forced to change on next login ──
function setTempPassword(body) {
  const { userId, tempPassword } = body;
  if (!userId||!tempPassword) return { success:false, error:'userId and tempPassword required.' };
  if (tempPassword.length<6) return { success:false, error:'Temp password must be at least 6 characters.' };
  const sh   = getSheet(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if ((data[i][COL.ID]||'').toString()===userId.toString()) {
      sh.getRange(i+1,COL.TEMP_PASSWORD+1).setValue(tempPassword);
      sh.getRange(i+1,COL.IS_FIRST_LOGIN+1).setValue(true); // forces change-password prompt
      SpreadsheetApp.flush();
      return { success:true };
    }
  }
  return { success:false, error:'User not found.' };
}

// ════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ════════════════════════════════════════════════════════════════
function getAllUsers() {
  const sh   = getSheet(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return [];
  return data.slice(1).map(r => ({
    id:(r[COL.ID]||'').toString(), name:(r[COL.NAME]||'').toString(),
    email:(r[COL.EMAIL]||'').toString(), role:(r[COL.ROLE]||'USER').toString().toUpperCase(),
    status:(r[COL.STATUS]||'ACTIVE').toString(),
    isFirstLogin:r[COL.IS_FIRST_LOGIN]===true||r[COL.IS_FIRST_LOGIN]==='TRUE'||r[COL.IS_FIRST_LOGIN]==='true',
    createdDate:(r[COL.CREATED_DATE]||'').toString(),
    createdBy:(r[COL.CREATED_BY]||'').toString(),
    lastLogin:(r[COL.LAST_LOGIN]||'').toString(),
  }));
}

function createUser(body) {
  const { name, email, tempPassword, role, createdBy } = body;
  if (!name||!email||!tempPassword) return { success:false, error:'name, email, tempPassword required.' };
  const sh = getSheet(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][COL.EMAIL]||'').toString().toLowerCase()===email.toLowerCase().trim())
      return { success:false, error:'A user with this email already exists.' };
  }
  const id = 'u_'+Date.now();
  sh.appendRow([id,name.trim(),email.toLowerCase().trim(),'',tempPassword,true,
    (role||'USER').toUpperCase(),'ACTIVE',new Date().toISOString().split('T')[0],createdBy||'Admin','']);
  return { success:true, userId:id };
}

function updateUserStatus(body) {
  const { userId, status } = body;
  if (!userId||!status) return { success:false, error:'userId and status required.' };
  const norm = status.toString().toUpperCase().trim();
  if (norm!=='ACTIVE'&&norm!=='INACTIVE') return { success:false, error:'Status must be ACTIVE or INACTIVE.' };
  const sh = getSheet(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][COL.ID]||'').toString().trim()!==userId.toString().trim()) continue;
    if ((data[i][COL.ROLE]||'').toString().toUpperCase()==='ADMIN'&&norm==='INACTIVE')
      return { success:false, error:'Admin accounts cannot be disabled.' };
    sh.getRange(i+1,COL.STATUS+1).setValue(norm);
    SpreadsheetApp.flush();
    return { success:true, userId, newStatus:norm };
  }
  return { success:false, error:'User not found.' };
}

function deleteUser(body) {
  const sh   = getSheet(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][COL.ID]||'').toString()===body.userId.toString()) { sh.deleteRow(i+1); return { success:true }; }
  }
  return { success:false, error:'User not found.' };
}

// ════════════════════════════════════════════════════════════════
// LOGS
// ════════════════════════════════════════════════════════════════
function logCompletion(body) {
  const sh = getSheet(SHEETS.LOGS);
  ensureHeaders(sh,['LogID','UserID','UserEmail','Module','Day','Date','Timestamp']);
  sh.appendRow([
    'log_'+Date.now(),
    body.userId  || '',
    body.email   || '',
    body.module  || '',
    body.day     || '',
    body.date    || '',
    new Date().toISOString(),
  ]);
  return { success:true };
}

function getUserLogs(userId) {
  const sh   = getSheet(SHEETS.LOGS);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return [];
  return data.slice(1).filter(r=>(r[1]||'').toString()===userId.toString())
    .map(r=>({ id:r[0], userId:r[1], email:r[2], module:r[3], day:r[4], date:r[5], timestamp:r[6] }));
}

function getAllLogs() {
  const sh   = getSheet(SHEETS.LOGS);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return [];
  return data.slice(1).map(r=>({
    id:r[0], userId:(r[1]||'').toString(), email:(r[2]||'').toString(),
    module:(r[3]||'').toString(), day:(r[4]||'').toString(),
    date:(r[5]||'').toString(), timestamp:(r[6]||'').toString()
  }));
}

// ════════════════════════════════════════════════════════════════
// RUN LOGS
// ════════════════════════════════════════════════════════════════
function logRun(body) {
  const sh = getSheet(SHEETS.RUN_LOGS);
  ensureHeaders(sh, [
    'LogID','UserID','UserEmail','Date',
    'Distance_km','Duration_sec','Pace_min_km','PlanType','Timestamp',
    'ActivityType','CoordsJSON',
  ]);

  let coordsJson = '[]';
  if (Array.isArray(body.coords) && body.coords.length) {
    const slim = body.coords.map(c => ({ lat: c.lat, lon: c.lon }));
    coordsJson = JSON.stringify(slim);
  }

  // Use the ID generated by the client so localStorage and Sheets share the same ID
  // This enables reliable deletion by ID from both stores
  sh.appendRow([
    body.id || ('run_'+Date.now()),
    body.userId       || '',
    body.email        || '',
    body.date         || '',
    body.distance     || 0,
    body.duration     || 0,
    body.pace         || 0,
    body.planType     || ('Free ' + (body.activityType || 'Run').charAt(0).toUpperCase() + (body.activityType || 'run').slice(1)),
    new Date().toISOString(),
    body.activityType || 'run',
    coordsJson,
    body.title        || '',
    body.description  || '',
  ]);
  return { success:true };
}

function getUserRunLogs(userId) {
  const sh   = getSheet(SHEETS.RUN_LOGS);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return [];

  const header    = data[0].map(h => (h||'').toString().trim().toLowerCase());
  const actCol    = header.indexOf('activitytype');
  const coordsCol = header.indexOf('coordsjson');

  return data.slice(1)
    .filter(r => (r[RCOL.USER_ID]||'').toString() === userId.toString())
    .map(r => {
      let coords = [];
      if (coordsCol >= 0 && r[coordsCol]) {
        try { coords = JSON.parse(r[coordsCol]); } catch {}
      }
      const titleCol = header.indexOf('title');
      const descCol  = header.indexOf('description');
      return {
        id:           (r[RCOL.LOG_ID]   ||'').toString(),
        userId:       (r[RCOL.USER_ID]  ||'').toString(),
        email:        (r[RCOL.USER_EMAIL]||'').toString(),
        date:         (r[RCOL.DATE]     ||'').toString(),
        distance:     parseFloat(r[RCOL.DISTANCE]) || 0,
        duration:     parseInt(r[RCOL.DURATION])   || 0,
        pace:         parseFloat(r[RCOL.PACE])     || 0,
        planType:     (r[RCOL.PLAN_TYPE]||'Free Run').toString(),
        timestamp:    (r[RCOL.TIMESTAMP]||'').toString(),
        activityType: actCol >= 0 ? (r[actCol]||'run').toString() : 'run',
        title:        titleCol >= 0 ? (r[titleCol]||'').toString() : '',
        description:  descCol  >= 0 ? (r[descCol] ||'').toString() : '',
        coords,
      };
    });
}

function deleteRunLog(logId, userId) {
  if (!logId) return { success:false, error:'logId required.' };
  const sh   = getSheet(SHEETS.RUN_LOGS);
  const data = sh.getDataRange().getValues();
  // Search by LogID in col 0, optionally verify userId in col 1
  for (let i = 1; i < data.length; i++) {
    const rowLogId = (data[i][0]||'').toString().trim();
    const rowUserId = (data[i][1]||'').toString().trim();
    if (rowLogId === logId.toString().trim()) {
      if (userId && rowUserId !== userId.toString().trim()) {
        return { success:false, error:'Unauthorized.' };
      }
      sh.deleteRow(i + 1);
      SpreadsheetApp.flush();
      return { success:true, deleted:logId };
    }
  }
  return { success:false, error:'Log not found.' };
}

function getAllRunLogs() {
  const sh   = getSheet(SHEETS.RUN_LOGS);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return [];
  const header    = data[0].map(h => (h||'').toString().trim().toLowerCase());
  const actCol    = header.indexOf('activitytype');
  const coordsCol = header.indexOf('coordsjson');
  return data.slice(1).map(r => {
    let coords = [];
    if (coordsCol >= 0 && r[coordsCol]) { try { coords = JSON.parse(r[coordsCol]); } catch {} }
    return {
      id:(r[0]||'').toString(), userId:(r[1]||'').toString(), email:(r[2]||'').toString(),
      date:(r[3]||'').toString(), distance:parseFloat(r[4])||0, duration:parseInt(r[5])||0,
      pace:parseFloat(r[6])||0, planType:(r[7]||'Free Run').toString(),
      timestamp:(r[8]||'').toString(),
      activityType: actCol >= 0 ? (r[actCol]||'run').toString() : 'run',
      coords,
    };
  });
}

// ════════════════════════════════════════════════════════════════
// CUSTOM WORKOUTS
// ════════════════════════════════════════════════════════════════
function getCustomWorkouts(userId) {
  if (!userId) return { success:false, error:'userId required.' };
  const sh   = getSheet(SHEETS.CUSTOM_WORKOUTS);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return { success:true, workouts:[] };

  const workouts = data.slice(1)
    .filter(r => {
      const uid    = (r[1]||'').toString();
      const active = r[7];
      return uid === userId.toString() && (active===true||active==='TRUE'||active==='true');
    })
    .map(r => {
      let exercises = [];
      try { exercises = JSON.parse(r[4]||'[]'); } catch {}
      return {
        id:          (r[0]||'').toString(),
        userId:      (r[1]||'').toString(),
        email:       (r[2]||'').toString(),
        name:        (r[3]||'').toString(),
        exercises,
        createdDate: (r[5]||'').toString(),
        updatedDate: (r[6]||'').toString(),
      };
    });

  return { success:true, workouts };
}

// ── NEW v6: Get ALL custom workouts across all users (for admin panel) ──
function getAllCustomWorkouts() {
  const sh   = getSheet(SHEETS.CUSTOM_WORKOUTS);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { success:true, workouts:[] };

  const workouts = data.slice(1)
    .filter(r => {
      const active = r[7];
      return active===true || active==='TRUE' || active==='true';
    })
    .map(r => {
      let exercises = [];
      try { exercises = JSON.parse(r[4]||'[]'); } catch {}
      return {
        id:          (r[0]||'').toString(),
        userId:      (r[1]||'').toString(),
        email:       (r[2]||'').toString(),
        name:        (r[3]||'').toString(),
        exercises,
        createdDate: (r[5]||'').toString(),
        updatedDate: (r[6]||'').toString(),
      };
    });

  return { success:true, workouts };
}

function saveCustomWorkout(body) {
  const sh   = getSheet(SHEETS.CUSTOM_WORKOUTS);
  ensureHeaders(sh,['WorkoutID','UserID','UserEmail','Name','ExercisesJSON','CreatedDate','UpdatedDate','Active']);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][0]||'').toString()===body.id.toString()&&(data[i][1]||'').toString()===body.userId.toString()) {
      sh.getRange(i+1,1,1,8).setValues([[
        body.id, body.userId, body.email||'', body.name,
        JSON.stringify(body.exercises||[]),
        body.createdDate||'',
        body.updatedDate||new Date().toISOString().split('T')[0],
        true,
      ]]);
      return { success:true, updated:true };
    }
  }
  sh.appendRow([
    body.id, body.userId, body.email||'', body.name,
    JSON.stringify(body.exercises||[]),
    body.createdDate||new Date().toISOString().split('T')[0],
    body.updatedDate||new Date().toISOString().split('T')[0],
    true,
  ]);
  return { success:true, created:true };
}

function deleteCustomWorkout(body) {
  const sh   = getSheet(SHEETS.CUSTOM_WORKOUTS);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][0]||'').toString()===body.id.toString()&&(data[i][1]||'').toString()===body.userId.toString()) {
      sh.getRange(i+1,8).setValue(false); return { success:true };
    }
  }
  return { success:false, error:'Workout not found.' };
}

// ════════════════════════════════════════════════════════════════
// CONTENT
// ════════════════════════════════════════════════════════════════
function getContent(key) {
  const sh   = getSheet(SHEETS.CONTENT);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][0]||'').toString()===key) { try { return JSON.parse(data[i][1]); } catch { return null; } }
  }
  return null;
}

function getAllContent() {
  const sh   = getSheet(SHEETS.CONTENT);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return { success:true, content:{} };
  const result = {};
  data.slice(1).forEach(r => {
    const k = (r[0]||'').toString().trim();
    if (!k) return;
    try { result[k]=JSON.parse(r[1]); } catch { result[k]=r[1]; }
  });
  return { success:true, content:result };
}

function saveContent(body) {
  const { key, value } = body;
  if (!key) return { success:false, error:'key required.' };
  const sh   = getSheet(SHEETS.CONTENT);
  ensureHeaders(sh,['Key','Value','UpdatedAt']);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][0]||'').toString()===key) {
      sh.getRange(i+1,2,1,2).setValues([[JSON.stringify(value),new Date().toISOString()]]);
      return { success:true };
    }
  }
  sh.appendRow([key,JSON.stringify(value),new Date().toISOString()]);
  return { success:true };
}

// ════════════════════════════════════════════════════════════════
// FEEDBACK
// ════════════════════════════════════════════════════════════════
function getFeedback() {
  const sh   = getSheet(SHEETS.FEEDBACK);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return { success:true, feedback:[] };
  return { success:true, feedback:data.slice(1).reverse()
    .map(r=>({ id:r[0],userId:r[1],name:r[2],email:r[3],category:r[4],rating:r[5],message:r[6],date:r[7] })) };
}

function submitFeedback(body) {
  const sh = getSheet(SHEETS.FEEDBACK);
  ensureHeaders(sh,['FeedbackID','UserID','Name','Email','Category','Rating','Message','Date','Timestamp']);
  sh.appendRow(['fb_'+Date.now(),body.userId||'',body.name||'Anonymous',body.email||'',body.category||'General',body.rating||0,body.message||'',body.date||'',new Date().toISOString()]);
  return { success:true };
}

// ════════════════════════════════════════════════════════════════
// PUSH SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════
function savePushSubscription(body) {
  const sh   = getSheet(SHEETS.PUSH_SUBS);
  ensureHeaders(sh,['UserID','Name','Email','Endpoint','P256DH','Auth','SavedAt','Active']);
  const data = sh.getDataRange().getValues();
  const row  = [body.userId,body.name||'',body.email||'',body.endpoint,body.p256dh||'',body.auth||'',body.savedAt||new Date().toISOString(),true];
  for (let i=1;i<data.length;i++) {
    if (data[i][0]===body.userId&&data[i][3]===body.endpoint) {
      sh.getRange(i+1,1,1,8).setValues([row]); return { success:true, updated:true };
    }
  }
  sh.appendRow(row);
  return { success:true, created:true };
}

function removePushSubscription(body) {
  const sh   = getSheet(SHEETS.PUSH_SUBS);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if (data[i][0]===body.userId&&data[i][3]===body.endpoint) {
      sh.getRange(i+1,8).setValue(false); return { success:true };
    }
  }
  return { success:false, error:'Not found.' };
}

function getAllActiveSubscriptions() {
  const sh   = getSheet(SHEETS.PUSH_SUBS);
  const data = sh.getDataRange().getValues();
  if (data.length<2) return [];
  return data.slice(1)
    .filter(r => r[7]===true||r[7]==='TRUE'||r[7]==='true')
    .map(r => ({ userId:r[0], name:r[1], email:r[2], endpoint:r[3], p256dh:r[4], auth:r[5] }));
}

// ════════════════════════════════════════════════════════════════
// PLAN MANAGEMENT
// ════════════════════════════════════════════════════════════════
function getActivePlan(userId) {
  if (!userId) return { success:false, error:'userId required.' };
  const sh   = getSheet('PlanProgress');
  const data = sh.getDataRange().getValues();
  if (data.length<2) return { success:true, plan:null };
  for (let i=1;i<data.length;i++) {
    const row = data[i];
    if ((row[1]||'').toString()===userId.toString() && (row[11]||'').toString()==='REGISTERED') {
      return { success:true, plan:{
        planKey:      (row[3]||'').toString(),
        startDate:    (row[4]||'').toString(),
        registeredAt: (row[5]||'').toString(),
      }};
    }
  }
  return { success:true, plan:null };
}

function getPlanProgress(userId, planKey) {
  if (!userId) return { success:false, error:'userId required.' };
  const sh   = getSheet('PlanProgress');
  const data = sh.getDataRange().getValues();
  if (data.length<2) return { success:true, completedDays:[] };
  const days = data.slice(1)
    .filter(r =>
      (r[1]||'').toString()===userId.toString() &&
      (!planKey||(r[3]||'').toString()===planKey) &&
      (r[11]||'').toString()==='DAY_DONE'
    )
    .map(r=>({
      planKey:(r[3]||'').toString(), week:parseInt(r[6])||0, day:parseInt(r[7])||0,
      completedDate:(r[8]||'').toString(), distanceKm:parseFloat(r[9])||0, durationSec:parseInt(r[10])||0,
    }));
  return { success:true, completedDays:days };
}

function savePlanRegistration(body) {
  const { userId, email, planKey, startDate, registeredAt } = body;
  if (!userId||!planKey) return { success:false, error:'userId and planKey required.' };
  const sh   = getSheet('PlanProgress');
  ensureHeaders(sh,['RecordID','UserID','UserEmail','PlanKey','StartDate','RegisteredAt','Week','Day','CompletedDate','DistanceKm','DurationSec','Status','Timestamp']);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][1]||'').toString()===userId.toString()&&(data[i][11]||'').toString()==='REGISTERED') {
      sh.getRange(i+1,1,1,13).setValues([[data[i][0],userId,email||'',planKey,startDate||'',registeredAt||new Date().toISOString(),0,0,'',0,0,'REGISTERED',new Date().toISOString()]]);
      SpreadsheetApp.flush();
      return { success:true, updated:true };
    }
  }
  sh.appendRow(['plan_'+Date.now(),userId,email||'',planKey,startDate||'',registeredAt||new Date().toISOString(),0,0,'',0,0,'REGISTERED',new Date().toISOString()]);
  return { success:true, created:true };
}

function savePlanDayCompletion(body) {
  const { userId, email, planKey, week, day, completedDate, distanceKm, durationSec } = body;
  if (!userId||!planKey||!week||!day) return { success:false, error:'userId, planKey, week, day required.' };
  const sh   = getSheet('PlanProgress');
  ensureHeaders(sh,['RecordID','UserID','UserEmail','PlanKey','StartDate','RegisteredAt','Week','Day','CompletedDate','DistanceKm','DurationSec','Status','Timestamp']);
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    const row=data[i];
    if (
      (row[1]||'').toString()===userId.toString() &&
      (row[3]||'').toString()===planKey &&
      parseInt(row[6])===parseInt(week) &&
      parseInt(row[7])===parseInt(day)  &&
      (row[11]||'').toString()==='DAY_DONE'
    ) {
      sh.getRange(i+1,9,1,5).setValues([[completedDate||'',distanceKm||0,durationSec||0,'DAY_DONE',new Date().toISOString()]]);
      SpreadsheetApp.flush();
      return { success:true, updated:true };
    }
  }
  sh.appendRow(['pd_'+Date.now(),userId,email||'',planKey,'','',week,day,completedDate||'',distanceKm||0,durationSec||0,'DAY_DONE',new Date().toISOString()]);
  return { success:true, created:true };
}

function clearActivePlan(body) {
  const { userId } = body;
  if (!userId) return { success:false, error:'userId required.' };
  const sh   = getSheet('PlanProgress');
  const data = sh.getDataRange().getValues();
  for (let i=1;i<data.length;i++) {
    if ((data[i][1]||'').toString()===userId.toString()&&(data[i][11]||'').toString()==='REGISTERED') {
      sh.getRange(i+1,12).setValue('UNREGISTERED');
      SpreadsheetApp.flush();
      return { success:true };
    }
  }
  return { success:true };
}

// ════════════════════════════════════════════════════════════════
// HYDRATION LOGS
// ════════════════════════════════════════════════════════════════
function saveHydrationLog(body) {
  const sh = getSheet(SHEETS.HYDRATION_LOGS);
  ensureHeaders(sh, ['LogID','UserID','UserEmail','Date','GlassesTarget','GlassesDone','Timestamp']);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if ((data[i][1]||'').toString() === body.userId.toString() &&
        (data[i][3]||'').toString() === body.date) {
      sh.getRange(i+1, 5, 1, 3).setValues([[
        body.glassesTarget || 0,
        body.glassesDone   || 0,
        new Date().toISOString(),
      ]]);
      SpreadsheetApp.flush();
      return { success:true, updated:true };
    }
  }
  sh.appendRow([
    'hyd_'+Date.now(),
    body.userId        || '',
    body.email         || '',
    body.date          || '',
    body.glassesTarget || 0,
    body.glassesDone   || 0,
    new Date().toISOString(),
  ]);
  return { success:true, created:true };
}

function getHydrationLogs(userId) {
  if (!userId) return { success:false, error:'userId required.' };
  const sh   = getSheet(SHEETS.HYDRATION_LOGS);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { success:true, logs:[] };
  const logs = data.slice(1)
    .filter(r => (r[1]||'').toString() === userId.toString())
    .map(r => ({
      id:             (r[0]||'').toString(),
      userId:         (r[1]||'').toString(),
      email:          (r[2]||'').toString(),
      date:           (r[3]||'').toString(),
      glassesTarget:  parseInt(r[4]) || 0,
      glassesDone:    parseInt(r[5]) || 0,
      timestamp:      (r[6]||'').toString(),
    }));
  return { success:true, logs };
}

// ════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — Pure VAPID
// ════════════════════════════════════════════════════════════════
var DAILY_MESSAGES = [
  { title:'Rise & Grind! 🌅',         body:"Your muscles called — they're bored. Time to fix that! 💪" },
  { title:'Good Morning Champion! 🏆', body:"The only workout you'll regret is the one you skipped! 😤" },
  { title:'Wakey Wakey! ⏰',           body:"Your future self is at the gym waiting. Don't keep them waiting! 🏃" },
  { title:'Morning Motivation! ☀️',    body:"Coffee is great. But endorphins? Free and hit harder! 😂" },
  { title:"Let's GO! 🚀",              body:"Your body is a temple. Today we're doing renovations. 🔨💪" },
  { title:'Daily Check-In! 📋',        body:"Cardio? Yoga? Running? Your app is ready when you are! 🎯" },
  { title:'6 AM Wake Up Call! 📱',     body:"The alarm rang. Your excuses are still sleeping. YOU don't have to be! 🌟" },
  { title:'Morning Legend! 🦁',        body:"Lions don't skip leg day. Be the lion. 🦁💪" },
  { title:'Rise & Shine! ✨',          body:"Yesterday you said tomorrow. TODAY IS THAT TOMORROW. GO! 🏃‍♂️" },
  { title:'Good Morning! 🌄',          body:"Your competition woke up at 5 AM. But you're here now — keep going! 💪" },
  { title:'Move Your Body! 🕺',        body:"Muscles are like WiFi. Use them or the connection gets weak! 📶💪" },
  { title:'Morning Champion! 🥇',      body:"Progress not perfection. One workout at a time. You've got this! 🌟" },
  { title:'Time to Sweat! 😅',         body:"Sweat is just your fat crying. Make it cry today! 😂🔥" },
  { title:'New Day, New Gains! 💪',    body:"Yesterday's soreness is today's strength. What are you building? 🏗️" },
  { title:'Morning Warrior! ⚔️',       body:"Warriors don't wait for motivation. They BECOME it. Let's GO! 🔥" },
  { title:'Daily Dose of Awesome! 💊', body:"Side effects: confidence, energy, better sleep, happiness. Worth it! 😁" },
  { title:'Strength Incoming! 💪',     body:"Every rep is a vote for the person you want to become. Vote today! 🗳️" },
  { title:'No Excuses Today! 🚫',      body:"Too tired? Start with 5 minutes. Too busy? You're reading this! 😉" },
  { title:'Midweek Push! 💥',          body:"Halfway through the week. Don't slow down now! 🏁" },
  { title:'Weekend Warrior! 🏕️',       body:"No work today? Perfect — more energy for your workout! 💪" },
];

function getTodaysMessage() {
  var day = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  return DAILY_MESSAGES[day % DAILY_MESSAGES.length];
}

function sendDailyPushNotifications() {
  var props   = PropertiesService.getScriptProperties();
  var privKey = props.getProperty('VAPID_PRIVATE_KEY');
  var pubKey  = props.getProperty('VAPID_PUBLIC_KEY');
  var subject = props.getProperty('VAPID_SUBJECT') || 'mailto:admin@fitflow.com';

  if (!privKey || !pubKey) { Logger.log('VAPID keys not set.'); return; }

  var subs    = getAllActiveSubscriptions();
  if (!subs.length) { Logger.log('No subscribers.'); return; }

  var msg     = getTodaysMessage();
  var success = 0, fail = 0, expired = [];

  subs.forEach(function(sub) {
    var result = _sendWebPush(sub, msg, privKey, pubKey, subject);
    if (result.success) { success++; }
    else {
      fail++;
      Logger.log('Push failed for ' + sub.email + ': ' + result.error);
      if (result.expired) expired.push(sub.endpoint);
    }
  });

  if (expired.length) _cleanupExpired(expired);
  Logger.log('Push done — sent: ' + success + ', failed: ' + fail + ' of ' + subs.length);
}

function _sendWebPush(sub, msg, vapidPrivKey, vapidPubKey, vapidSubject) {
  try {
    var endpoint = sub.endpoint;
    var origin   = _getOrigin(endpoint);
    var now      = Math.floor(Date.now() / 1000);
    var header   = _b64url(Utilities.newBlob(JSON.stringify({ typ:'JWT', alg:'ES256' })).getBytes());
    var payload  = _b64url(Utilities.newBlob(JSON.stringify({ aud:origin, exp:now+43200, sub:vapidSubject })).getBytes());
    var toSign   = header + '.' + payload;
    var privBytes= _b64urlDecode(vapidPrivKey);
    var sigBytes = Utilities.computeHmacSha256Signature(toSign, privBytes);
    var jwt      = toSign + '.' + _b64url(sigBytes);

    var payload_json = JSON.stringify({
      title:msg.title, body:msg.body, tag:'fitflow-daily', renotify:true,
      vibrate:[200,100,200], data:{ url:'/' },
      actions:[{ action:'open', title:"Let's Go! 💪" },{ action:'dismiss', title:'Later' }],
    });

    var res = UrlFetchApp.fetch(endpoint, {
      method:'POST',
      headers:{
        'Authorization': 'vapid t=' + jwt + ', k=' + vapidPubKey,
        'Content-Type':  'application/json',
        'TTL':           '86400',
        'Urgency':       'normal',
      },
      payload:            payload_json,
      muteHttpExceptions: true,
    });

    var code = res.getResponseCode();
    if (code>=200&&code<300) return { success:true };
    if (code===404||code===410) return { success:false, expired:true, error:'Endpoint gone ('+code+')' };
    return { success:false, error:'HTTP '+code+': '+res.getContentText().substring(0,200) };
  } catch(e) {
    return { success:false, error:e.message };
  }
}

function _getOrigin(url) {
  var m = url.match(/^(https?:\/\/[^\/]+)/);
  return m ? m[1] : url;
}
function _b64url(bytes) {
  return Utilities.base64Encode(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function _b64urlDecode(str) {
  var pad = str.length%4===0?'':'='.repeat(4-str.length%4);
  return Utilities.base64Decode(str.replace(/-/g,'+').replace(/_/g,'/')+pad);
}
function _cleanupExpired(endpoints) {
  var sh   = getSheet(SHEETS.PUSH_SUBS);
  var data = sh.getDataRange().getValues();
  for (var i=1;i<data.length;i++) {
    if (endpoints.indexOf(data[i][3])>-1) sh.getRange(i+1,8).setValue(false);
  }
}

function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction()==='sendDailyPushNotifications') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyPushNotifications').timeBased().everyDays(1).atHour(6).create();
  Logger.log('✅ Daily 6 AM trigger created!');
}

function deleteDailyTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction()==='sendDailyPushNotifications') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Deleted ' + n + ' trigger(s).');
}

function testPushNotification() {
  var props   = PropertiesService.getScriptProperties();
  var privKey = props.getProperty('VAPID_PRIVATE_KEY');
  var pubKey  = props.getProperty('VAPID_PUBLIC_KEY');
  var subject = props.getProperty('VAPID_SUBJECT') || 'mailto:admin@fitflow.com';
  if (!privKey||!pubKey) { Logger.log('❌ VAPID keys not set!'); return; }
  var subs = getAllActiveSubscriptions();
  if (!subs.length) { Logger.log('No subscribers yet.'); return; }
  var result = _sendWebPush(subs[0],{ title:'🧪 Test!', body:'Push is working! 🎉' },privKey,pubKey,subject);
  Logger.log(result.success ? '✅ Test push sent to '+subs[0].email : '❌ Push failed: '+result.error);
}

// ════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════
function ensureHeaders(sh, headers) {
  if (sh.getLastRow()===0) { sh.appendRow(headers); styleHeader(sh,headers.length); }
}

function styleHeader(sh, colCount) {
  sh.getRange(1,1,1,colCount)
    .setFontWeight('bold').setBackground('#1B5E20').setFontColor('#FFFFFF').setFontSize(11);
  sh.setFrozenRows(1);
}
