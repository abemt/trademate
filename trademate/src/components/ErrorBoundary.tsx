import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Last-resort crash guard — a blank app mid-session is not an option. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
          <img src="/icon.svg" alt="" className="h-14 w-14 rounded-2xl opacity-80" />
          <div>
            <p className="text-lg font-bold text-white">Something broke</p>
            <p className="mt-1 text-sm text-ink-300">
              Your data is safe on the server. Reload and carry on.
            </p>
            <p className="mt-2 max-w-sm break-all text-xs text-ink-400">
              {this.state.error.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-xl bg-gold-500 px-6 py-2.5 font-semibold text-ink-950 transition hover:bg-gold-400"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
