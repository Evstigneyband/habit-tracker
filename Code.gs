const SPREADSHEET_ID = '1ez1YJkM3t_DGePktOoEE3Nor8w1yL0PpBINlTBwrlgM';
const APP_TIMEZONE = 'Europe/Podgorica';
const SESSION_DAYS = 30;

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Твой челлендж')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
}

function apiRegister(payload) {
  const email = normalizeEmail_(payload.email);
  const password = String(payload.password || '');
  if (!email || !isValidEmail_(email)) throw new Error('Введите корректный email.');
  if (password.length < 6) throw new Error('Пароль должен быть не короче 6 символов.');

  const users = getRecords_('Users');
  if (users.rows.some((user) => normalizeEmail_(user.email) === email)) {
    throw new Error('Пользователь с таким email уже существует.');
  }

  const now = nowIso_();
  const salt = Utilities.getUuid();
  const user = {
    userId: makeId_('usr'),
    email,
    passwordHash: sha256_(salt + password),
    passwordSalt: salt,
    displayName: email.split('@')[0],
    timezone: APP_TIMEZONE,
    locale: 'ru',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    lastActiveChallengeId: '',
  };

  appendRecord_('Users', user);
  const session = createSession_(user.userId);
  return buildAppState_(user, session.token);
}

function apiLogin(payload) {
  const email = normalizeEmail_(payload.email);
  const password = String(payload.password || '');
  const users = getRecords_('Users');
  const user = users.rows.find((candidate) => normalizeEmail_(candidate.email) === email);
  if (!user || user.isActive === false || String(user.isActive).toLowerCase() === 'false') {
    throw new Error('Неверный email или пароль.');
  }

  const expectedHash = sha256_(String(user.passwordSalt) + password);
  if (expectedHash !== user.passwordHash) throw new Error('Неверный email или пароль.');

  updateRecordById_('Users', 'userId', user.userId, {
    lastLoginAt: nowIso_(),
    updatedAt: nowIso_(),
  });

  const session = createSession_(user.userId);
  return buildAppState_(user, session.token);
}

function apiGetSession(sessionToken) {
  const user = requireUser_(sessionToken);
  return buildAppState_(user, sessionToken);
}

function apiOpenChallenge(sessionToken, challengeId) {
  const user = requireUser_(sessionToken);
  rememberLastActiveChallenge_(user.userId, challengeId);
  user.lastActiveChallengeId = challengeId;
  return buildAppState_(user, sessionToken, challengeId);
}

function apiPreviewChallenge(sessionToken, challengeId) {
  const user = requireUser_(sessionToken);
  return buildAppState_(user, sessionToken, challengeId);
}

function apiLogout(sessionToken) {
  if (!sessionToken) return { ok: true };
  const hash = sha256_(String(sessionToken));
  updateRecordById_('Sessions', 'sessionTokenHash', hash, {
    isRevoked: true,
    lastSeenAt: nowIso_(),
  });
  return { ok: true };
}

function apiCreateChallenge(sessionToken, payload) {
  const user = requireUser_(sessionToken);
  const normalized = normalizeChallengePayload_(payload);
  const challengeId = createChallenge_(user, normalized);
  rememberLastActiveChallenge_(user.userId, challengeId);
  user.lastActiveChallengeId = challengeId;
  return buildAppState_(user, sessionToken, challengeId);
}

function apiRestartChallenge(sessionToken, challengeId, payload) {
  const user = requireUser_(sessionToken);
  const normalized = normalizeChallengePayload_(payload);
  const existing = getRecords_('Challenges').rows.find((challenge) =>
    challenge.challengeId === challengeId &&
    challenge.userId === user.userId &&
    challenge.status !== 'deleted'
  );
  if (!existing) throw new Error('Челлендж не найден.');

  restartChallenge_(user, existing, normalized);
  rememberLastActiveChallenge_(user.userId, challengeId);
  user.lastActiveChallengeId = challengeId;
  return buildAppState_(user, sessionToken, challengeId);
}

