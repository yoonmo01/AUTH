import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { postLogin } from '../api/client'
import type { EmployeeProfile, AdminProfile } from '../flow'

type Props = {
  onLoginEmployee: (profile: EmployeeProfile) => void
  onLoginAdmin: (profile: AdminProfile) => void
}

export function LoginScreen({ onLoginEmployee, onLoginAdmin }: Props) {
  const [tab, setTab] = useState<'employee' | 'admin'>('employee')
  const [empId, setEmpId] = useState('')
  const [adminId, setAdminId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmployeeLogin(e: FormEvent) {
    e.preventDefault()
    if (!empId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await postLogin({ role: 'employee', id: empId.trim() })
      onLoginEmployee({
        employee_id: res.employee_id!,
        name: res.name,
        position: res.position!,
        department: res.department!,
      })
    } catch (err: unknown) {
      const msg = String(err)
      if (msg.includes('401')) {
        setError('사번이 올바르지 않습니다.')
      } else {
        setError('서버 연결 오류. 백엔드(:8000) 상태를 확인하세요.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleAdminLogin(e: FormEvent) {
    e.preventDefault()
    if (!adminId.trim() || !password) return
    setLoading(true)
    setError(null)
    try {
      const res = await postLogin({ role: 'admin', id: adminId.trim(), password })
      onLoginAdmin({ admin_id: res.admin_id!, name: res.name })
    } catch (err: unknown) {
      const msg = String(err)
      if (msg.includes('401')) {
        setError('관리자 ID 또는 비밀번호가 올바르지 않습니다.')
      } else {
        setError('서버 연결 오류. 백엔드(:8000) 상태를 확인하세요.')
      }
    } finally {
      setLoading(false)
    }
  }

  function onTabChange(next: 'employee' | 'admin') {
    setTab(next)
    setError(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>, submit: (ev: FormEvent) => void) {
    if (e.key === 'Enter') submit(e as unknown as FormEvent)
  }

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__brand">
          <span className="login__brand-name">◆ HYENA</span>
          &nbsp;&nbsp;AUDIT MANAGEMENT SYSTEM
        </div>
        <h1 className="login__title">정기 점검 시스템</h1>

        <div className="login__tabs">
          <button
            className={`login__tab${tab === 'employee' ? ' login__tab--active' : ''}`}
            onClick={() => onTabChange('employee')}
            type="button"
          >
            사원
          </button>
          <button
            className={`login__tab${tab === 'admin' ? ' login__tab--active' : ''}`}
            onClick={() => onTabChange('admin')}
            type="button"
          >
            관리자
          </button>
        </div>

        {tab === 'employee' && (
          <form onSubmit={handleEmployeeLogin}>
            <div className="login__field">
              <label className="login__label" htmlFor="emp-id">사번</label>
              <input
                id="emp-id"
                className="login__input"
                type="text"
                placeholder="EMP001"
                value={empId}
                onChange={(e) => setEmpId(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, handleEmployeeLogin)}
                autoFocus
                autoComplete="off"
              />
            </div>
            <button
              className="login__btn"
              type="submit"
              disabled={loading || !empId.trim()}
            >
              {loading ? '확인 중...' : '로그인'}
            </button>
          </form>
        )}

        {tab === 'admin' && (
          <form onSubmit={handleAdminLogin}>
            <div className="login__field">
              <label className="login__label" htmlFor="admin-id">관리자 ID</label>
              <input
                id="admin-id"
                className="login__input"
                type="text"
                placeholder="admin"
                value={adminId}
                onChange={(e) => setAdminId(e.target.value)}
                autoFocus
                autoComplete="off"
              />
            </div>
            <div className="login__field">
              <label className="login__label" htmlFor="admin-pw">비밀번호</label>
              <input
                id="admin-pw"
                className="login__input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, handleAdminLogin)}
                autoComplete="current-password"
              />
            </div>
            <button
              className="login__btn"
              type="submit"
              disabled={loading || !adminId.trim() || !password}
            >
              {loading ? '확인 중...' : '로그인'}
            </button>
          </form>
        )}

        {error && <p className="login__err">{error}</p>}
      </div>
    </div>
  )
}
