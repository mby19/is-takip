import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "../components/ui/card";

describe("Card", () => {
  it("renders with text content", () => {
    render(<Card>İçerik</Card>);
    const card = screen.getByText("İçerik");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("data-slot", "card");
  });

  it("renders with title inside header", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Başlık</CardTitle>
        </CardHeader>
      </Card>,
    );
    expect(screen.getByText("Başlık")).toBeInTheDocument();
    expect(screen.getByText("Başlık")).toHaveAttribute("data-slot", "card-title");
  });

  it("renders content and footer", () => {
    render(
      <Card>
        <CardContent>Gövde</CardContent>
        <CardFooter>Alt</CardFooter>
      </Card>,
    );
    expect(screen.getByText("Gövde")).toHaveAttribute("data-slot", "card-content");
    expect(screen.getByText("Alt")).toHaveAttribute("data-slot", "card-footer");
  });
});
