import { useEffect, useMemo, useState } from 'react'
import { getCurrentSession, signInWithEmail, signOut, signUpWithEmail } from './services/authService'
import { createChallenge, getChallengeGoals, getUserChallenges, setLastActiveChallenge } from './services/challengeService'
import './App.css'

const analyticsDays = Array.from({ length: 30 }, (_, index) => {
  const day = index + 1
  const percent = day === 1 ? 100 : day === 2 ? 85 : day === 3 ? 55 : day === 4 ? 50 : 0
  return { day, percent, future: day > 4 }
})

function App() {
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
  const [authMode, setAuthMode] = useState('login')
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    let isMounted = true

    getCurrentSession()
      .then((session) => {
        if (!isMounted) return

        if (session?.user) {
          setUserId(session.user.id)
          setUserEmail(session.user.email || '')
          setIsAuthed(true)
          loadChallenges(session.user.id)
          navigate('today')
        }
      })
      .catch((error) => {
        if (isMounted) setAuthError(error.message)
      })
      .finally(() => {
        if (isMounted) setIsCheckingSession(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!activeChallengeId) {
      return
    }

    loadGoals(activeChallengeId)
  }, [activeChallengeId])

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
    const challengeDay = activeChallenge ? getChallengeDay(activeChallenge) : 1
    const durationDays = activeChallenge?.duration_days || 1

    return {
      done,
      total,
      todayPercent,
      overallPercent: Math.round(((challengeDay - 1 + todayPercent / 100) / durationDays) * 100),
    }
  }, [activeChallenge, simpleGoals, timeGoals])

  function navigate(nextScreen) {
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

      if (!user) {
        setAuthError('Проверь почту и подтверди регистрацию, потом войди с этим email и паролем.')
        return
      }

      setUserEmail(user.email || email)
      setUserId(user.id)
      setIsAuthed(true)
      await loadChallenges(user.id)
      navigate('today')
    } catch (error) {
      setAuthError(error.message)
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
    setIsAuthed(false)
    setAuthMode('login')
    navigate('auth')
  }

  async function loadChallenges(nextUserId) {
    setIsLoadingChallenges(true)
    setAppError('')

    try {
      const nextChallenges = await getUserChallenges(nextUserId)
      setChallenges(nextChallenges)
      if (nextChallenges.length === 0) {
        setSimpleGoals([])
        setTimeGoals([])
      }
      setActiveChallengeId((currentId) => {
        if (currentId && nextChallenges.some((challenge) => challenge.id === currentId)) return currentId
        return nextChallenges[0]?.id || ''
      })
    } catch (error) {
      setAppError(error.message)
    } finally {
      setIsLoadingChallenges(false)
    }
  }

  async function selectChallenge(challengeId) {
    setActiveChallengeId(challengeId)
    setScreen('today')
    setAppError('')

    try {
      await setLastActiveChallenge(userId, challengeId)
    } catch (error) {
      setAppError(error.message)
    }
  }

  async function loadGoals(challengeId) {
    setIsLoadingGoals(true)
    setAppError('')

    try {
      const goals = await getChallengeGoals(challengeId)
      setSimpleGoals(
        goals
          .filter((goal) => goal.goal_type === 'simple')
          .map((goal) => ({
            id: goal.id,
            title: goal.title,
            done: false,
          })),
      )
      setTimeGoals(
        goals
          .filter((goal) => goal.goal_type === 'time')
          .map((goal) => ({
            id: goal.id,
            title: goal.title,
            target: Number(goal.target_hours || 0),
            actual: 0,
          })),
      )
    } catch (error) {
      setAppError(error.message)
    } finally {
      setIsLoadingGoals(false)
    }
  }

  async function handleCreateChallenge(payload) {
    setAppError('')

    try {
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
      setAppError(error.message)
    }
  }

  function toggleSimpleGoal(goalId) {
    setSimpleGoals((goals) =>
      goals.map((goal) => (goal.id === goalId ? { ...goal, done: !goal.done } : goal)),
    )
  }

  function setTimeGoal(goalId, value) {
    setTimeGoals((goals) =>
      goals.map((goal) => (goal.id === goalId ? { ...goal, actual: Number(value) } : goal)),
    )
  }

  if (isCheckingSession) {
    return (
      <AppShell caption="Личный трекер прогресса" showMenu={false} screen={screen} navigate={navigate} logout={logout}>
        <section className="screen">
          <div className="hero-card">
            <p className="eyebrow">Подключаемся</p>
            <h2>Проверяю вход.</h2>
            <p>Сейчас приложение смотрит, есть ли сохранённая сессия Supabase.</p>
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
          onSelectChallenge={selectChallenge}
          onCreate={() => navigate('create')}
          onCurrent={() => navigate('today')}
        />
      )}
      {screen === 'analytics' && <AnalyticsScreen challenge={activeChallenge} />}
      {screen === 'create' && <CreateChallengeScreen onSubmit={handleCreateChallenge} appError={appError} />}
    </AppShell>
  )
}

