import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Attendance from './pages/Attendance'
import MyAttendance from './pages/MyAttendance'
import Billing from './pages/Billing'
import Layout from './components/Layout'
import Advance from './pages/Advance'
import CloseDay from './pages/CloseDay'
import Expense from './pages/Expense'
import Client from './pages/Client'
import Clients from './pages/Clients'
import Home from './pages/Home'
import More from './pages/More'
import NewVisit from './pages/NewVisit'
import ServicesAdmin from './pages/ServicesAdmin'
import VisitDetail from './pages/VisitDetail'
import Visits from './pages/Visits'
import Login from './pages/Login'
import Pending from './pages/Pending'
import Privacy from './pages/Privacy'
import Salons from './pages/Salons'
import Settings from './pages/Settings'
import StaffPage from './pages/Staff'

function ManagerOnly({ children }: { children: ReactNode }) {
  const { isManager } = useAuth()
  return isManager ? children : <Navigate to="/" replace />
}

export default function App() {
  const { loading, session, staff } = useAuth()
  if (window.location.pathname === '/privacy') return <Privacy />
  if (loading) return <div className="p-6 text-center text-gray-500">Loading…</div>
  if (!session) return <Login />
  if (!staff || staff.status !== 'active') return <Pending />
  return (
    <Layout>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/visits" element={<Visits />} />
      <Route path="/visit/new" element={<NewVisit />} />
      <Route path="/visit/:id" element={<VisitDetail />} />
      <Route path="/visit/:id/bill" element={<Billing />} />
      <Route path="/client/:id" element={<Client />} />
      <Route path="/clients" element={<Clients />} />
      <Route path="/expense" element={<Expense />} />
      <Route path="/advance" element={<Advance />} />
      <Route path="/close-day" element={<CloseDay />} />
      <Route path="/attendance/me" element={<MyAttendance />} />
      <Route path="/attendance" element={<ManagerOnly><Attendance /></ManagerOnly>} />
      <Route path="/more" element={<More />} />
      <Route path="/services" element={<ManagerOnly><ServicesAdmin /></ManagerOnly>} />
      <Route path="/staff" element={<ManagerOnly><StaffPage /></ManagerOnly>} />
      <Route path="/salons" element={<ManagerOnly><Salons /></ManagerOnly>} />
      <Route path="/settings" element={<ManagerOnly><Settings /></ManagerOnly>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Layout>
  )
}
