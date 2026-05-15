"use client";

import dynamic from "next/dynamic";

const DindbOSDesktop = dynamic(
  () => import("dindbos/react").then((mod) => mod.DindbOSDesktop),
  { ssr: false },
);

export default function WebOSPage() {
  return (
    <DindbOSDesktop
      fileSystem={{ "/home/guest/readme.md": "# DindbOS in Next.js\n" }}
      builtins={{ includePortfolio: false }}
      launch={["files", "terminal"]}
    />
  );
}