function apiDeleteChallenge(sessionToken, challengeId, selectedChallengeId) {
  const user = requireUser_(sessionToken);
  const challenge = getRecords_('Challenges').rows.find((candidate) =>
    candidate.challengeId === challengeId &&
    candidate.userId === user.userId &&
    candidate.status !== 'deleted'
  );
  if (!challenge) throw new Error('Челлендж не найден.');

  updateRecordById_('Challenges', 'challengeId', challengeId, {
    status: 'deleted',
    updatedAt: nowIso_(),
  });
  getRecords_('Goals').rows
    .filter((goal) => goal.challengeId === challengeId && goal.userId === user.userId)
    .forEach((goal) => updateRecordById_('Goals', 'goalId', goal.goalId, {
      isActive: false,
      archivedAt: nowIso_(),
      updatedAt: nowIso_(),
    }));
  deleteRowsMatching_('DailyEntries', (entry) => entry.challengeId === challengeId && entry.userId === user.userId);
  const nextSelectedChallengeId = selectedChallengeId === challengeId ? '' : selectedChallengeId;
  if (nextSelectedChallengeId) {
    rememberLastActiveChallenge_(user.userId, nextSelectedChallengeId);
    user.lastActiveChallengeId = nextSelectedChallengeId;
  } else if (user.lastActiveChallengeId === challengeId) {
    rememberLastActiveChallenge_(user.userId, '');
    user.lastActiveChallengeId = '';
  }
  return buildAppState_(user, sessionToken, nextSelectedChallengeId);
}

function normalizeChallengePayload_(payload) {
  const title = String(payload.title || '').trim();
  const durationDays = Number(payload.durationDays || 0);
  const simpleGoals = (payload.simpleGoals || [])
    .map((goal) => String(goal.title || goal || '').trim())
    .filter(Boolean);
  const timeGoals = (payload.timeGoals || [])
    .map((goal) => ({
      title: String(goal.title || '').trim(),
      targetHours: Number(goal.targetHours || 0),
    }))
    .filter((goal) => goal.title && goal.targetHours > 0);

  if (!title) throw new Error('Введите название челленджа.');
  if (!Number.isFinite(durationDays) || durationDays < 1) throw new Error('Введите количество дней.');
  if (!simpleGoals.length && !timeGoals.length) throw new Error('Добавьте хотя бы одну цель.');

  return { title, durationDays, simpleGoals, timeGoals };
}

function createChallenge_(user, normalized) {
  const title = normalized.title;
  const durationDays = normalized.durationDays;
  const simpleGoals = normalized.simpleGoals;
  const timeGoals = normalized.timeGoals;
  const now = nowIso_();
  const startDate = today_();
  const endDate = addDays_(startDate, durationDays - 1);
  const challengeId = makeId_('chl');
  const totalGoals = simpleGoals.length + timeGoals.length;

  appendRecord_('Challenges', {
    challengeId,
    userId: user.userId,
    title,
    durationDays,
    startDate,
    endDate,
    status: 'active',
    totalGoals,
    timeGoalsCount: timeGoals.length,
    simpleGoalsCount: simpleGoals.length,
    createdAt: now,
    updatedAt: now,
    completedAt: '',
  });

  let sortOrder = 1;
  simpleGoals.forEach((goalTitle) => {
    appendRecord_('Goals', {
      goalId: makeId_('gol'),
      challengeId,
      userId: user.userId,
      goalType: 'simple',
      title: goalTitle,
      targetHours: '',
      sortOrder: sortOrder++,
      weight: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: '',
      notes: '',
      sourceScreen: 'challenge_setup',
    });
  });

  timeGoals.forEach((goal) => {
    appendRecord_('Goals', {
      goalId: makeId_('gol'),
      challengeId,
      userId: user.userId,
      goalType: 'time',
      title: goal.title,
      targetHours: goal.targetHours,
      sortOrder: sortOrder++,
      weight: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: '',
      notes: '',
      sourceScreen: 'challenge_setup',
    });
  });

  return challengeId;
}

