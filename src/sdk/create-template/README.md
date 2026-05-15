# __PROJECT_NAME__

This project was generated with `create-dindbos`.

```bash
npm install
npm run dev
```

The app mounts DindbOS into `#app`, seeds `/home/guest/readme.md`, registers `Hello.app`, and installs the default Files and Terminal built-ins.

For origin-isolated deployment, serve these headers on every app route:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```
