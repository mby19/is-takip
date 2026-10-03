import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ModalStackProvider, useGlobalBack, useModalStack } from "../components/modal-stack";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../components/ui/dialog";

afterEach(cleanup);

const pressEscape = () =>
  act(() => {
    fireEvent.keyDown(document.body, { key: "Escape" });
  });

/** Uygulamanın geri davranışının yerine geçen test çifti. */
function Harness({ onBack, blocked = false }: { onBack: () => void; blocked?: boolean }) {
  const { hasOpenModal } = useModalStack();
  useGlobalBack(onBack, blocked);
  return <span data-testid="modal-state">{hasOpenModal ? "acik" : "kapali"}</span>;
}

const renderHarness = () => {
  const onBack = vi.fn();
  render(
    <ModalStackProvider>
      <Harness onBack={onBack} />
      <Dialog>
        <DialogTrigger>Aç</DialogTrigger>
        <DialogContent>
          <DialogTitle>Test Dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    </ModalStackProvider>,
  );
  return onBack;
};

const openDialog = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Aç" }));
  });
};

const modalState = () => screen.getByTestId("modal-state").textContent;

describe("ModalStackProvider + useGlobalBack", () => {
  it("modal yokken Escape geri çağırır", () => {
    const onBack = renderHarness();
    expect(modalState()).toBe("kapali");

    pressEscape();

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("modal açıkken Escape geri çağırmaz", async () => {
    const onBack = renderHarness();
    await openDialog();
    expect(modalState()).toBe("acik");

    pressEscape();

    expect(onBack).not.toHaveBeenCalled();
  });

  it("modal kapanınca sayaç sıfırlanır ve geri yeniden çalışır", async () => {
    const onBack = renderHarness();
    await openDialog();
    pressEscape();
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(modalState()).toBe("kapali");

    pressEscape();

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("blocked=true iken Escape geri çağırmaz (kilitli ekran)", () => {
    const onBack = vi.fn();
    render(
      <ModalStackProvider>
        <Harness onBack={onBack} blocked />
      </ModalStackProvider>,
    );

    pressEscape();

    expect(onBack).not.toHaveBeenCalled();
  });

  it("katman Escape'i tüketip preventDefault yaptıysa geri çağrılmaz", () => {
    const onBack = renderHarness();

    // Radix `useEscapeKeydown`'ın yaptığı gibi: document üzerinde capture
    // aşamasında dinle, Escape'i preventDefault ile tüket.
    const consumeEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    document.addEventListener("keydown", consumeEscape, true);
    try {
      pressEscape();
    } finally {
      document.removeEventListener("keydown", consumeEscape, true);
    }

    expect(onBack).not.toHaveBeenCalled();
  });

  it("Escape dışındaki tuşlar geri çağırmaz", () => {
    const onBack = renderHarness();

    act(() => {
      fireEvent.keyDown(document.body, { key: "Enter" });
    });

    expect(onBack).not.toHaveBeenCalled();
  });
});