function restartChallenge_(user, challenge, normalized) {
  const title = normalized.title;
  const durationDays = normalized.durationDays;
  const simpleGoals = normalized.simpleGoals;
  const timeGoals = normalized.timeGoals;
  const now = nowIso_();
  const startDate = today_();
  const endDate = addDays_(startDate, durationDays - 1);
  const totalGoals = simpleGoals.length + timeGoals.length;

  updateRecordById_('Challenges', 'challengeId', challenge.challengeId, {
    title,
    durationDays,
    startDate,
    endDate,
    status: 'active',
    totalGoals,
    timeGoalsCount: timeGoals.length,
    simpleGoalsCount: simpleGoals.length,
    updatedAt: now,
    completedAt: '',
  });

  getRecords_('Goals').rows
    .filter((goal) => goal.challengeId === challenge.challengeId && goal.userId === user.userId)
    .forEach((goal) => updateRecordById_('Goals', 'goalId', goal.goalId, {
      isActive: false,
      archivedAt: now,
      updatedAt: now,
    }));
  deleteRowsMatching_('DailyEntries', (entry) => entry.challengeId === challenge.challengeId && entry.userId === user.userId);

  let sortOrder = 1;
  simpleGoals.forEach((goalTitle) => {
    appendRecord_('Goals', {
      goalId: makeId_('gol'),
      challengeId: challenge.challengeId,
      userId: user.userId,
      goalType: 'simple',
      title: goalTitle,
      targetHours: '',
      sortOrder: sortOrder++,
      weight: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: '',
      notes: '',
      sourceScreen: 'challenge_restart',
    });
  });

  timeGoals.forEach((goal) => {
    appendRecord_('Goals', {
      goalId: makeId_('gol'),
      challengeId: challenge.challengeId,
      userId: user.userId,
      goalType: 'time',
      title: goal.title,
      targetHours: goal.targetHours,
      sortOrder: sortOrder++,
      weight: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      archivedAt: '',
      notes: '',
      sourceScreen: 'challenge_restart',
    });
  });
}

function apiUpdateSimpleEntry(sessionToken, payload) {
  const user = requireUser_(sessionToken);
  const goalId = String(payload.goalId || '');
  const isChecked = Boolean(payload.isChecked);
  const entryDate = payload.entryDate || today_();
  const challengeId = upsertDailyEntry_(user, goalId, entryDate, { isChecked, actualHours: '' });
  return buildAppState_(user, sessionToken, challengeId);
}

function apiUpdateTimeEntry(sessionToken, payload) {
  const user = requireUser_(sessionToken);
  const goalId = String(payload.goalId || '');
  const actualHours = Math.max(0, Number(payload.actualHours || 0));
  const entryDate = payload.entryDate || today_();
  const challengeId = upsertDailyEntry_(user, goalId, entryDate, { actualHours });
  return buildAppState_(user, sessionToken, challengeId);
}

function buildAppState_(user, sessionToken, selectedChallengeId) {
  const challenges = getUserChallenges_(user.userId);
  const preferredChallengeId = selectedChallengeId || user.lastActiveChallengeId || '';
  const challenge = preferredChallengeId
    ? challenges.find((candidate) => candidate.challengeId === preferredChallengeId) || challenges[0] || null
    : challenges[0] || null;
  const today = today_();
  if (!challenge) {
    return {
      sessionToken,
      user: publicUser_(user),
      today,
      challenge: null,
      challenges: [],
      goals: [],
      entries: [],
      progress: { completed: 0, total: 0, percent: 0 },
      overallProgress: { percent: 0, elapsedDays: 0, durationDays: 0 },
      analytics: null,
    };
  }

  const goals = getRecords_('Goals').rows
    .filter((goal) => goal.challengeId === challenge.challengeId && String(goal.isActive).toLowerCase() !== 'false')
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const allEntries = getRecords_('DailyEntries').rows
    .filter((entry) => entry.challengeId === challenge.challengeId && entry.userId === user.userId);
  const entries = allEntries.filter((entry) => entry.entryDate === today);
  const merged = goals.map((goal) => {
    const entry = entries.find((candidate) => candidate.goalId === goal.goalId) || {};
    return {
      goalId: goal.goalId,
      goalType: goal.goalType,
      title: goal.title,
      targetHours: Number(goal.targetHours || 0),
      sortOrder: Number(goal.sortOrder || 0),
      entryId: entry.entryId || '',
      isChecked: parseBool_(entry.isChecked),
      actualHours: Number(entry.actualHours || 0),
      isCompleted: parseBool_(entry.isCompleted),
    };
  });
  const completed = merged.filter((goal) => goal.isCompleted).length;
  const total = merged.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const overallProgress = calculateOverallProgress_(challenge, allEntries, today);
  const isFinished = isChallengeFinished_(challenge, today);
  const analytics = buildAnalytics_(challenge, goals, allEntries, today);

  return {
    sessionToken,
    user: publicUser_(user),
    today,
    challenge: {
      challengeId: challenge.challengeId,
      title: challenge.title,
      durationDays: Number(challenge.durationDays || 0),
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      dayNumber: calculateDayNumber_(challenge.startDate, today),
      totalGoals: total,
      isFinished,
    },
    challenges: challenges.map((item) => ({
      challengeId: item.challengeId,
      title: item.title,
      durationDays: Number(item.durationDays || 0),
      startDate: item.startDate,
      endDate: item.endDate,
      status: item.status,
      totalGoals: Number(item.totalGoals || 0),
      dayNumber: calculateDayNumber_(item.startDate, today),
      isCurrent: item.challengeId === challenge.challengeId,
    })),
    goals: merged,
    entries,
    progress: { completed, total, percent },
    overallProgress,
    analytics,
  };
}

