import { defineApp } from "dindbos";

export const helloApp = defineApp({
  id: "hello", name: "Hello", title: "Hello", icon: "app", pinned: true, desktop: true,
  width: 480, height: 320,
  render({ content, window }) {
    const main = document.createElement("main");
    main.className = "starter-app";
    const heading = document.createElement("h1");
    heading.textContent = "Your first desktop app";
    const detail = document.createElement("p");
    detail.textContent = "Edit src/apps/hello.js. Change the desktop in dindbos.config.js.";
    const button = document.createElement("button");
    button.textContent = "Close window";
    button.onclick = () => window.close();
    main.append(heading, detail, button);
    content.replaceChildren(main);
    return () => { button.onclick = null; };
  },
});
