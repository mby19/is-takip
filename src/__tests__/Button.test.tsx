import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "../components/ui/button";

describe("Button", () => {
  it("renders with text content", () => {
    render(<Button>Kaydet</Button>);
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeInTheDocument();
  });

  it("handles click events", () => {
    let clicked = false;
    render(<Button onClick={() => (clicked = true)}>Tıkla</Button>);
    screen.getByRole("button").click();
    expect(clicked).toBe(true);
  });

  it("can be disabled", () => {
    render(<Button disabled>Devre Dışı</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
