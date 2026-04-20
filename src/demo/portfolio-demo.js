export const portfolioData = {
  name: "Kim Dong Wook Portfolio",
  summary: "A portfolio mounted as apps, files, and documents inside DindbOS.js.",
  projects: [
    {
      name: "Remote Browser",
      type: "System App",
      description: "A browser engine bridge for opening real URLs from inside the desktop runtime.",
    },
    {
      name: "AI Presentations",
      type: "Documents",
      description: "Research decks and project writeups opened through file associations.",
    },
    {
      name: "Portfolio Runtime",
      type: "DindbOS Demo",
      description: "A portfolio experience that demonstrates the OS instead of only imitating one.",
    },
  ],
};

export const demoFileSystem = {
  name: "",
  type: "directory",
  children: [
    {
      name: "Desktop",
      type: "directory",
      children: [
        { name: "Portfolio.app", type: "app", appId: "portfolio", icon: "portfolio" },
        { name: "Files.app", type: "app", appId: "files", icon: "folder" },
        { name: "Terminal.app", type: "app", appId: "terminal", icon: "terminal" },
        { name: "Calculator.app", type: "app", appId: "calculator", icon: "calculator" },
        { name: "Settings.app", type: "app", appId: "settings", icon: "settings" },
        { name: "Projects", type: "link", target: "/Projects", icon: "folder" },
        { name: "Presentations", type: "link", target: "/Presentations", icon: "folder" },
        { name: "README.md", type: "link", target: "/README.md", icon: "text" },
      ],
    },
    {
      name: "Projects",
      type: "directory",
      children: [
        {
          name: "remote-browser.md",
          type: "file",
          mime: "text/markdown",
          icon: "text",
          content: "# Remote Browser\n\nA browser engine adapter for opening real websites inside DindbOS.js.",
        },
        {
          name: "portfolio-runtime.md",
          type: "file",
          mime: "text/markdown",
          icon: "text",
          content: "# Portfolio Runtime\n\nThe demo portfolio is a mounted workspace inside DindbOS.js.",
        },
      ],
    },
    {
      name: "Presentations",
      type: "directory",
      children: [
        {
          name: "clip-blip2-retrieval.html",
          type: "file",
          mime: "text/markdown",
          icon: "text",
          content: "# CLIP + BLIP2 Retrieval\n\nHTML deck mounting will be wired into the Browser.app adapter.",
        },
      ],
    },
    {
      name: "README.md",
      type: "file",
      mime: "text/markdown",
      icon: "text",
      content: "# DindbOS.js\n\nThis desktop is generated from a virtual file system and app registry.",
    },
  ],
};
