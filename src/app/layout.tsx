import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hilê Audit Console",
  description: "Auditoria inteligente de atendimento com Chatwoot e Dify",
  icons: {
    icon: "/faviconV2.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
