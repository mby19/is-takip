import "jspdf";

declare module "jspdf" {
  interface jsPDF {
    autoTable: (options: Record<string, unknown>) => void;
    lastAutoTable: { finalY: number };
  }
}
