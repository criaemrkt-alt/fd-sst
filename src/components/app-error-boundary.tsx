import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FD SST render error', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return <main className="setup-page"><section className="setup-card"><div className="brand-mark">FD</div><h1>Não foi possível abrir o sistema</h1><p>O aplicativo encontrou uma atualização incompleta. Toque abaixo para carregar a versão atual.</p><button className="button" onClick={() => window.location.reload()}>Recarregar aplicativo</button></section></main>
    }

    return this.props.children
  }
}
