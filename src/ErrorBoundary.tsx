import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-wide error boundary. Without this, any render-time throw inside one of
 * the large dashboards unmounts the whole React tree and the user sees a blank
 * page. This catches it and shows a recoverable fallback instead.
 *
 * NOTE: `props` is `declare`d explicitly because this project ships no React
 * type definitions (no @types/react; noImplicitAny is off), so the inherited
 * `this.props` is not otherwise typed on a class component.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: {componentStack?: string}) {
    // No external logging backend (static client app) — surface to console
    // so it shows up in the user's devtools / browser error reporting.
    console.error('Unhandled render error:', error, info?.componentStack);
  }

  render() {
    const {error} = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--surface-2, #f8fafc)',
          color: 'var(--text-primary, #0f172a)',
        }}
      >
        <div
          style={{
            maxWidth: '440px',
            width: '100%',
            background: 'var(--surface, #ffffff)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
            borderRadius: '12px',
            padding: '28px',
            textAlign: 'center',
          }}
        >
          <h1 style={{fontSize: '18px', fontWeight: 600, margin: '0 0 8px'}}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-muted, #64748b)',
              margin: '0 0 20px',
              lineHeight: 1.5,
            }}
          >
            An unexpected error stopped this view from rendering. Reloading
            usually clears it. If it keeps happening, share the message below.
          </p>
          <pre
            style={{
              fontSize: '12px',
              textAlign: 'left',
              background: 'var(--surface-3, #f1f5f9)',
              color: 'var(--danger, #ef4444)',
              border: '1px solid var(--border, rgba(0,0,0,0.08))',
              borderRadius: '8px',
              padding: '12px',
              margin: '0 0 20px',
              overflow: 'auto',
              maxHeight: '160px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.message || String(error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--accent, #2563eb)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
