import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('UI crashed:', error)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            background: '#0d1117',
            color: '#dbe2ee',
            fontFamily: 'Segoe UI, sans-serif'
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 700, opacity: 0.9 }}>OX</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: '#8b949e', maxWidth: 480, textAlign: 'center', lineHeight: 1.6, fontFamily: 'monospace' }}>
            {this.state.error.message}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #30363d', background: '#21262d', color: '#dbe2ee', cursor: 'pointer' }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #30363d', background: '#1f6feb', color: '#fff', cursor: 'pointer' }}
            >
              Reload app
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