function requireUser_(sessionToken) {
  if (!sessionToken) throw new Error('Сессия не найдена. Войдите заново.');
  const tokenHash = sha256_(String(sessionToken));
  const sessions = getRecords_('Sessions');
  const session = sessions.rows.find((candidate) =>
    candidate.sessionTokenHash === tokenHash &&
    String(candidate.isRevoked).toLowerCase() !== 'true' &&
    String(candidate.expiresAt) > nowIso_()
  );
  if (!session) throw new Error('Сессия истекла. Войдите заново.');

  updateRecordById_('Sessions', 'sessionId', session.sessionId, { lastSeenAt: nowIso_() });

  const user = getRecords_('Users').rows.find((candidate) => candidate.userId === session.userId);
  if (!user) throw new Error('Пользователь не найден.');
  return user;
}

function createSession_(userId) {
  const token = Utilities.getUuid() + '.' + Utilities.getUuid();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  appendRecord_('Sessions', {
    sessionId: makeId_('ses'),
    userId,
    sessionTokenHash: sha256_(token),
    createdAt: toIso_(now),
    expiresAt: toIso_(expires),
    lastSeenAt: toIso_(now),
    userAgent: '',
    isRevoked: false,
  });
  return { token };
}

function archiveActiveChallenges_(userId) {
  getRecords_('Challenges').rows
    .filter((challenge) => challenge.userId === userId && challenge.status === 'active')
    .forEach((challenge) => {
      updateRecordById_('Challenges', 'challengeId', challenge.challengeId, {
        status: 'archived',
        updatedAt: nowIso_(),
      });
    });
}

function getActiveChallenge_(userId) {
  return getUserChallenges_(userId)[0] || null;
}

