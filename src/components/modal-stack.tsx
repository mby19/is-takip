import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Radix `Dialog` ve `Sheet` içerikleri `role="dialog"` (alert dialog'larda
 * `role="alertdialog"`) ile basılır ve yalnızca açıkken DOM'a mount edilir.
 * Sayaç bu tek gerçeklikten türetilir: `ui/dialog.tsx` / `ui/sheet.tsx`
 * sarmalayıcılarına dokunmadan, uygulamadaki HER modal (başka ekranların
 * açtığı dialoglar dahil) otomatik sayılır.
 */
const MODAL_SELECTOR = '[role="dialog"],[role="alertdialog"]';

const countOpenModals = (doc: Document = document): number =>
  doc.querySelectorAll(MODAL_SELECTOR).length;

interface ModalStackValue {
  /** Ekranda açık bulunan modal sayısı. */
  openCount: number;
  hasOpenModal: boolean;
}

const FALLBACK: ModalStackValue = { openCount: 0, hasOpenModal: false };

const ModalStackContext = createContext<ModalStackValue>(FALLBACK);

export function ModalStackProvider({ children }: { children: ReactNode }) {
  const [openCount, setOpenCount] = useState(() => countOpenModals());

  useEffect(() => {
    const recount = () => setOpenCount(countOpenModals());
    const observer = new MutationObserver(recount);
    // Portal'lar body'ye mount edilir; alt ağaç + çocuk listesi yeterli.
    observer.observe(document.body, { childList: true, subtree: true });
    recount();
    return () => observer.disconnect();
  }, []);

  const value = useMemo<ModalStackValue>(
    () => ({ openCount, hasOpenModal: openCount > 0 }),
    [openCount],
  );

  return <ModalStackContext.Provider value={value}>{children}</ModalStackContext.Provider>;
}

export const useModalStack = (): ModalStackValue => useContext(ModalStackContext);

/**
 * Global geri işleyicisi (klavye).
 *
 * Escape üç koşulda uygulamanın geri navigasyonuna DEVREDİLMEZ:
 *   1. Modal açıkken — modal kendi Escape'ini yönetir (Radix en üst
 *      DismissableLayer'da yakalar ve `preventDefault` yapar).
 *   2. `defaultPrevented` — bir katman Escape'i tükettiyse bileşik bir
 *      şey almış demektir.
 *   3. `blocked` — uygulama kilitliyken ekran değiştirilmez.
 *
 * Değerler ref'te tutulur: olay dinleyicisi her render'da yeniden
 * kurulmaz, ama güncel değeri görür.
 */
export function useGlobalBack(onBack: () => void, blocked = false) {
  const { hasOpenModal } = useModalStack();

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const modalRef = useRef(hasOpenModal);
  modalRef.current = hasOpenModal;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (blockedRef.current) return;
      if (event.defaultPrevented) return;
      if (modalRef.current) return;
      event.preventDefault();
      onBackRef.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
