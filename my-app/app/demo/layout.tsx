import { ReactNode } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";

export const metadata = {
  title: "Nexagrid Platform Demos",
  description: "Capability showcase for the Nexagrid multi tenant platform",
};

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
          <Link href="/demo" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <span className="text-sm font-medium text-foreground">Nexagrid Platform</span>
            <span className="text-xs text-muted-foreground border border-border rounded-md px-2 py-0.5 ml-1">
              Demo showcase
            </span>
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
