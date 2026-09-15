import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { setLogoutHandler } from './lib/api';
import Layout from './components/Layout/Layout.jsx';
import Dashboard     from './pages/Dashboard.jsx';
import Conversations from './pages/Conversations.jsx';
import Simulator     from './pages/Simulator.jsx';
import KnowledgeBase from './pages/KnowledgeBase.jsx';
import Config        from './pages/Config.jsx';
import Labels        from './pages/Labels.jsx';
import Profile       from './pages/Profile.jsx';
import Stats         from './pages/Stats.jsx';
import Login         from './pages/Login.jsx';
import QuickReplies  from './pages/QuickReplies.jsx';
import Templates     from './pages/Templates.jsx';
import Costs         from './pages/Costs.jsx';
import Areas         from './pages/Areas.jsx';
import Users         from './pages/Users.jsx';
import Proyectos     from './pages/Proyectos.jsx';
import Tickets       from './pages/Tickets.jsx';
import Customers     from './pages/Customers.jsx';
import Campaigns     from './pages/Campaigns.jsx';

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { agent, loading, logout } = useAuth();
  setLogoutHandler(logout);

  if (loading) return null;

  return (
    <Routes>
        <Route path="/login" element={agent ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/" element={agent ? <Layout /> : <Navigate to="/login" replace />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"     element={<Dashboard />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="customers"     element={<Customers />} />
          <Route path="campaigns"     element={<Campaigns />} />
          <Route path="simulator"     element={<Simulator />} />
          <Route path="knowledge"     element={<KnowledgeBase />} />
          <Route path="config"        element={<Config />} />
          <Route path="labels"        element={<Labels />} />
          <Route path="profile"       element={<Profile />} />
          <Route path="stats"         element={<Stats />} />
          <Route path="quick-replies" element={<QuickReplies />} />
          <Route path="templates"     element={<Templates />} />
          <Route path="costs"         element={<Costs />} />
          <Route path="areas"         element={<Areas />} />
          <Route path="users"         element={<Users />} />
          <Route path="proyectos"     element={<Proyectos />} />
          <Route path="tickets"       element={<Tickets />} />
        </Route>
      </Routes>
  );
}
