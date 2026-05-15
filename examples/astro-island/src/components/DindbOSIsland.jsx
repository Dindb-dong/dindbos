import { DindbOSDesktop } from "dindbos/react";
import "dindbos/styles.css";

export default function DindbOSIsland() {
  return (
    <DindbOSDesktop
      fileSystem={{ "/home/guest/readme.md": "# DindbOS in Astro\n" }}
      builtins={{ includePortfolio: false }}
      launch={["files", "terminal"]}
    />
  );
}
