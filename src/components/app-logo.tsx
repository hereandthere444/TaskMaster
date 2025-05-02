import { cn } from "@/lib/utils";
import * as React from "react";

// Simple Checkmark logo for TaskMaster
export function AppLogo({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("text-primary", className)} // Use primary color from theme
      {...props}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
