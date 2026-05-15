export default {
  fileSystem: {
    "/home/guest/readme.md": "# Welcome to __PROJECT_NAME__\n\nEdit src/apps/hello.js to add your first app.\n",
  },
  storage: { backend: "indexeddb", name: "__PROJECT_NAME__" },
  isolation: {
    preferOriginIsolated: true,
    allowDegraded: true,
  },
};
