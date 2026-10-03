import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Copy, Check } from "lucide-react";
import { APP_VERSION } from "../lib/appInfo";

interface Props {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Panoya kopyalandı mı — düğmenin "Kopyalandı" durumu. */
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, copied: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  /**
   * `hasError` sıfırlanıp tam yeniden yükleme yapılır. Yalnızca state
   * sıfırlamak yetmez: hata render sırasında oluştuğu için aynı props'lu
   * alt ağaç yeniden mount edilince hata yeniden üretilir.
   */

  /**
   * Hata bildirimini panoya kopyalar.
   *
   * Sentry kurulu değilse hata hiçbir yere düşmez; `console.error` üretimde
   * kullanıcının erişemediği bir yerdir. O durumda kullanıcının yapabileceği
   * tek şey ekranda gördüğünü teknik destek kanalına yapıştırmaktır — ve
   * ekranda gördüğü yalnızca "bir şey oldu" değil, **hangi sürümde** ve
   **hangi hatayla** olduğudur. Kopyalanan metin bu ikisini de içerir.
   *
   * `navigator.clipboard` güvenli olmayan bağlamda yoktur; bu yüzden hata
   * yutulmaz, kullanıcıya "kopyalanamadı" durumu bildirilir.
   */
  handleCopyReport = async () => {
    const error = this.state.error;
    const report = [
      "İş Takip hata bildirimi",
      `Sürüm: ${APP_VERSION}`,
      `Zaman: ${new Date().toLocaleString("tr-TR")}`,
      `Platform: ${navigator.userAgent}`,
      error ? `Hata: ${error.name}: ${error.message}` : "Hata: bilinmiyor",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(report);
      this.setState({ copied: true });
    } catch {
      // Kopyalama başarısız: kullanıcı metni elle seçebilsin diye ekranda
      // gösteriyoruz, sessizce yutmuyoruz.
      this.setState({ copied: false });
    }
  };

  /** Kopyalanamayınca elle seçilebilir metin. */
  reportText() {
    const error = this.state.error;
    return [
      `Sürüm: ${APP_VERSION}`,
      `Zaman: ${new Date().toLocaleString("tr-TR")}`,
      `Platform: ${navigator.userAgent}`,
      error ? `Hata: ${error.name}: ${error.message}` : "Hata: bilinmiyor",
    ].join("\n");
  }
  /** Ekranı yeniler; kopyalandı durumu eski hatanın bilgisini taşır. */
  handleReload = () => {
    this.setState({ hasError: false, error: null, copied: false });
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
            Uygulama beklenmeyen bir hatayla karşılaştı ve bu ekranın yenilenmesi gerekiyor.
            Verileriniz cihazınızda saklanıyor, silinmedi.
          </p>
          {this.state.error && (
            <p className="text-[10px] font-mono text-muted-foreground/40 max-w-full truncate px-4">
              {this.state.error.message}
            </p>
          )}
          {/* Hata bildirimi metni aynı zamanda ekranda görünür durumda kalır:
              hem kopyalama başarısız olduğunda elle seçilebilir bir yedek
              olur, hem de sürüm bilgisi ayrı bir satır olarak tekrarlanmaz.
              Sürümü burada ayrıca göstermenin anlamı yok — metin zaten
              `Sürüm: …` satırını içeriyor. */}
          <button
            onClick={this.handleReload}
            className="h-12 px-8 rounded-xl bg-primary text-primary-foreground font-black text-sm shadow-lg shadow-primary/20 active:scale-95 transition-all flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Uygulamayı Yeniden Başlat
          </button>
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => void this.handleCopyReport()}
              className="text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5 px-3 py-1.5"
            >
              {this.state.copied ? (
                <Check className="w-3.5 h-3.5 text-ok" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {this.state.copied ? "Panoya kopyalandı" : "Hata bilgisini panoya kopyala"}
            </button>
            {/*
              Kopyalama çalışmazsa (güvensiz bağlam) metin burada kalıcıdır ve
              elle seçilebilir. `whitespace-pre-wrap` olmadan satırlar
              birleşir ve kopyalanan bilgi okunamaz hale gelir.
            */}
            <pre className="text-[10px] font-mono text-muted-foreground/50 max-w-full text-left whitespace-pre-wrap break-all px-4 select-all">
              {this.reportText()}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
