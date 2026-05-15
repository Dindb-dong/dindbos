import { DindbOSDesktop } from "dindbos/react";
import "dindbos/styles.css";

export default function App() {
  return (
    <DindbOSDesktop
      fileSystem={{ "/home/guest/readme.md": "# DindbOS in React\n" }}
      builtins={{ includePortfolio: false }}
      launch={["files", "terminal"]}
    />
  );
}
