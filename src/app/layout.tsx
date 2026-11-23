import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mako — Hyperliquid Trading Intelligence",
  description:
    "Positioning intelligence for Hyperliquid perp traders. See where capital moves before price does.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/sign-in"
      appearance={{
        variables: {
          colorPrimary: "#EDEDEF",
          colorPrimaryForeground: "#070709",
          colorBackground: "#0B0B0E",
          colorForeground: "#EDEDEF",
          colorMutedForeground: "#9B9BA0",
          colorInput: "#0F0F13",
          colorInputForeground: "#EDEDEF",
          colorNeutral: "#EDEDEF",
          colorDanger: "#F05A5A",
          fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          borderRadius: "10px",
        },
      }}
    >
      <html lang="en" className="dark">
        <body className="antialiased">
          <Providers>{children}</Providers>
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
