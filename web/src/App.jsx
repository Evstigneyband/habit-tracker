import { useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentSession, signInWithEmail, signInWithTelegram, signOut, signUpWithEmail } from './services/authService'
import { supabase } from './lib/supabaseClient'
import {
  createChallenge,
  deleteChallenge,
  getChallengeEntries,
  getChallengeGoals,
  getUserProfile,
  getUserChallenges,
  restartChallenge,
  saveDailyEntry,
  setLastActiveChallenge,
  touchUserLastSeen,
} from './services/challengeService'
import './App.css'

function App() {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const [isAuthed, setIsAuthed] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [userId, setUserId] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [screen, setScreen] = useState('today')
  const [challenges, setChallenges] = useState([])
  const [activeChallengeId, setActiveChallengeId] = useState('')
  const [isLoadingChallenges, setIsLoadingChallenges] = useState(false)
  const [isLoadingGoals, setIsLoadingGoals] = useState(false)
  const [appError, setAppError] = useState('')
  const [simpleGoals, setSimpleGoals] = useState([])
  const [timeGoals, setTimeGoals] = useState([])
  const [rawGoals, setRawGoals] = useState([])
  const [dailyEntries, setDailyEntries] = useState([])
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')
  const activeChallengeIdRef = useRef('')
  const [editingChallenge, setEditingChallenge] = useState(null)

  useEffect(() => {
    const cleanupTelegram = setupTelegramWebApp(telegramContext)
    let isMounted = true
    const routeAfterLoad = (nextChallenges) => {
      if (nextChallenges.length === 0) {
        setEditingChallenge(null)
        navigate('create')
        return
      }

      navigate('today')
    }

    getCurrentSession()
      .then(async (session) => {
        if (!isMounted) return

        if (session?.user) {
          setUserId(session.user.id)
          setUserEmail(session.user.email || '')
          setIsAuthed(true)
          await markUserSeen(session.user.id)
          const nextChallenges = await loadChallenges(session.user.id, session.user.email || '')
          routeAfterLoad(nextChallenges)
          return
        }

        if (telegramContext.isTelegram && telegramContext.initData) {
          const telegramPayload = await signInWithTelegram(telegramContext.initData)
          const telegramUser = telegramPayload.session.user

          setUserId(telegramUser.id)
          setUserEmail(telegramPayload.profile?.displayName || telegramContext.userName || 'Telegram')
          setIsAuthed(true)
          await markUserSeen(telegramUser.id)
          const nextChallenges = await loadChallenges(telegramUser.id, telegramPayload.profile?.displayName || telegramContext.userName || 'Telegram')
          routeAfterLoad(nextChallenges)
        }
      })
      .catch((error) => {
        if (isMounted) setAuthError(formatAppError(error))
      })
      .finally(() => {
        if (isMounted) setIsCheckingSession(false)
      })

    return () => {
      isMounted = false
      cleanupTelegram()
    }
  }, [telegramContext])

  useEffect(() => {
    if (!activeChallengeId) {
      return
    }

    loadGoals(activeChallengeId)
  }, [activeChallengeId])

  useEffect(() => {
    activeChallengeIdRef.current = activeChallengeId
  }, [activeChallengeId])

  useEffect(() => {
    if (!isAuthed || !userId || !activeChallengeId || !supabase) return undefined

    const channel = supabase
      .channel(`challenge:${activeChallengeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_entries',
          filter: `challenge_id=eq.${activeChallengeId}`,
        },
        () => {
          if (activeChallengeIdRef.current === activeChallengeId) {
            loadGoals(activeChallengeId, { silent: true })
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeChallengeId, isAuthed, userId])

  const activeChallenge = useMemo(
    () => challenges.find((challenge) => challenge.id === activeChallengeId) || challenges[0] || null,
    [activeChallengeId, challenges],
  )

  const progress = useMemo(() => {
    const simpleDone = simpleGoals.filter((goal) => goal.done).length
    const timeDone = timeGoals.filter((goal) => goal.actual >= goal.target).length
    const total = simpleGoals.length + timeGoals.length
    const done = simpleDone + timeDone
    const todayPercent = total ? Math.round((done / total) * 100) : 0
    const analytics = buildAnalytics(activeChallenge, rawGoals, dailyEntries, total)

    return {
      done,
      total,
      todayPercent,
      overallPercent: analytics.overallPercent,
    }
  }, [activeChallenge, dailyEntries, rawGoals, simpleGoals, timeGoals])

  function navigate(nextScreen) {
    if (nextScreen !== 'create') setEditingChallenge(null)
    setScreen(nextScreen)
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  }

  async function login(event) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') || '').trim()
    const password = String(formData.get('password') || '')

    setAuthError('')

    try {
      const data =
        authMode === 'login'
          ? await signInWithEmail(email, password)
          : await signUpWithEmail(email, password)

      const user = data.user || data.session?.user

      if (authMode === 'register' && data.user?.identities?.length === 0) {
        setAuthMode('login')
        setAuthError('Этот email уже зарегистрирован. Перейди во “Вход” и используй свой пароль.')
        return
      }

      if (authMode === 'register' && !data.session) {
        setAuthMode('login')
        setAuthError('Регистрация почти готова. Открой письмо на почте, подтверди email и затем войди в приложение.')
        return
      }

      if (!user) {
        setAuthError('Открой письмо на почте, подтверди email и затем войди в приложение.')
        return
      }

      setUserEmail(user.email || email)
      setUserId(user.id)
      setIsAuthed(true)
      await markUserSeen(user.id)
      const nextChallenges = await loadChallenges(user.id, user.email || email)
      navigateAfterChallengesLoad(nextChallenges)
    } catch (error) {
      console.error('Auth error:', error)
      setAuthError(formatAppError(error))
    }
  }

  async function logout() {
    setAuthError('')
    await signOut()
    setUserId('')
    setUserEmail('')
    setChallenges([])
    setActiveChallengeId('')
    setSimpleGoals([])
    setTimeGoals([])
    setRawGoals([])
    setDailyEntries([])
    setIsAuthed(false)
    setAuthMode('login')
    navigate('auth')
  }

  async function loadChallenges(nextUserId, fallbackCaption = '') {
    setIsLoadingChallenges(true)
    setAppError('')

    try {
      const [nextChallenges, profile] = await Promise.all([
        getUserChallenges(nextUserId),
        getUserProfile(nextUserId),
      ])
      setUserEmail(getProfileCaption(profile, fallbackCaption))
      setChallenges(nextChallenges)
      if (nextChallenges.length === 0) {
        setSimpleGoals([])
        setTimeGoals([])
        setRawGoals([])
        setDailyEntries([])
      }
      setActiveChallengeId((currentId) => {
        if (currentId && nextChallenges.some((challenge) => challenge.id === currentId)) return currentId
        if (profile?.last_active_challenge_id && nextChallenges.some((challenge) => challenge.id === profile.last_active_challenge_id)) {
          return profile.last_active_challenge_id
        }
        return nextChallenges[0]?.id || ''
      })
      return nextChallenges
    } catch (error) {
      console.error('App error:', error)
      setAppError(formatAppError(error))
      return []
    } finally {
      setIsLoadingChallenges(false)
    }
  }

  async function markUserSeen(nextUserId) {
    try {
      await touchUserLastSeen(nextUserId)
    } catch (error) {
      console.warn('Could not update last seen timestamp:', error)
    }
  }

  function navigateAfterChallengesLoad(nextChallenges) {
    if (nextChallenges.length === 0) {
      setEditingChallenge(null)
      navigate('create')
      return
    }

    navigate('today')
  }

  async function selectChallenge(challengeId) {
    const isSameChallenge = challengeId === activeChallengeId

    if (!isSameChallenge) {
      setActiveChallengeId(challengeId)
      setSimpleGoals([])
      setTimeGoals([])
      setRawGoals([])
      setDailyEntries([])
    }

    setScreen('today')
    setAppError('')

    try {
      await setLastActiveChallenge(userId, challengeId)
      if (isSameChallenge) {
        await loadGoals(challengeId)
      }
    } catch (error) {
      console.error('App error:', error)
      setAppError(formatAppError(error))
    }
  }

  async function handleDeleteChallenge(challengeId) {
    const challenge = challenges.find((item) => item.id === challengeId)
    if (!challenge) return
    if (!window.confirm(`Удалить челлендж «${challenge.title}»?`)) return

    setAppError('')

    try {
      await deleteChallenge({ userId, challengeId })
      const nextChallenges = challenges.filter((item) => item.id !== challengeId)
      setChallenges(nextChallenges)

      if (challengeId === activeChallengeId) {
        const nextActiveId = nextChallenges[0]?.id || ''
        setActiveChallengeId(nextActiveId)
        setSimpleGoals([])
        setTimeGoals([])
        setRawGoals([])
        setDailyEntries([])
        await setLastActiveChallenge(userId, nextActiveId || null)
        if (!nextActiveId) {
          setEditingChallenge(null)
          navigate('create')
        }
      }
    } catch (error) {
      console.error('App error:', error)
      setAppError(formatAppError(error))
    }
  }

  async function loadGoals(challengeId, { silent = false } = {}) {
    if (!silent) setIsLoadingGoals(true)
    setAppError('')

    try {
      const [goals, entries] = await Promise.all([
        getChallengeGoals(challengeId),
        getChallengeEntries(challengeId),
      ])
      const todayEntries = entries.filter((entry) => entry.entry_date === getTodayDate())
      setRawGoals(goals)
      setDailyEntries(entries)
      setSimpleGoals(
        goals
          .filter((goal) => goal.goal_type === 'simple')
          .map((goal) => ({
            id: goal.id,
            title: goal.title,
            done: Boolean(findEntry(todayEntries, goal.id)?.is_checked),
          })),
      )
      setTimeGoals(
        goals
          .filter((goal) => goal.goal_type === 'time')
          .map((goal) => ({
            id: goal.id,
            title: goal.title,
            target: Number(goal.target_hours || 0),
            actual: Number(findEntry(todayEntries, goal.id)?.actual_hours || 0),
          })),
      )
    } catch (error) {
      console.error('App error:', error)
      setAppError(formatAppError(error))
    } finally {
      if (!silent) setIsLoadingGoals(false)
    }
  }

  async function handleCreateChallenge(payload) {
    setAppError('')

    try {
      if (editingChallenge) {
        const restartedChallenge = await restartChallenge({
          userId,
          challengeId: editingChallenge.id,
          title: payload.title,
          durationDays: payload.durationDays,
          startDate: getTodayDate(),
          simpleGoals: payload.simpleGoals,
          timeGoals: payload.timeGoals,
        })
        setChallenges((current) =>
          current.map((challenge) => (challenge.id === restartedChallenge.id ? restartedChallenge : challenge)),
        )
        setActiveChallengeId(restartedChallenge.id)
        setSimpleGoals([])
        setTimeGoals([])
        setRawGoals([])
        setDailyEntries([])
        setEditingChallenge(null)
        await setLastActiveChallenge(userId, restartedChallenge.id)
        await loadGoals(restartedChallenge.id)
        navigate('today')
        return
      }

      const createdChallenge = await createChallenge({
        userId,
        title: payload.title,
        durationDays: payload.durationDays,
        startDate: getTodayDate(),
        simpleGoals: payload.simpleGoals,
        timeGoals: payload.timeGoals,
      })
      setChallenges((current) => [createdChallenge, ...current])
      setActiveChallengeId(createdChallenge.id)
      await setLastActiveChallenge(userId, createdChallenge.id)
      navigate('today')
    } catch (error) {
      console.error('App error:', error)
      setAppError(formatAppError(error))
    }
  }

  async function handleEditChallenge(challengeId) {
    const challenge = challenges.find((item) => item.id === challengeId)
    if (!challenge) return

    setAppError('')

    try {
      const goals = await getChallengeGoals(challengeId)
      setEditingChallenge({
        id: challenge.id,
        title: challenge.title,
        durationDays: challenge.duration_days,
        simpleGoals: goals
          .filter((goal) => goal.goal_type === 'simple')
          .map((goal) => ({ id: crypto.randomUUID(), title: goal.title })),
        timeGoals: goals
          .filter((goal) => goal.goal_type === 'time')
          .map((goal) => ({
            id: crypto.randomUUID(),
            title: goal.title,
            targetHours: Number(goal.target_hours || 0),
          })),
      })
      setScreen('create')
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
    } catch (error) {
      console.error('App error:', error)
      setAppError(formatAppError(error))
    }
  }

  async function toggleSimpleGoal(goalId) {
    const goal = simpleGoals.find((item) => item.id === goalId)
    const rawGoal = rawGoals.find((item) => item.id === goalId)
    if (!goal || !rawGoal || !activeChallenge) return

    const nextDone = !goal.done
    setSimpleGoals((goals) =>
      goals.map((item) => (item.id === goalId ? { ...item, done: nextDone } : item)),
    )

    try {
      const savedEntry = await saveDailyEntry({
        challengeId: activeChallenge.id,
        goal: rawGoal,
        userId,
        entryDate: getTodayDate(),
        dayNumber: getChallengeDay(activeChallenge),
        isChecked: nextDone,
      })
      upsertEntryState(savedEntry)
    } catch (error) {
      console.error('App error:', error)
      setAppError(formatAppError(error))
      setSimpleGoals((goals) =>
        goals.map((item) => (item.id === goalId ? { ...item, done: goal.done } : item)),
      )
    }
  }

  async function setTimeGoal(goalId, value) {
    const goal = timeGoals.find((item) => item.id === goalId)
    const rawGoal = rawGoals.find((item) => item.id === goalId)
    if (!goal || !rawGoal || !activeChallenge) return

    const nextActual = Number(value)
    setTimeGoals((goals) =>
      goals.map((item) => (item.id === goalId ? { ...item, actual: nextActual } : item)),
    )

    try {
      const savedEntry = await saveDailyEntry({
        challengeId: activeChallenge.id,
        goal: rawGoal,
        userId,
        entryDate: getTodayDate(),
        dayNumber: getChallengeDay(activeChallenge),
        actualHours: nextActual,
      })
      upsertEntryState(savedEntry)
    } catch (error) {
      console.error('App error:', error)
      setAppError(formatAppError(error))
      setTimeGoals((goals) =>
        goals.map((item) => (item.id === goalId ? { ...item, actual: goal.actual } : item)),
      )
    }
  }

  function upsertEntryState(entry) {
    setDailyEntries((entries) => {
      const exists = entries.some((item) => item.id === entry.id)
      if (exists) return entries.map((item) => (item.id === entry.id ? entry : item))
      return [...entries, entry]
    })
  }

  if (isCheckingSession) {
    return (
      <AppShell
        caption="Личный трекер прогресса"
        showMenu={false}
        screen={screen}
        navigate={navigate}
        logout={logout}
        telegramContext={telegramContext}
      >
        <section className="screen">
          <div className="hero-card">
            <p className="eyebrow">Подключаемся</p>
            <h2>Проверяю вход.</h2>
            <p>Сейчас приложение проверяет, есть ли сохранённый вход.</p>
          </div>
        </section>
      </AppShell>
    )
  }

  if (!isAuthed) {
    return (
      <AppShell
        caption="Личный трекер прогресса"
        showMenu={false}
        screen={screen}
        navigate={navigate}
        logout={logout}
        telegramContext={telegramContext}
      >
        <AuthScreen authMode={authMode} setAuthMode={setAuthMode} onSubmit={login} authError={authError} />
      </AppShell>
    )
  }

  return (
    <AppShell
      caption={userEmail}
      showMenu
      screen={screen}
      navigate={navigate}
      logout={logout}
      telegramContext={telegramContext}
    >
      {screen === 'today' && (
        <TodayScreen
          progress={progress}
          challenge={activeChallenge}
          appError={appError}
          isLoadingGoals={isLoadingGoals}
          simpleGoals={simpleGoals}
          timeGoals={timeGoals}
          onToggleSimple={toggleSimpleGoal}
          onSetTime={setTimeGoal}
        />
      )}
      {screen === 'challenges' && (
        <ChallengesScreen
          challenges={challenges}
          activeChallengeId={activeChallengeId}
          isLoading={isLoadingChallenges}
          appError={appError}
          onSelectChallenge={selectChallenge}
          onDeleteChallenge={handleDeleteChallenge}
          onEditChallenge={handleEditChallenge}
          onCreate={() => navigate('create')}
          onCurrent={() => navigate('today')}
        />
      )}
      {screen === 'analytics' && (
        <AnalyticsScreen
          challenge={activeChallenge}
          goals={rawGoals}
          dailyEntries={dailyEntries}
          totalGoals={simpleGoals.length + timeGoals.length}
        />
      )}
      {screen === 'create' && (
        <CreateChallengeScreen
          key={editingChallenge?.id || 'new'}
          onSubmit={handleCreateChallenge}
          appError={appError}
          editingChallenge={editingChallenge}
        />
      )}
    </AppShell>
  )
}

function AppShell({ caption, showMenu, screen, navigate, logout, telegramContext, children }) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <main className={`app-shell ${telegramContext.isTelegram ? 'telegram-mode' : ''}`}>
      <div className="phone-shell">
        <header className="topbar">
          <div className="brand">
            <BrandMark telegramContext={telegramContext} />
            <div>
              <h1>Твой челлендж</h1>
              <p>{caption}</p>
            </div>
          </div>
          {showMenu && (
            <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Настройки">
              <SettingsIcon />
            </button>
          )}
        </header>

        {children}

        {settingsOpen && (
          <div className="modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
            <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Настройки" onClick={(event) => event.stopPropagation()}>
              <button className="modal-close" type="button" onClick={() => setSettingsOpen(false)} aria-label="Закрыть">
                <CloseIcon />
              </button>
              <p className="eyebrow">Разработка</p>
              <h2>EVSTIGNEY production</h2>
              <div className="platform-state">
                <span>Режим</span>
                <strong>{telegramContext.isTelegram ? 'Telegram Mini App' : 'Web'}</strong>
              </div>
              {telegramContext.userName && (
                <div className="platform-state">
                  <span>Telegram</span>
                  <strong>{telegramContext.userName}</strong>
                </div>
              )}
            </section>
          </div>
        )}

        {showMenu && (
          <nav className="bottom-nav" aria-label="Основная навигация">
            <NavButton active={screen === 'challenges'} label="Все челленджи" onClick={() => navigate('challenges')}>
              <ListIcon />
            </NavButton>
            <NavButton active={screen === 'today'} label="Сегодня" onClick={() => navigate('today')}>
              <TodayIcon />
            </NavButton>
            <NavButton active={screen === 'analytics'} label="Аналитика" onClick={() => navigate('analytics')}>
              <ChartIcon />
            </NavButton>
            <NavButton label="Выход" onClick={logout}>
              <LogoutIcon />
            </NavButton>
          </nav>
        )}
      </div>
    </main>
  )
}

function BrandMark({ telegramContext }) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const avatarUrl = telegramContext.isTelegram && !avatarFailed ? telegramContext.userPhotoUrl : ''

  if (avatarUrl) {
    return (
      <img
        className="brand-avatar"
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        onError={() => setAvatarFailed(true)}
      />
    )
  }

  return <div className="brand-mark" aria-hidden="true" />
}

function AuthScreen({ authMode, setAuthMode, onSubmit, authError }) {
  return (
    <section className="screen">
      <div className="hero-card">
        <p className="eyebrow">Начни спокойно</p>
        <h2>Собери день в проценты.</h2>
        <p>
          Создай челлендж, добавь цели без времени и цели с часами. Отмечай день по ходу
          дела, а приложение сохранит прогресс.
        </p>
      </div>

      <form className="surface form" onSubmit={onSubmit}>
        <div className="auth-toggle" aria-label="Режим входа">
          <button
            className={authMode === 'login' ? 'active' : ''}
            type="button"
            onClick={() => setAuthMode('login')}
          >
            Вход
          </button>
          <button
            className={authMode === 'register' ? 'active' : ''}
            type="button"
            onClick={() => setAuthMode('register')}
          >
            Регистрация
          </button>
        </div>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            name="password"
            type="password"
            autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>
        {authError && <p className="form-error">{authError}</p>}
        <button className="primary-button" type="submit">
          {authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
        </button>
      </form>
    </section>
  )
}

function TodayScreen({ progress, challenge, appError, isLoadingGoals, simpleGoals, timeGoals, onToggleSimple, onSetTime }) {
  if (!challenge) {
    return (
      <section className="screen">
        <div className="hero-card">
          <p className="eyebrow">Первый челлендж</p>
          <h2>Создай старт.</h2>
          <p>Пока здесь нет ни одного челленджа. Открой вкладку “Все челленджи” и создай первый.</p>
        </div>
        {appError && <p className="form-error">{appError}</p>}
      </section>
    )
  }

  return (
    <section className="screen">
      <ProgressCard progress={progress} challenge={challenge} />
      {appError && <p className="form-error">{appError}</p>}
      {isLoadingGoals && <p className="muted-state">Загружаю цели...</p>}

      {!isLoadingGoals && (
        <>
          <GoalSection title="Простые цели">
            {simpleGoals.length === 0 && <EmptyGoalState>Простых целей пока нет.</EmptyGoalState>}
            {simpleGoals.map((goal) => (
              <SimpleGoalRow key={goal.id} goal={goal} onToggle={() => onToggleSimple(goal.id)} />
            ))}
          </GoalSection>

          <GoalSection title="Цели по часам">
            {timeGoals.length === 0 && <EmptyGoalState>Целей по часам пока нет.</EmptyGoalState>}
            {timeGoals.map((goal) => (
              <TimeGoalRow key={goal.id} goal={goal} onChange={(value) => onSetTime(goal.id, value)} />
            ))}
          </GoalSection>
        </>
      )}
    </section>
  )
}

function ProgressCard({ progress, challenge }) {
  return (
    <section className="progress-card">
      <div className="progress-head">
        <div>
          <h2>{challenge.title}</h2>
          <p>День {getChallengeDay(challenge)} из {challenge.duration_days}</p>
        </div>
        <strong>{progress.todayPercent}%</strong>
      </div>

      <div className="progress-stack">
        <ProgressLine label="Сегодня" value={progress.todayPercent} />
        <ProgressLine label="Общий прогресс" value={progress.overallPercent} overall />
      </div>

      <p className="progress-caption">
        {progress.done} из {progress.total} целей закрыто сегодня. Общий прогресс: {progress.overallPercent}%
      </p>
    </section>
  )
}

function ProgressLine({ label, value, overall }) {
  return (
    <div className="progress-line">
      <div>
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="progress-track">
        <i className={overall ? 'overall' : ''} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function GoalSection({ title, children }) {
  return (
    <section className="goal-section">
      <h2>{title}</h2>
      <div className="goal-list">{children}</div>
    </section>
  )
}

function EmptyGoalState({ children }) {
  return <p className="empty-goal-state">{children}</p>
}

function SimpleGoalRow({ goal, onToggle }) {
  return (
    <article className="goal-row">
      <span className="goal-icon">
        <HeartIcon />
      </span>
      <strong>{goal.title}</strong>
      <button className={`check-button ${goal.done ? 'done' : ''}`} type="button" onClick={onToggle} aria-label="Отметить цель" />
    </article>
  )
}

function TimeGoalRow({ goal, onChange }) {
  const done = goal.actual >= goal.target
  return (
    <article className="goal-row time-row">
      <span className="goal-icon">
        <ClockIcon />
      </span>
      <div className="goal-copy">
        <strong>{goal.title}</strong>
        <span>{formatHours(goal.target)}</span>
      </div>
      <select value={goal.actual} onChange={(event) => onChange(event.target.value)} aria-label={`Время для ${goal.title}`}>
        {timeOptions.map((value) => (
          <option key={value} value={value}>
            {formatHours(value)}
          </option>
        ))}
      </select>
      <span className={`check-button status ${done ? 'done' : ''}`} aria-label="Статус цели" />
    </article>
  )
}

function ChallengesScreen({
  challenges,
  activeChallengeId,
  isLoading,
  appError,
  onSelectChallenge,
  onDeleteChallenge,
  onEditChallenge,
  onCreate,
  onCurrent,
}) {
  const [openId, setOpenId] = useState('')

  return (
    <section className="screen">
      <div className="hero-card">
        <p className="eyebrow">Твои челленджи</p>
        <h2>Выбери, что открыть.</h2>
        <p>
          После входа приложение открывает последний активный челлендж, но здесь можно
          переключиться на любой другой.
        </p>
        <div className="hero-actions">
          <button type="button" onClick={onCreate}>Создать новый</button>
          <button type="button" onClick={onCurrent}>Текущий</button>
        </div>
      </div>

      <div className="challenge-list">
        {appError && <p className="form-error">{appError}</p>}
        {isLoading && <p className="muted-state">Загружаю челленджи...</p>}
        {!isLoading && challenges.length === 0 && <p className="muted-state">Пока нет челленджей. Создай первый.</p>}
        {challenges.map((challenge) => (
          <ChallengeRow
            key={challenge.id}
            challenge={normalizeChallenge(challenge, activeChallengeId)}
            open={openId === challenge.id}
            onOpen={() => setOpenId(challenge.id)}
            onClose={() => setOpenId('')}
            onSelect={() => onSelectChallenge(challenge.id)}
            onEdit={() => {
              setOpenId('')
              onEditChallenge(challenge.id)
            }}
            onDelete={() => {
              setOpenId('')
              onDeleteChallenge(challenge.id)
            }}
          />
        ))}
      </div>
    </section>
  )
}

function ChallengeRow({ challenge, open, onOpen, onClose, onSelect, onEdit, onDelete }) {
  const pointerStart = useRef(null)
  const suppressClick = useRef(false)

  function handlePointerDown(event) {
    pointerStart.current = {
      x: event.clientX,
      y: event.clientY,
    }
    suppressClick.current = false
  }

  function handlePointerUp(event) {
    if (!pointerStart.current) return

    const deltaX = event.clientX - pointerStart.current.x
    const deltaY = event.clientY - pointerStart.current.y
    pointerStart.current = null

    if (Math.abs(deltaX) < 34 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return

    suppressClick.current = true
    if (deltaX < 0) {
      onOpen()
    } else {
      onClose()
    }
  }

  function handleClick() {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    onSelect()
  }

  return (
    <article className={`challenge-row ${challenge.active ? 'active' : ''} ${open ? 'open' : ''}`}>
      <div className="challenge-actions">
        <button type="button" onClick={onEdit} aria-label="Редактировать челлендж">
          <EditIcon />
        </button>
        <button className="delete" type="button" onClick={onDelete} aria-label="Удалить челлендж">
          <CloseIcon />
        </button>
      </div>
      <button
        className="challenge-card"
        type="button"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pointerStart.current = null
        }}
      >
        <div>
          <strong>{challenge.title}</strong>
          <span>
            {challenge.goals} целей. Старт: {challenge.startDate}
          </span>
        </div>
        <small>
          {challenge.day}/{challenge.days}
        </small>
      </button>
    </article>
  )
}

function AnalyticsScreen({ challenge, goals, dailyEntries, totalGoals }) {
  const analytics = useMemo(
    () => buildAnalytics(challenge, goals, dailyEntries, totalGoals),
    [challenge, goals, dailyEntries, totalGoals],
  )

  return (
    <section className="screen">
      <div className="hero-card">
        <p className="eyebrow">Аналитика</p>
        <h2>{challenge?.title || 'Нет челленджа'}</h2>
        <p>
          День {analytics.currentDay} из {analytics.durationDays}. Данные обновляются по сохранённым отметкам.
        </p>
      </div>

      <div className="metric-grid">
        <Metric value={`${analytics.overallPercent}%`} label="Общий прогресс" />
        <Metric value={`${analytics.averagePercent}%`} label="Средний день" />
        <Metric value={String(analytics.fullDays)} label="Дней на 100%" />
        <Metric value={String(analytics.lowDays)} label="Дней ниже 50%" />
      </div>

      <section className="surface">
        <h2 className="section-heading">Календарь</h2>
        <div className="day-grid">
          {analytics.days.map((day) => (
            <div
              className={`day-cell ${day.future ? 'future' : day.percent === 100 ? 'good' : day.percent >= 50 ? 'mid' : 'low'}`}
              key={day.day}
            >
              <span>{day.day}</span>
              <small>{day.future ? '' : `${day.percent}%`}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="surface analytics-section">
        <h2 className="section-heading">Разбор по целям</h2>
        <div className="analytics-goal-list">
          {analytics.goalStats.length === 0 && <p className="muted-state">Пока нет целей для анализа.</p>}
          {analytics.goalStats.map((goal) => (
            <article className="analytics-goal-card" key={goal.id}>
              <div className="analytics-goal-head">
                <span>{goal.title}</span>
                <span>{goal.completionPercent}%</span>
              </div>
              <div className="mini-track">
                <div className="mini-fill" style={{ width: `${goal.completionPercent}%` }} />
              </div>
              <div className="state-line">{goal.meta}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="surface analytics-section">
        <h2 className="section-heading">Что видно по данным</h2>
        <div className="insight-list">
          {analytics.insights.map((insight) => (
            <div className="insight" key={insight}>
              {insight}
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}

function CreateChallengeScreen({ onSubmit, appError, editingChallenge }) {
  const isEditing = Boolean(editingChallenge)
  const [simpleDraft, setSimpleDraft] = useState('')
  const [timeDraftTitle, setTimeDraftTitle] = useState('')
  const [timeDraftHours, setTimeDraftHours] = useState(1)
  const [simpleGoals, setSimpleGoals] = useState(editingChallenge?.simpleGoals || [])
  const [timeGoals, setTimeGoals] = useState(editingChallenge?.timeGoals || [])
  const [localError, setLocalError] = useState('')

  function addSimpleGoal() {
    const title = simpleDraft.trim()
    if (!title) return

    setSimpleGoals((goals) => [...goals, { id: crypto.randomUUID(), title }])
    setSimpleDraft('')
    setLocalError('')
  }

  function addTimeGoal() {
    const title = timeDraftTitle.trim()
    if (!title) return

    setTimeGoals((goals) => [
      ...goals,
      { id: crypto.randomUUID(), title, targetHours: Number(timeDraftHours) },
    ])
    setTimeDraftTitle('')
    setTimeDraftHours(1)
    setLocalError('')
  }

  function removeSimpleGoal(goalId) {
    setSimpleGoals((goals) => goals.filter((goal) => goal.id !== goalId))
  }

  function removeTimeGoal(goalId) {
    setTimeGoals((goals) => goals.filter((goal) => goal.id !== goalId))
  }

  function updateGoal(type, goalId, field, value) {
    const updater = (goal) =>
      goal.id === goalId
        ? { ...goal, [field]: field === 'targetHours' ? Number(value || 0) : value }
        : goal

    if (type === 'simple') setSimpleGoals((goals) => goals.map(updater))
    if (type === 'time') setTimeGoals((goals) => goals.map(updater))
  }

  function moveGoal(type, goalId, direction) {
    const move = (goals) => {
      const index = goals.findIndex((goal) => goal.id === goalId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= goals.length) return goals

      const nextGoals = [...goals]
      const [item] = nextGoals.splice(index, 1)
      nextGoals.splice(nextIndex, 0, item)
      return nextGoals
    }

    if (type === 'simple') setSimpleGoals(move)
    if (type === 'time') setTimeGoals(move)
  }

  function submit(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const normalizedSimpleGoals = simpleGoals
      .map((goal) => ({ ...goal, title: goal.title.trim() }))
      .filter((goal) => goal.title)
    const normalizedTimeGoals = timeGoals
      .map((goal) => ({
        ...goal,
        title: goal.title.trim(),
        targetHours: Number(goal.targetHours || 0),
      }))
      .filter((goal) => goal.title && goal.targetHours > 0)

    if (normalizedSimpleGoals.length + normalizedTimeGoals.length === 0) {
      setLocalError('Добавь хотя бы одну цель.')
      return
    }

    onSubmit({
      title: String(formData.get('title') || '').trim(),
      durationDays: Number(formData.get('durationDays') || 30),
      simpleGoals: normalizedSimpleGoals,
      timeGoals: normalizedTimeGoals,
    })
  }

  return (
    <section className="screen">
      <div className="hero-card">
        <p className="eyebrow">{isEditing ? 'Редактирование' : 'Новый старт'}</p>
        <h2>{isEditing ? 'Редактируй челлендж.' : 'Создай челлендж.'}</h2>
        <p>
          {isEditing
            ? 'После сохранения челлендж начнется заново с сегодняшней даты, а текущие отметки сбросятся.'
            : 'Все цели получают одинаковый вес. Если целей десять, каждая закрытая цель добавляет 10% к дню.'}
        </p>
      </div>

      <form className="surface form" onSubmit={submit}>
        <label className="field">
          <span>Название челленджа</span>
          <input name="title" defaultValue={editingChallenge?.title || ''} placeholder="Например: Майский рывок" required />
        </label>
        <label className="field">
          <span>Количество дней</span>
          <input name="durationDays" type="number" defaultValue={editingChallenge?.durationDays || 30} min={1} max={365} required />
        </label>
        <div className="goal-builder">
          <div>
            <h3>Простые цели</h3>
            <p>Отмечаются галочкой.</p>
          </div>
          <div className="add-row">
            <input
              value={simpleDraft}
              onChange={(event) => setSimpleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addSimpleGoal()
                }
              }}
              placeholder="Например: спорт"
            />
            <button type="button" onClick={addSimpleGoal} aria-label="Добавить простую цель">
              +
            </button>
          </div>
          <DraftGoalList
            goals={simpleGoals}
            onRemove={removeSimpleGoal}
            onUpdate={(goalId, field, value) => updateGoal('simple', goalId, field, value)}
            onMove={(goalId, direction) => moveGoal('simple', goalId, direction)}
            canEditContent={isEditing}
          />
        </div>

        <div className="goal-builder">
          <div>
            <h3>Цели по часам</h3>
            <p>Закрываются, когда набрано нужное время.</p>
          </div>
          <div className="add-row time-add-row">
            <input
              value={timeDraftTitle}
              onChange={(event) => setTimeDraftTitle(event.target.value)}
              placeholder="Например: Wizard Elements"
            />
            <select value={timeDraftHours} onChange={(event) => setTimeDraftHours(event.target.value)}>
              {timeOptions.filter((value) => value > 0).map((value) => (
                <option key={value} value={value}>
                  {formatHours(value)}
                </option>
              ))}
            </select>
            <button type="button" onClick={addTimeGoal} aria-label="Добавить цель по часам">
              +
            </button>
          </div>
          <DraftGoalList
            goals={timeGoals}
            onRemove={removeTimeGoal}
            onUpdate={(goalId, field, value) => updateGoal('time', goalId, field, value)}
            onMove={(goalId, direction) => moveGoal('time', goalId, direction)}
            withHours
            canEditContent={isEditing}
          />
        </div>

        {(localError || appError) && <p className="form-error">{localError || appError}</p>}
        <button className="primary-button" type="submit">
          {isEditing ? 'Перезапустить челлендж' : 'Начать челлендж'}
        </button>
      </form>
    </section>
  )
}

function DraftGoalList({ goals, onRemove, onUpdate, onMove, withHours = false, canEditContent = false }) {
  if (goals.length === 0) return null

  return (
    <div className="draft-goals">
      {goals.map((goal, index) => (
        <div key={goal.id}>
          {canEditContent ? (
            <div className={withHours ? 'draft-time-edit' : 'draft-text-edit'}>
              <input value={goal.title} onChange={(event) => onUpdate(goal.id, 'title', event.target.value)} />
              {withHours && (
                <select value={goal.targetHours} onChange={(event) => onUpdate(goal.id, 'targetHours', event.target.value)}>
                  {timeOptions.filter((value) => value > 0).map((value) => (
                    <option key={value} value={value}>
                      {formatHours(value)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="draft-goal-main">
              <span>{goal.title}</span>
              {withHours && <small>{formatHours(goal.targetHours)}</small>}
            </div>
          )}
          <div className="draft-actions">
            <button type="button" onClick={() => onMove(goal.id, -1)} disabled={index === 0} aria-label="Выше">
              ↑
            </button>
            <button type="button" onClick={() => onMove(goal.id, 1)} disabled={index === goals.length - 1} aria-label="Ниже">
              ↓
            </button>
          </div>
          <button type="button" onClick={() => onRemove(goal.id)} aria-label="Убрать цель">
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  )
}

function Metric({ value, label }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function NavButton({ active, label, onClick, children }) {
  return (
    <button className={active ? 'active' : ''} type="button" onClick={onClick}>
      {children}
      <span>{label}</span>
    </button>
  )
}

const timeOptions = Array.from({ length: 21 }, (_, index) => index * 0.5)

function formatHours(value) {
  const number = Number(value || 0)
  if (number === 0) return '0'
  if (number === 0.5) return '30 минут'
  if (number % 1 === 0.5) return `${Math.floor(number)} ч 30 мин`
  if (number === 1) return '1 час'
  if (number > 1 && number < 5) return `${number} часа`
  return `${number} часов`
}

function findEntry(entries, goalId) {
  return entries.find((entry) => entry.goal_id === goalId)
}

function buildAnalytics(challenge, goals, entries, totalGoals) {
  if (!challenge) {
    return {
      currentDay: 0,
      durationDays: 0,
      overallPercent: 0,
      averagePercent: 0,
      fullDays: 0,
      lowDays: 0,
      days: [],
      goalStats: [],
      insights: ['Данных пока мало. Отметь хотя бы один день, и здесь появятся выводы.'],
    }
  }

  const currentDay = getChallengeDay(challenge)
  const durationDays = challenge.duration_days
  const entriesByDay = entries.reduce((acc, entry) => {
    const day = Number(entry.day_number || 0)
    if (!day) return acc
    if (!acc.has(day)) acc.set(day, [])
    acc.get(day).push(entry)
    return acc
  }, new Map())

  const days = Array.from({ length: durationDays }, (_, index) => {
    const day = index + 1
    const dayEntries = entriesByDay.get(day) || []
    const completed = dayEntries.filter((entry) => entry.is_completed).length
    const percent = totalGoals ? Math.round((completed / totalGoals) * 100) : 0

    return {
      day,
      date: addDays(challenge.start_date, index),
      percent,
      future: day > currentDay,
    }
  })

  const elapsedDays = days.filter((day) => !day.future)
  const elapsedTotal = elapsedDays.reduce((sum, day) => sum + day.percent, 0)
  const elapsedCount = Math.max(elapsedDays.length, 1)
  const entriesByGoal = entries.reduce((acc, entry) => {
    if (!acc.has(entry.goal_id)) acc.set(entry.goal_id, [])
    acc.get(entry.goal_id).push(entry)
    return acc
  }, new Map())

  const goalStats = goals.map((goal) => {
    const goalEntries = entriesByGoal.get(goal.id) || []
    const completedDays = goalEntries.filter((entry) => entry.is_completed).length
    const actualHours = goalEntries.reduce((sum, entry) => sum + Number(entry.actual_hours || 0), 0)
    const plannedHours = goal.goal_type === 'time' ? Number(goal.target_hours || 0) * elapsedCount : 0
    const completionPercent = Math.round((completedDays / elapsedCount) * 100)
    const meta =
      goal.goal_type === 'time'
        ? `Факт ${formatHours(actualHours)} из ${formatHours(plannedHours)}`
        : `${completedDays} из ${elapsedCount} дней`

    return {
      id: goal.id,
      title: goal.title,
      goalType: goal.goal_type,
      completionPercent,
      completedDays,
      elapsedDays: elapsedCount,
      actualHours,
      plannedHours,
      meta,
    }
  })
  const strongestGoal = goalStats.length
    ? goalStats.slice().sort((a, b) => b.completionPercent - a.completionPercent)[0]
    : null
  const weakestGoal = goalStats.length
    ? goalStats.slice().sort((a, b) => a.completionPercent - b.completionPercent)[0]
    : null
  const bestDay = elapsedDays.length
    ? elapsedDays.slice().sort((a, b) => b.percent - a.percent)[0]
    : null
  const worstDay = elapsedDays.length
    ? elapsedDays.slice().sort((a, b) => a.percent - b.percent)[0]
    : null
  const insights = buildInsights({ strongestGoal, weakestGoal, bestDay, worstDay })

  return {
    currentDay,
    durationDays,
    overallPercent: durationDays ? Math.round(elapsedTotal / durationDays) : 0,
    averagePercent: elapsedDays.length ? Math.round(elapsedTotal / elapsedDays.length) : 0,
    fullDays: elapsedDays.filter((day) => day.percent === 100).length,
    lowDays: elapsedDays.filter((day) => day.percent < 50).length,
    days,
    goalStats,
    insights,
  }
}

function buildInsights({ strongestGoal, weakestGoal, bestDay, worstDay }) {
  const insights = []
  if (strongestGoal) {
    insights.push(`Стабильнее всего: ${strongestGoal.title} (${strongestGoal.completionPercent}%).`)
  }
  if (weakestGoal) {
    insights.push(`Больше всего проседает: ${weakestGoal.title} (${weakestGoal.completionPercent}%).`)
  }
  if (bestDay) {
    insights.push(`Лучший день: ${formatDate(bestDay.date)}, ${bestDay.percent}%.`)
  }
  if (worstDay) {
    insights.push(`Самый слабый день: ${formatDate(worstDay.date)}, ${worstDay.percent}%.`)
  }
  if (!insights.length) {
    insights.push('Данных пока мало. Отметь хотя бы один день, и здесь появятся выводы.')
  }
  return insights
}

function getTodayDate() {
  return formatLocalDate(new Date())
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getChallengeDay(challenge) {
  const start = new Date(`${challenge.start_date}T00:00:00`)
  const today = new Date(`${getTodayDate()}T00:00:00`)
  const diff = Math.floor((today - start) / 86_400_000) + 1
  return Math.min(Math.max(diff, 1), challenge.duration_days)
}

function formatDate(dateString) {
  if (!dateString) return ''
  const [year, month, day] = dateString.split('-')
  return `${day}.${month}.${year}`
}

function normalizeChallenge(challenge, activeChallengeId) {
  return {
    id: challenge.id,
    title: challenge.title,
    day: getChallengeDay(challenge),
    days: challenge.duration_days,
    goals: challenge.total_goals,
    startDate: formatDate(challenge.start_date),
    active: challenge.id === activeChallengeId,
  }
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7h10M7 12h10M7 17h10" stroke="currentColor" strokeLinecap="round" />
      <path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  )
}

function TodayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 5h8M6 9h12M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m9 14 2 2 4-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 20V10M12 20V4M18 20v-7" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" />
      <path d="M12 8v5l3 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m14.5 5.5 4 4M5 19l4.2-.8L18 9.4 14.6 6 5.8 14.8 5 19Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9.7 4.1 10.4 2h3.2l.7 2.1 1.6.7 2-1 2.3 2.3-1 2 .7 1.6 2.1.7v3.2l-2.1.7-.7 1.6 1 2-2.3 2.3-2-1-1.6.7-.7 2.1h-3.2l-.7-2.1-1.6-.7-2 1-2.3-2.3 1-2-.7-1.6-2.1-.7v-3.2l2.1-.7.7-1.6-1-2 2.3-2.3 2 1 1.6-.7Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

function getTelegramContext() {
  const webApp = getTelegramWebApp()
  const isTelegram = Boolean(webApp?.initData)
  const user = webApp?.initDataUnsafe?.user
  const userName = user
    ? user.username
      ? `@${user.username}`
      : [user.first_name, user.last_name].filter(Boolean).join(' ')
    : ''

  return {
    isTelegram,
    initData: isTelegram ? webApp.initData : '',
    userName,
    userPhotoUrl: isTelegram ? user?.photo_url || '' : '',
    webApp: isTelegram ? webApp : null,
  }
}

function getProfileCaption(profile, fallbackCaption = '') {
  if (!profile) return fallbackCaption

  if (profile.auth_provider === 'telegram') {
    if (profile.display_name) return profile.display_name
    if (profile.telegram_username) return `@${profile.telegram_username}`
    return fallbackCaption || 'Telegram'
  }

  return profile.email || fallbackCaption
}

function getTelegramWebApp() {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp || null
}

function setupTelegramWebApp(telegramContext) {
  const webApp = telegramContext.webApp
  const root = document.documentElement
  const body = document.body

  if (!telegramContext.isTelegram || !webApp) {
    body.classList.remove('telegram-webapp')
    root.style.removeProperty('--tg-viewport-height')
    return () => {}
  }

  body.classList.add('telegram-webapp')

  const syncViewport = () => {
    const height = webApp.viewportStableHeight || webApp.viewportHeight
    if (height) root.style.setProperty('--tg-viewport-height', `${height}px`)
  }

  syncViewport()
  webApp.ready()
  webApp.expand()
  webApp.disableVerticalSwipes?.()
  webApp.onEvent?.('viewportChanged', syncViewport)

  return () => {
    webApp.offEvent?.('viewportChanged', syncViewport)
  }
}

function formatAppError(error) {
  const rawMessage = String(error?.message || error || '')
  const message = rawMessage.toLowerCase()

  if (message.includes('already registered') || message.includes('already exists') || message.includes('user already')) {
    return 'Этот email уже зарегистрирован. Перейди во “Вход” и используй свой пароль.'
  }

  if (message.includes('signup disabled')) {
    return 'Регистрация сейчас отключена. Попробуй позже или войди в уже созданный аккаунт.'
  }

  if (message.includes('password') && (message.includes('weak') || message.includes('short') || message.includes('at least'))) {
    return 'Пароль слишком простой или короткий. Придумай пароль минимум из 6 символов.'
  }

  if (message.includes('rate limit') || message.includes('too many') || message.includes('security purposes')) {
    return 'Слишком много попыток подряд. Подожди пару минут и попробуй снова.'
  }

  if (message.includes('sending') || message.includes('send') || message.includes('email provider')) {
    return 'Не получилось отправить письмо подтверждения. Проверь email или попробуй ещё раз чуть позже.'
  }

  if (message.includes('database error saving new user')) {
    return 'Не получилось завершить регистрацию. Попробуй ещё раз чуть позже.'
  }

  if (message.includes('permission denied')) {
    return 'Доступ ещё не готов. Если ты только что зарегистрировался, подтверди email по ссылке из письма и войди снова.'
  }

  if (message.includes('invalid login credentials')) {
    return 'Неверный email или пароль. Проверь данные и попробуй ещё раз.'
  }

  if (message.includes('email not confirmed')) {
    return 'Email ещё не подтверждён. Открой письмо на почте и перейди по ссылке подтверждения.'
  }

  if (
    rawMessage.includes('Telegram') ||
    rawMessage.includes('мини-приложение') ||
    rawMessage.includes('Vercel') ||
    rawMessage.includes('Supabase')
  ) {
    return rawMessage
  }

  if (message.includes('telegram auth')) {
    return 'Не получилось войти через Telegram. Закрой мини-приложение и открой его снова.'
  }

  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'Не получилось подключиться. Проверь интернет и попробуй ещё раз.'
  }

  return 'Что-то пошло не так. Попробуй ещё раз.'
}

export default App
