import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-background p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-rose-500" />
          </div>
          <h2 className="text-lg font-black tracking-tight">Beklenmeyen Bir Hata Oluştu</h2>
          <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
            Uygulama beklenmeyen bir hata ile karşılaştı. Lütfen sayfayı yenileyin.
          </p>
          {this.state.error && (
            <p className="text-[10px] font-mono text-muted-foreground/40 max-w-full truncate px-4">
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.handleReload}
            className="h-12 px-8 rounded-xl bg-primary text-primary-foreground font-black text-sm shadow-lg shadow-primary/20 active:scale-95 transition-all flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Uygulamayı Yeniden Başlat
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
