import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    user: {
      sub: string;
      email: string;
      name: string;
      orgId: string;
      role: string;
    };
  };
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient.post<LoginResponse>('/auth/login', {
        email: email.trim(),
        name: name.trim() || undefined,
      });

      const { token, user } = res.data;

      login(
        {
          id: user.sub,
          orgId: user.orgId,
          name: user.name,
          email: user.email,
          role: user.role as any,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        token,
      );

      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#f8fafc',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          textAlign: 'center',
          padding: '3rem',
          background: '#fff',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          maxWidth: '400px',
          width: '100%',
        }}
      >
        <img
          src="/procela-logo.png"
          alt="Procela"
          style={{ height: '48px', marginBottom: '1.5rem' }}
        />
        <p style={{ color: '#64748b', marginBottom: '2rem' }}>
          Sign in with your enterprise credentials
        </p>

        {error && (
          <div
            style={{
              color: '#dc2626',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '0.5rem 1rem',
              marginBottom: '1rem',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            marginBottom: '0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '1rem',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        <input
          type="text"
          placeholder="Full name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '1rem',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '0.75rem 1.5rem',
            background: loading ? '#6b7280' : '#1a7a6d',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: 500,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
