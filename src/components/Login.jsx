import React from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  FileSpreadsheet, 
  LogIn, 
  User, 
  GraduationCap, 
  Settings 
} from 'lucide-react';

export default function Login() {
  const { loginWithGoogle, authError, clearError } = useAuth();

  return (
    <div className="login-container">
      <div className="login-card glass animate-fade-in">
        <div className="login-logo">
          <FileSpreadsheet size={36} />
        </div>

        {authError && (
          <div 
            style={{ 
              background: 'rgba(248, 113, 113, 0.12)', 
              border: '1px solid rgba(248, 113, 113, 0.3)',
              borderRadius: '10px',
              padding: '12px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px'
            }}
          >
            <span style={{ color: '#f87171', fontSize: '13px', lineHeight: '1.4' }}>
              {authError}
            </span>
            <button 
              onClick={clearError}
              style={{ 
                background: 'none', 
                border: 'none', 
                color: '#f87171', 
                cursor: 'pointer',
                fontSize: '18px',
                lineHeight: 1,
                padding: '0 2px',
                flexShrink: 0
              }}
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}

        <h1 className="login-title">Online Assignment Submission</h1>
        <p className="login-desc">
          Access classrooms, submit assignments, and collaborate in real-time. Direct cloud integration powered by Google OAuth.
        </p>

        <button 
          className="btn btn-primary" 
          onClick={loginWithGoogle}
          style={{ width: '100%', padding: '14px', fontSize: '15px' }}
        >
          <LogIn size={18} />
          <span>Sign In with Google</span>
        </button>
      </div>
    </div>
  );
}