function getUserChallenges_(userId) {
  return getRecords_('Challenges').rows
    .filter((challenge) => challenge.userId === userId && challenge.status !== 'deleted')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function rememberLastActiveChallenge_(userId, challengeId) {
  ensureSheetHeader_('Users', 'lastActiveChallengeId');
  updateRecordById_('Users', 'userId', userId, {
    lastActiveChallengeId: challengeId || '',
    updatedAt: nowIso_(),
  });
}

function upsertDailyEntry_(user, goalId, entryDate, values) {
  const goal = getRecords_('Goals').rows.find((candidate) =>
    candidate.goalId === goalId &&
    candidate.userId === user.userId
  );
  if (!goal) throw new Error('Цель не найдена.');

  const challenge = getRecords_('Challenges').rows.find((candidate) =>
    candidate.challengeId === goal.challengeId &&
    candidate.userId === user.userId &&
    candidate.status !== 'deleted'
  );
  if (!challenge) throw new Error('Челлендж не найден.');

  const records = getRecords_('DailyEntries');
  const existing = records.rows.find((entry) =>
    entry.goalId === goalId &&
    entry.challengeId === challenge.challengeId &&
    entry.userId === user.userId &&
    entry.entryDate === entryDate
  );

  const targetHours = Number(goal.targetHours || 0);
  const actualHours = goal.goalType === 'time' ? Number(values.actualHours || 0) : '';
  const isChecked = goal.goalType === 'simple' ? Boolean(values.isChecked) : false;
  const isCompleted = goal.goalType === 'time' ? actualHours >= targetHours : isChecked;
  const totalGoals = Number(challenge.totalGoals || getRecords_('Goals').rows.filter((candidate) => candidate.challengeId === challenge.challengeId).length || 1);
  const completionPercent = isCompleted ? round1_(100 / totalGoals) : 0;
  const now = nowIso_();
  const base = {
    challengeId: challenge.challengeId,
    goalId: goal.goalId,
    userId: user.userId,
    entryDate,
    dayNumber: calculateDayNumber_(challenge.startDate, entryDate),
    goalType: goal.goalType,
    isChecked,
    targetHours: targetHours || '',
    actualHours,
    isCompleted,
    completionPercent,
    note: '',
    updatedAt: now,
  };

  if (existing) {
    updateRecordById_('DailyEntries', 'entryId', existing.entryId, base);
  } else {
    appendRecord_('DailyEntries', Object.assign({ entryId: makeId_('ent'), createdAt: now }, base));
  }
  return challenge.challengeId;
}

function getRecords_(sheetName) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error('Лист не найден: ' + sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const rows = values.slice(1)
    .filter((row) => row.some((cell) => cell !== '' && cell !== null))
    .map((row, index) => {
      const record = { _rowNumber: index + 2 };
      headers.forEach((header, columnIndex) => {
        record[header] = normalizeSheetValue_(header, row[columnIndex]);
      });
      return record;
    });
  return { sheet, headers, rows };
}

function appendRecord_(sheetName, record) {
  const data = getRecords_(sheetName);
  const row = data.headers.map((header) => record[header] === undefined ? '' : record[header]);
  data.sheet.appendRow(row);
}

function ensureSheetHeader_(sheetName, header) {
  const data = getRecords_(sheetName);
  if (data.headers.indexOf(header) !== -1) return;
  data.sheet.getRange(1, data.headers.length + 1).setValue(header);
}

function updateRecordById_(sheetName, idField, idValue, patch) {
  const data = getRecords_(sheetName);
  const record = data.rows.find((row) => String(row[idField]) === String(idValue));
  if (!record) return false;
  const rowValues = data.headers.map((header) => {
    if (patch[header] !== undefined) return patch[header];
    return record[header] === undefined ? '' : record[header];
  });
  data.sheet.getRange(record._rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
  return true;
}

function deleteRowsMatching_(sheetName, predicate) {
  const data = getRecords_(sheetName);
  data.rows
    .filter(predicate)
    .sort((a, b) => b._rowNumber - a._rowNumber)
    .forEach((record) => data.sheet.deleteRow(record._rowNumber));
}

function publicUser_(user) {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName || user.email,
  };
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function makeId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 18);
}

