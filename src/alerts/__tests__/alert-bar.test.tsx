import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertBar } from "../alert-bar";
import type { AlertStatus } from "../evaluate";

const fired: AlertStatus = { id: "1", text: "Impostos por mês acima de R$ 20.000", triggered: true, currentText: "R$ 42.800" };
const quiet: AlertStatus = { id: "2", text: "Carga tributária acima de 15,0%", triggered: false, currentText: "12,2%" };

describe("AlertBar", () => {
  it("renders nothing without alerts", () => {
    const { container } = render(<AlertBar alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a banner with the current value and a bell count for triggered alerts only", () => {
    render(<AlertBar alerts={[fired, quiet]} />);
    const banners = screen.getAllByTestId("alert-banner");
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent("Impostos por mês acima de R$ 20.000");
    expect(banners[0]).toHaveTextContent("agora R$ 42.800");
    expect(screen.getByLabelText("1 alerta disparado")).toBeInTheDocument();
  });

  it("lists every configured alert, flagging which fired", () => {
    render(<AlertBar alerts={[fired, quiet]} />);
    const list = screen.getByRole("list", { name: "Meus alertas" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText(/disparado/i)).toBeInTheDocument();
    expect(within(list).getByText(/em observação/i)).toBeInTheDocument();
  });

  it("shows no banner and a zero bell when nothing fired", () => {
    render(<AlertBar alerts={[quiet]} />);
    expect(screen.queryByTestId("alert-banner")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nenhum alerta disparado")).toBeInTheDocument();
  });

  it("pluralises the bell label", () => {
    render(<AlertBar alerts={[fired, { ...fired, id: "3" }]} />);
    expect(screen.getByLabelText("2 alertas disparados")).toBeInTheDocument();
  });
});
