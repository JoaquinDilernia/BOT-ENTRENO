import { createContext, useContext, useEffect, useState } from 'react';
import { BASE_URL } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [agent, setAgent] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('bot_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    fetch(BASE_URL + '/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setAgent(data.agent))
      .catch(() => {
        localStorage.removeItem('bot_token');
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function login(email, password) {
    const r = await fetch(BASE_URL + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.error ?? 'Error al ingresar');
    }
    const data = await r.json();
    localStorage.setItem('bot_token', data.token);
    setToken(data.token);
    setAgent(data.agent);
  }

  function logout() {
    localStorage.removeItem('bot_token');
    setToken(null);
    setAgent(null);
  }

  function updateAgent(newAgent, newToken) {
    localStorage.setItem('bot_token', newToken);
    setToken(newToken);
    setAgent(newAgent);
  }

  return (
    <AuthContext.Provider value={{ agent, token, login, logout, updateAgent, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
