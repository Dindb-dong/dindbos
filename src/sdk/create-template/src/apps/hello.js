export const helloApp = {
  id: "hello",
  name: "Hello",
  title: "Hello.app",
  icon: "app",
  pinned: true,
  width: 420,
  height: 300,
  render({ content, os }) {
    content.innerHTML = `
      <main class="dos-panel">
        <h1>Hello from ${os.session.product}</h1>
        <p>This app was registered by the host project.</p>
      </main>
    `;
  },
};
