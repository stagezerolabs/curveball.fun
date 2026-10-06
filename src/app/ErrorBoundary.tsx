import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Curveball recovered from an unexpected UI error", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app-recovery wrap" role="alert">
          <span className="empty-orbit" aria-hidden="true" />
          <h1>Something went wrong</h1>
          <p>Your wallet and transaction are unaffected. Reload the latest on-chain state to continue.</p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            Reload Curveball
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