function sha256_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map((byte) => {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function nowIso_() {
  return toIso_(new Date());
}

function toIso_(date) {
  return Utilities.formatDate(date, APP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

function today_() {
  return Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyy-MM-dd');
}

function addDays_(dateString, days) {
  const parts = dateOnly_(dateString).split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + days);
  return Utilities.formatDate(date, APP_TIMEZONE, 'yyyy-MM-dd');
}

function calculateDayNumber_(startDate, entryDate) {
  if (!startDate || !entryDate) return 1;
  const start = new Date(dateOnly_(startDate) + 'T00:00:00');
  const current = new Date(dateOnly_(entryDate) + 'T00:00:00');
  return Math.max(1, Math.floor((current - start) / 86400000) + 1);
}

function calculateOverallProgress_(challenge, entries, today) {
  const durationDays = Math.max(1, Number(challenge.durationDays || 1));
  const elapsedDays = Math.min(durationDays, calculateDayNumber_(challenge.startDate, today));
  const dayPercents = {};
  entries.forEach((entry) => {
    const dayNumber = Number(entry.dayNumber || calculateDayNumber_(challenge.startDate, entry.entryDate));
    if (dayNumber < 1 || dayNumber > elapsedDays) return;
    dayPercents[dayNumber] = Math.min(100, Number(dayPercents[dayNumber] || 0) + Number(entry.completionPercent || 0));
  });

  let totalPercent = 0;
  for (let day = 1; day <= elapsedDays; day += 1) {
    totalPercent += Math.min(100, Number(dayPercents[day] || 0));
  }

  return {
    percent: durationDays ? Math.round(totalPercent / durationDays) : 0,
    elapsedDays,
    durationDays,
  };
}

function buildAnalytics_(challenge, goals, entries, today) {
  const durationDays = Math.max(1, Number(challenge.durationDays || 1));
  const elapsedDays = Math.min(durationDays, calculateDayNumber_(challenge.startDate, today));
  const entriesByDay = {};
  entries.forEach((entry) => {
    const dayNumber = Number(entry.dayNumber || calculateDayNumber_(challenge.startDate, entry.entryDate));
    if (!entriesByDay[dayNumber]) entriesByDay[dayNumber] = [];
    entriesByDay[dayNumber].push(entry);
  });

  const days = [];
  let elapsedPercentSum = 0;
  for (let dayNumber = 1; dayNumber <= durationDays; dayNumber += 1) {
    const dayEntries = entriesByDay[dayNumber] || [];
    const percent = Math.min(100, Math.round(dayEntries.reduce((sum, entry) => sum + Number(entry.completionPercent || 0), 0)));
    const date = addDays_(challenge.startDate, dayNumber - 1);
    const isFuture = dayNumber > elapsedDays;
    if (!isFuture) elapsedPercentSum += percent;
    days.push({
      dayNumber,
      date,
      percent,
      completedGoals: dayEntries.filter((entry) => parseBool_(entry.isCompleted)).length,
      totalGoals: goals.length,
      isFuture,
    });
  }

  const elapsedDaysData = days.filter((day) => !day.isFuture);
  const completedDays = elapsedDaysData.filter((day) => day.percent === 100).length;
  const lowDays = elapsedDaysData.filter((day) => day.percent < 50).length;
  const averageDayPercent = elapsedDays ? Math.round(elapsedPercentSum / elapsedDays) : 0;
  const overallPercent = durationDays ? Math.round(elapsedPercentSum / durationDays) : 0;
  const bestDay = elapsedDaysData.length
    ? elapsedDaysData.slice().sort((a, b) => b.percent - a.percent)[0]
    : null;
  const worstDay = elapsedDaysData.length
    ? elapsedDaysData.slice().sort((a, b) => a.percent - b.percent)[0]
    : null;

  const goalSummaries = goals.map((goal) => {
    const goalEntries = entries.filter((entry) => entry.goalId === goal.goalId);
    const completedCount = goalEntries.filter((entry) => parseBool_(entry.isCompleted)).length;
    const actualHours = goalEntries.reduce((sum, entry) => sum + Number(entry.actualHours || 0), 0);
    const targetHours = goal.goalType === 'time' ? Number(goal.targetHours || 0) * elapsedDays : 0;
    return {
      goalId: goal.goalId,
      title: goal.title,
      goalType: goal.goalType,
      targetHours: Number(goal.targetHours || 0),
      completedCount,
      elapsedDays,
      completionPercent: elapsedDays ? Math.round((completedCount / elapsedDays) * 100) : 0,
      actualHours: round1_(actualHours),
      plannedHours: round1_(targetHours),
      hoursBalance: round1_(actualHours - targetHours),
    };
  });
  const weakestGoal = goalSummaries.length
    ? goalSummaries.slice().sort((a, b) => a.completionPercent - b.completionPercent)[0]
    : null;
  const strongestGoal = goalSummaries.length
    ? goalSummaries.slice().sort((a, b) => b.completionPercent - a.completionPercent)[0]
    : null;

  return {
    summary: {
      durationDays,
      elapsedDays,
      completedDays,
      lowDays,
      averageDayPercent,
      overallPercent,
      bestDay,
      worstDay,
      weakestGoal,
      strongestGoal,
      isFinished: isChallengeFinished_(challenge, today),
    },
    days,
    goals: goalSummaries,
  };
}

function isChallengeFinished_(challenge, today) {
  return dateOnly_(today) > dateOnly_(challenge.endDate);
}

function parseBool_(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function round1_(number) {
  return Math.round(number * 10) / 10;
}

function normalizeSheetValue_(header, value) {
  if (value instanceof Date) {
    if (['startDate', 'endDate', 'entryDate'].indexOf(header) !== -1) {
      return Utilities.formatDate(value, APP_TIMEZONE, 'yyyy-MM-dd');
    }
    return toIso_(value);
  }
  return value;
}

function dateOnly_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, APP_TIMEZONE, 'yyyy-MM-dd');
  return String(value || '').slice(0, 10);
}
