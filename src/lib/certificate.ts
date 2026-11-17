import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { ROLE_LABEL, OUTCOME_LABEL } from "./jury";

export interface CertData { id: string; holder: string; role: string; caseTitle: string; outcome: string | null; issuedAt: string; }

export async function downloadCertificate(c: CertData) {
  const url = `${window.location.origin}/verify/${c.id}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 300 });
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  doc.setFillColor(250, 247, 240); doc.rect(0, 0, W, H, "F");
  doc.setDrawColor(190, 150, 70); doc.setLineWidth(3); doc.rect(24, 24, W - 48, H - 48);
  doc.setLineWidth(0.8); doc.rect(34, 34, W - 68, H - 68);
  doc.setTextColor(30, 40, 75); doc.setFont("times", "bold"); doc.setFontSize(34);
  doc.text("JusticeRoom", W / 2, 100, { align: "center" });
  doc.setFont("times", "normal"); doc.setFontSize(16);
  doc.text("Certificate of Victory", W / 2, 130, { align: "center" });
  doc.setFontSize(13); doc.text("This certifies that", W / 2, 185, { align: "center" });
  doc.setFont("times", "bold"); doc.setFontSize(28); doc.text(c.holder, W / 2, 225, { align: "center" });
  doc.setFont("times", "normal"); doc.setFontSize(13);
  doc.text(`appearing as ${ROLE_LABEL[c.role] ?? c.role}, has officially won the case`, W / 2, 260, { align: "center" });
  doc.setFont("times", "bold"); doc.setFontSize(18);
  doc.text(doc.splitTextToSize(`"${c.caseTitle}"`, W - 300), W / 2, 292, { align: "center" });
  doc.setFont("times", "normal"); doc.setFontSize(12);
  doc.text(`Verdict: ${OUTCOME_LABEL[c.outcome ?? ""] ?? "—"}   ·   Issued ${new Date(c.issuedAt).toLocaleDateString()}`, W / 2, 345, { align: "center" });
  doc.addImage(qr, "PNG", W - 190, H - 200, 120, 120);
  doc.setFontSize(9); doc.text("Scan to verify", W - 130, H - 70, { align: "center" });
  doc.text(`Certificate code: ${c.id}`, 70, H - 70);
  doc.save(`justiceroom-certificate-${c.id.slice(0, 8)}.pdf`);
}