function AppShell({ caption, showMenu, screen, navigate, logout, children }) {
  return (
    <main className="app-shell">
      <div className="phone-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true" />
            <div>
              <h1>Твой челлендж</h1>
              <p>{caption}</p>
            </div>
          </div>
          {showMenu && (
            <button className="menu-button" type="button" onClick={() => navigate('create')} aria-label="Создать челлендж">
              <span />
            </button>
          )}
        </header>

        {children}

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
          <p>Пока в Supabase нет ни одного челленджа для этого аккаунта. Нажми меню сверху или вкладку “Все челленджи”, чтобы создать первый.</p>
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
        <ProgressLine label="Весь челлендж" value={progress.overallPercent} overall />
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

function ChallengesScreen({ challenges, activeChallengeId, isLoading, onSelectChallenge, onCreate, onCurrent }) {
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
        {isLoading && <p className="muted-state">Загружаю челленджи...</p>}
        {!isLoading && challenges.length === 0 && <p className="muted-state">Пока нет челленджей. Создай первый.</p>}
        {challenges.map((challenge) => (
          <ChallengeRow
            key={challenge.id}
            challenge={normalizeChallenge(challenge, activeChallengeId)}
            open={openId === challenge.id}
            onToggle={() => setOpenId(openId === challenge.id ? '' : challenge.id)}
            onSelect={() => onSelectChallenge(challenge.id)}
          />
        ))}
      </div>
    </section>
  )
}

function ChallengeRow({ challenge, open, onToggle, onSelect }) {
  return (
    <article className={`challenge-row ${challenge.active ? 'active' : ''} ${open ? 'open' : ''}`}>
      <div className="challenge-actions">
        <button type="button" aria-label="Редактировать челлендж">
          <EditIcon />
        </button>
        <button className="delete" type="button" aria-label="Удалить челлендж">
          <CloseIcon />
        </button>
      </div>
      <button className="challenge-card" type="button" onClick={open ? onSelect : onToggle}>
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

function AnalyticsScreen({ challenge }) {
  return (
    <section className="screen">
      <div className="hero-card">
        <p className="eyebrow">Аналитика</p>
        <h2>{challenge?.title || 'Нет челленджа'}</h2>
        <p>Аналитика обновляется по уже пройденным дням.</p>
      </div>

      <div className="metric-grid">
        <Metric value="13%" label="Общий прогресс" />
        <Metric value="73%" label="Средний день" />
        <Metric value="1" label="Дней на 100%" />
        <Metric value="0" label="Дней ниже 50%" />
      </div>

      <section className="surface">
        <h2 className="section-heading">Календарь</h2>
        <div className="day-grid">
          {analyticsDays.map((day) => (
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
    </section>
  )
}

function CreateChallengeScreen({ onSubmit, appError }) {
  const [simpleDraft, setSimpleDraft] = useState('')
  const [timeDraftTitle, setTimeDraftTitle] = useState('')
  const [timeDraftHours, setTimeDraftHours] = useState(1)
  const [simpleGoals, setSimpleGoals] = useState([])
  const [timeGoals, setTimeGoals] = useState([])
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

  function submit(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    if (simpleGoals.length + timeGoals.length === 0) {
      setLocalError('Добавь хотя бы одну цель.')
      return
    }

    onSubmit({
      title: String(formData.get('title') || '').trim(),
      durationDays: Number(formData.get('durationDays') || 30),
      simpleGoals,
      timeGoals,
    })
  }

  return (
    <section className="screen">
      <div className="hero-card">
        <p className="eyebrow">Новый старт</p>
        <h2>Создай челлендж.</h2>
        <p>Все цели получают одинаковый вес. Если целей десять, каждая закрытая цель добавляет 10% к дню.</p>
      </div>

      <form className="surface form" onSubmit={submit}>
        <label className="field">
          <span>Название челленджа</span>
          <input name="title" placeholder="Например: Майский рывок" required />
        </label>
        <label className="field">
          <span>Количество дней</span>
          <input name="durationDays" type="number" defaultValue={30} min={1} max={365} required />
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
          <DraftGoalList goals={simpleGoals} onRemove={removeSimpleGoal} />
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
          <DraftGoalList goals={timeGoals} onRemove={removeTimeGoal} withHours />
        </div>

        {(localError || appError) && <p className="form-error">{localError || appError}</p>}
        <button className="primary-button" type="submit">
          Начать челлендж
        </button>
      </form>
    </section>
  )
}

function DraftGoalList({ goals, onRemove, withHours = false }) {
  if (goals.length === 0) return null

  return (
    <div className="draft-goals">
      {goals.map((goal) => (
        <div key={goal.id}>
          <span>{goal.title}</span>
          {withHours && <small>{formatHours(goal.targetHours)}</small>}
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

function getTodayDate() {
  return new Date().toISOString().slice(0, 10)
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

export default App
