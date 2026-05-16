import { useMemo, useState } from 'react'
import './App.css'

const simpleSeed = [
  { id: 'simple-1', title: 'Правильно питаюсь', done: true },
  { id: 'simple-2', title: 'Спорт', done: true },
  { id: 'simple-3', title: 'Ложусь до 00:00', done: true },
  { id: 'simple-4', title: 'Движение', done: false },
  { id: 'simple-5', title: 'Занимаюсь здоровьем', done: true },
]

const timeSeed = [
  { id: 'time-1', title: 'Wedding Elements', target: 10, actual: 10 },
  { id: 'time-2', title: 'Evstignev', target: 4, actual: 4 },
]

const challengeSeed = [
  {
    id: 'challenge-1',
    title: 'Майский рывок',
    day: 4,
    days: 30,
    goals: 7,
    startDate: '12.05.2026',
    active: true,
  },
  {
    id: 'challenge-2',
    title: 'Ruru',
    day: 1,
    days: 5,
    goals: 5,
    startDate: '15.05.2026',
    active: false,
  },
  {
    id: 'challenge-3',
    title: 'Test',
    day: 1,
    days: 10,
    goals: 6,
    startDate: '15.05.2026',
    active: false,
  },
]

const analyticsDays = Array.from({ length: 30 }, (_, index) => {
  const day = index + 1
  const percent = day === 1 ? 100 : day === 2 ? 85 : day === 3 ? 55 : day === 4 ? 50 : 0
  return { day, percent, future: day > 4 }
})

function App() {
  const [isAuthed, setIsAuthed] = useState(true)
  const [screen, setScreen] = useState('today')
  const [simpleGoals, setSimpleGoals] = useState(simpleSeed)
  const [timeGoals, setTimeGoals] = useState(timeSeed)
  const [authMode, setAuthMode] = useState('login')

  const progress = useMemo(() => {
    const simpleDone = simpleGoals.filter((goal) => goal.done).length
    const timeDone = timeGoals.filter((goal) => goal.actual >= goal.target).length
    const total = simpleGoals.length + timeGoals.length
    const done = simpleDone + timeDone
    return {
      done,
      total,
      todayPercent: total ? Math.round((done / total) * 100) : 0,
      overallPercent: 13,
    }
  }, [simpleGoals, timeGoals])

  function navigate(nextScreen) {
    setScreen(nextScreen)
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  }

  function login(event) {
    event.preventDefault()
    setIsAuthed(true)
    navigate('today')
  }

  function logout() {
    setIsAuthed(false)
    setAuthMode('login')
    navigate('auth')
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

  if (!isAuthed) {
    return (
      <AppShell
        caption="Личный трекер прогресса"
        showMenu={false}
        screen={screen}
        navigate={navigate}
        logout={logout}
      >
        <AuthScreen authMode={authMode} setAuthMode={setAuthMode} onSubmit={login} />
      </AppShell>
    )
  }

  return (
    <AppShell
      caption="ruslan-hamzin@mail.ru"
      showMenu
      screen={screen}
      navigate={navigate}
      logout={logout}
    >
      {screen === 'today' && (
        <TodayScreen
          progress={progress}
          simpleGoals={simpleGoals}
          timeGoals={timeGoals}
          onToggleSimple={toggleSimpleGoal}
          onSetTime={setTimeGoal}
        />
      )}
      {screen === 'challenges' && <ChallengesScreen />}
      {screen === 'analytics' && <AnalyticsScreen />}
      {screen === 'create' && <CreateChallengeScreen />}
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

function AuthScreen({ authMode, setAuthMode, onSubmit }) {
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
          <input type="email" autoComplete="email" />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        <button className="primary-button" type="submit">
          {authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
        </button>
      </form>
    </section>
  )
}

function TodayScreen({ progress, simpleGoals, timeGoals, onToggleSimple, onSetTime }) {
  return (
    <section className="screen">
      <ProgressCard progress={progress} />

      <GoalSection title="Простые цели">
        {simpleGoals.map((goal) => (
          <SimpleGoalRow key={goal.id} goal={goal} onToggle={() => onToggleSimple(goal.id)} />
        ))}
      </GoalSection>

      <GoalSection title="Цели по часам">
        {timeGoals.map((goal) => (
          <TimeGoalRow key={goal.id} goal={goal} onChange={(value) => onSetTime(goal.id, value)} />
        ))}
      </GoalSection>
    </section>
  )
}

function ProgressCard({ progress }) {
  return (
    <section className="progress-card">
      <div className="progress-head">
        <div>
          <h2>Майский рывок</h2>
          <p>День 4 из 30</p>
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

function ChallengesScreen() {
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
          <button type="button">Создать новый</button>
          <button type="button">Текущий</button>
        </div>
      </div>

      <div className="challenge-list">
        {challengeSeed.map((challenge) => (
          <ChallengeRow
            key={challenge.id}
            challenge={challenge}
            open={openId === challenge.id}
            onToggle={() => setOpenId(openId === challenge.id ? '' : challenge.id)}
          />
        ))}
      </div>
    </section>
  )
}

function ChallengeRow({ challenge, open, onToggle }) {
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
      <button className="challenge-card" type="button" onClick={onToggle}>
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

function AnalyticsScreen() {
  return (
    <section className="screen">
      <div className="hero-card">
        <p className="eyebrow">Аналитика</p>
        <h2>Майский рывок</h2>
        <p>День 4 из 30. Аналитика обновляется по уже пройденным дням.</p>
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

function CreateChallengeScreen() {
  return (
    <section className="screen">
      <div className="hero-card">
        <p className="eyebrow">Новый старт</p>
        <h2>Создай челлендж.</h2>
        <p>Все цели получают одинаковый вес. Если целей десять, каждая закрытая цель добавляет 10% к дню.</p>
      </div>

      <form className="surface form">
        <label className="field">
          <span>Название челленджа</span>
          <input placeholder="Например: Майский рывок" />
        </label>
        <label className="field">
          <span>Количество дней</span>
          <input type="number" defaultValue={30} min={1} max={365} />
        </label>
        <button className="primary-button" type="button">
          Начать челлендж
        </button>
      </form>
    </section>
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
