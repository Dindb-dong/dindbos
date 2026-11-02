import React from "react";
import { createRoot } from "react-dom/client";
import { DindbOSDesktop, DindbOSApp } from "dindbos/react";
import "dindbos/styles.css";
import "./host.css";
import { apps } from "./apps/index.js";
import config from "../dindbos.config.js";

createRoot(document.getElementById("app")).render(
  <React.StrictMode>
    <DindbOSDesktop {...config} style={{ height: "100%" }} launch={["hello"]}>
      {apps.map(({ Component, ...app }) => <DindbOSApp key={app.id} {...app} pinned desktop><Component /></DindbOSApp>)}
    </DindbOSDesktop>
  </React.StrictMode>,
);
