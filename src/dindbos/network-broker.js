const NET_LOG_PATH = "/var/log/dindbos/network.log";

export class NetworkBroker {
  constructor(os, options = {}) {
    this.os = os;
    this.fetchAdapter = options.fetch || null;
    this.webSocketAdapter = options.webSocket || null;
    this.rtcPeerConnectionAdapter = options.rtcPeerConnection || null;
    this.rawSocketCompanion = options.rawSocketCompanion || null;
    this.requests = new Map();
    this.pendingRequests = new Map();
    this.webSocketSessions = new Map();
    this.webSocketHistory = [];
    this.dataChannelSessions = new Map();
    this.dataChannelHistory = [];
    this.rawSocketSessions = new Map();
    this.rawSocketHistory = [];
    this.loopbackServices = new Map();
    this.firewallEvents = [];
    this.history = [];
    this.deniedHosts = [];
    this.nextRequestId = 1;
    this.bytesReceived = 0;
    this.bytesSent = 0;
  }

  beginRequest(id, context, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const record = { ownerPid: Number(context.process?.pid || 0), controller };
    this.pendingRequests.set(id, record);
    return {
      signal: controller.signal,
      release: () => { signal?.removeEventListener("abort", abort); this.pendingRequests.delete(id); },
    };
  }

  cleanupOwner(pid, reason = "process-exit") {
    const ownerPid = Number(pid);
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) return;
    // Internal teardown deliberately does not require the soon-to-be-revoked app handle.
    for (const request of this.pendingRequests.values()) if (request.ownerPid === ownerPid) request.controller.abort(reason);
    for (const [id, session] of this.webSocketSessions) if (session.record.ownerPid === ownerPid) {
      try { session.socket.close?.(1000, "Process exited"); }
      catch (error) { session.record.closeError = error.message || String(error); }
      finally { this.finishWebSocket(id, 1000, reason); }
    }
    for (const [id, session] of this.dataChannelSessions) if (session.record.ownerPid === ownerPid) {
      try { session.channel.close?.(); }
      catch (error) { session.record.closeError = error.message || String(error); }
      try { session.peerConnection.close?.(); }
      catch (error) { session.record.closeError = error.message || String(error); }
      finally { this.finishDataChannel(id, reason); }
    }
    for (const [id, session] of this.rawSocketSessions) if (session.record.ownerPid === ownerPid) {
      try { session.companion.closeRaw?.(session.record.companionSessionId, reason); }
      catch (error) { session.record.closeError = error.message || String(error); }
      finally { this.finishRawSocket(id, reason); }
    }
    for (const [id, service] of this.loopbackServices) if (service.ownerPid === ownerPid) this.unregisterLoopbackService(id, reason);
  }

  registerLoopbackService(service = {}, context = {}) {
    const id = normalizeServiceId(service.id || service.name);
    const host = normalizeHost(service.host || `${id}.loopback.dindbos`);
    const now = new Date().toISOString();
    const record = {
      id,
      host,
      port: Number(service.port || 0),
      protocol: String(service.protocol || "loopback-http"),
      title: String(service.title || service.name || id),
      packageId: String(service.packageId || context.process?.manifest?.namespace?.packageId || ""),
      requester: requesterId(context),
      ownerPid: Number(context.process?.pid || 0),
      registeredAt: now,
      updatedAt: now,
      requests: 0,
      bytesReceived: 0,
      status: "listening",
      handler: typeof service.handler === "function" ? service.handler : null,
    };
    this.loopbackServices.set(id, record);
    this.writeProcfs();
    return publicLoopbackService(record);
  }

  unregisterLoopbackService(id, reason = "unregistered") {
    const key = normalizeServiceId(id);
    const record = this.loopbackServices.get(key);
    if (!record) throw new Error(`net: service ${id}: no such loopback service`);
    record.status = "closed";
    record.updatedAt = new Date().toISOString();
    record.closeReason = String(reason || "unregistered");
    this.loopbackServices.delete(key);
    this.writeProcfs();
    return publicLoopbackService(record);
  }

  services() {
    return [...this.loopbackServices.values()].map(publicLoopbackService);
  }

  serviceForTarget(target) {
    const host = normalizeHost(target.hostname);
    const protocol = String(target.protocol || "");
    if (protocol === "loopback:" || protocol === "dindbos:") {
      return this.loopbackServices.get(normalizeServiceId(host)) || null;
    }
    return [...this.loopbackServices.values()].find((service) => service.host === host) || null;
  }

  openRawSocket(protocol, host, port, options = {}, context = {}) {
    const normalizedProtocol = normalizeRawProtocol(protocol);
    const normalizedHost = normalizeHost(host);
    const normalizedPort = normalizePort(port);
    this.assertHostAllowed(normalizedHost, normalizedProtocol === "tcp" ? "net.rawTcp" : "net.rawUdp", context, `${normalizedProtocol}://${normalizedHost}:${normalizedPort}`);
    const companion = this.rawSocketCompanion || this.os.networkRawSocketCompanion || null;
    const companionStatus = this.companionStatus(companion);
    if (!companionStatus.approved || !companionStatus.capabilities.includes(normalizedProtocol === "tcp" ? "rawTcp" : "rawUdp")) {
      throw new Error(`net: raw ${normalizedProtocol.toUpperCase()} requires approved networkd companion`);
    }
    if (typeof companion.openRaw !== "function") throw new Error("net: networkd companion does not implement raw socket open");
    const id = this.nextId();
    const openedAt = new Date().toISOString();
    const companionSession = companion.openRaw({
      id,
      protocol: normalizedProtocol,
      host: normalizedHost,
      port: normalizedPort,
      mode: options.mode || "connect",
    });
    const record = {
      id,
      companionSessionId: companionSession?.id || companionSession?.sessionId || id,
      protocol: normalizedProtocol,
      host: normalizedHost,
      port: normalizedPort,
      requester: requesterId(context),
      state: "open",
      openedAt,
      closedAt: "",
      closeReason: "",
      bytesSent: 0,
      bytesReceived: 0,
      companion: companionStatus.identity,
      objectId: "",
      handleId: "",
    };
    this.rawSocketSessions.set(id, { record, companion });
    this.registerSocketKernelObject(record, "raw", context);
    this.writeProcfs();
    return {
      id,
      protocol: normalizedProtocol,
      host: normalizedHost,
      port: normalizedPort,
      objectId: record.objectId,
      handleId: record.handleId,
      state: record.state,
      close: (reason = "closed") => this.closeRawSocket(id, reason),
    };
  }

  closeRawSocket(id, reason = "closed") {
    const session = this.rawSocketSessions.get(id);
    if (!session) throw new Error(`net: raw socket ${id}: no such session`);
    this.assertSocketHandle(session.record, ["close"]);
    session.companion.closeRaw?.(session.record.companionSessionId, reason);
    this.finishRawSocket(id, reason);
    return cloneRecord(session.record);
  }

  finishRawSocket(id, reason = "closed") {
    const session = this.rawSocketSessions.get(id);
    if (!session) return;
    session.record.state = "closed";
    session.record.closedAt = new Date().toISOString();
    session.record.closeReason = String(reason || "");
    this.revokeSocketKernelObject(session.record, "raw-socket-closed");
    this.rawSocketSessions.delete(id);
    this.rawSocketHistory.push(cloneRecord(session.record));
    this.rawSocketHistory = this.rawSocketHistory.slice(-200);
    this.appendLog({
      finishedAt: session.record.closedAt,
      requester: session.record.requester,
      host: session.record.host,
      status: `raw-${session.record.protocol}-closed`,
      bytesReceived: session.record.bytesReceived,
      url: `${session.record.protocol}://${session.record.host}:${session.record.port}`,
      reason: session.record.closeReason,
    });
    this.writeProcfs();
  }

  companionStatus(companion = this.rawSocketCompanion || this.os.networkRawSocketCompanion || null) {
    const identity = companion?.identity || "";
    const protocolVersion = companion?.protocolVersion || "";
    const configuredCapabilities = [...(companion?.capabilities || [])].map(String);
    const permission = this.os.companionPermissionStatus?.(identity) || null;
    const permissionMatches = permission
      ? Boolean(permission.approved && permission.protocolVersion === protocolVersion)
      : true;
    const capabilities = permission && permission.approved
      ? configuredCapabilities.filter((capability) => permission.capabilities.some((entry) => entry.toLowerCase() === capability.toLowerCase()))
      : configuredCapabilities;
    return {
      identity,
      protocolVersion,
      approved: Boolean(companion?.approved && identity === "networkd" && protocolVersion === "dindbos-networkd-v1" && permissionMatches),
      capabilities,
      rawTcpUdp: companion ? "companion-gated" : "unsupported-browser-only",
    };
  }

  openDataChannel(peer, options = {}, context = {}) {
    const target = normalizePeerTarget(peer);
    this.assertAllowed(target, "net.webrtc", context);
    const PeerConnection = this.rtcPeerConnectionAdapter || this.os.networkPeerConnection || globalThis.RTCPeerConnection;
    if (typeof PeerConnection !== "function") throw new Error("net: WebRTC unavailable in this browser");
    const id = this.nextId();
    const label = String(options.label || "dindbos");
    const openedAt = new Date().toISOString();
    const peerConnection = new PeerConnection(options.configuration || {});
    const channel = peerConnection.createDataChannel(label, options.channel || {});
    const record = {
      id,
      peer: target.hostname,
      label,
      requester: requesterId(context),
      state: "connecting",
      openedAt,
      closedAt: "",
      closeReason: "",
      messagesSent: 0,
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      signaling: "external-required",
      objectId: "",
      handleId: "",
    };
    this.dataChannelSessions.set(id, { record, peerConnection, channel });
    this.registerSocketKernelObject(record, "webrtc", context);
    this.attachDataChannelEvents(id, channel);
    this.writeProcfs();
    return {
      id,
      peer: record.peer,
      label,
      objectId: record.objectId,
      handleId: record.handleId,
      state: record.state,
      send: (data) => this.sendDataChannel(id, data),
      close: (reason = "closed") => this.closeDataChannel(id, reason),
    };
  }

  sendDataChannel(id, data = "") {
    const session = this.dataChannelSessions.get(id);
    if (!session) throw new Error(`net: datachannel ${id}: no such session`);
    this.assertSocketHandle(session.record, ["send"]);
    const text = typeof data === "string" ? data : JSON.stringify(data);
    session.channel.send?.(text);
    session.record.messagesSent += 1;
    session.record.bytesSent += byteLength(text);
    this.bytesSent += byteLength(text);
    this.syncSocketKernelObject(session.record, "webrtc");
    this.writeProcfs();
    return { id, bytes: byteLength(text), messagesSent: session.record.messagesSent };
  }

  closeDataChannel(id, reason = "closed") {
    const session = this.dataChannelSessions.get(id);
    if (!session) throw new Error(`net: datachannel ${id}: no such session`);
    this.assertSocketHandle(session.record, ["close"]);
    session.channel.close?.();
    session.peerConnection.close?.();
    if (session.record.state !== "closed") this.finishDataChannel(id, reason);
    return cloneRecord(session.record);
  }

  attachDataChannelEvents(id, channel) {
    const onOpen = () => {
      const session = this.dataChannelSessions.get(id);
      if (!session) return;
      session.record.state = "open";
      this.syncSocketKernelObject(session.record, "webrtc");
      this.writeProcfs();
    };
    const onMessage = (event = {}) => {
      const session = this.dataChannelSessions.get(id);
      if (!session) return;
      const size = byteLength(event.data || "");
      session.record.messagesReceived += 1;
      session.record.bytesReceived += size;
      this.bytesReceived += size;
      this.syncSocketKernelObject(session.record, "webrtc");
      this.writeProcfs();
    };
    const onClose = () => this.finishDataChannel(id, "closed");
    const onError = (event = {}) => {
      const session = this.dataChannelSessions.get(id);
      if (!session) return;
      session.record.state = "error";
      session.record.closeReason = String(event.message || "error");
      this.syncSocketKernelObject(session.record, "webrtc");
      this.writeProcfs();
    };
    if (typeof channel.addEventListener === "function") {
      channel.addEventListener("open", onOpen);
      channel.addEventListener("message", onMessage);
      channel.addEventListener("close", onClose);
      channel.addEventListener("error", onError);
    } else {
      channel.onopen = onOpen;
      channel.onmessage = onMessage;
      channel.onclose = onClose;
      channel.onerror = onError;
    }
  }

  finishDataChannel(id, reason = "closed") {
    const session = this.dataChannelSessions.get(id);
    if (!session) return;
    session.record.state = "closed";
    session.record.closedAt = new Date().toISOString();
    session.record.closeReason = String(reason || "");
    this.revokeSocketKernelObject(session.record, "webrtc-datachannel-closed");
    this.dataChannelSessions.delete(id);
    this.dataChannelHistory.push(cloneRecord(session.record));
    this.dataChannelHistory = this.dataChannelHistory.slice(-200);
    this.appendLog({
      finishedAt: session.record.closedAt,
      requester: session.record.requester,
      host: session.record.peer,
      status: "webrtc-datachannel-closed",
      bytesReceived: session.record.bytesReceived,
      url: `webrtc://${session.record.peer}/${session.record.label}`,
      reason: session.record.closeReason,
    });
    this.writeProcfs();
  }

  openWebSocket(url, options = {}, context = {}) {
    const target = normalizeSocketUrl(url);
    this.assertAllowed(target, "net.websocket", context);
    const Socket = this.webSocketAdapter || this.os.networkWebSocket || globalThis.WebSocket;
    if (typeof Socket !== "function") throw new Error("net: WebSocket unavailable in this browser");
    const id = this.nextId();
    const openedAt = new Date().toISOString();
    const record = {
      id,
      url: redactedUrl(target),
      host: target.hostname,
      requester: requesterId(context),
      state: "connecting",
      openedAt,
      closedAt: "",
      closeCode: 0,
      closeReason: "",
      messagesSent: 0,
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      objectId: "",
      handleId: "",
    };
    const socket = new Socket(target.toString(), options.protocols);
    this.webSocketSessions.set(id, { record, socket });
    this.registerSocketKernelObject(record, "websocket", context);
    this.attachWebSocketEvents(id, socket);
    this.writeProcfs();
    return {
      id,
      url: record.url,
      host: record.host,
      objectId: record.objectId,
      handleId: record.handleId,
      state: record.state,
      send: (data) => this.sendWebSocket(id, data),
      close: (code = 1000, reason = "closed") => this.closeWebSocket(id, code, reason),
    };
  }

  sendWebSocket(id, data = "") {
    const session = this.webSocketSessions.get(id);
    if (!session) throw new Error(`net: websocket ${id}: no such session`);
    this.assertSocketHandle(session.record, ["send"]);
    const text = typeof data === "string" ? data : JSON.stringify(data);
    session.socket.send?.(text);
    session.record.messagesSent += 1;
    session.record.bytesSent += byteLength(text);
    this.bytesSent += byteLength(text);
    this.syncSocketKernelObject(session.record, "websocket");
    this.writeProcfs();
    return { id, bytes: byteLength(text), messagesSent: session.record.messagesSent };
  }

  closeWebSocket(id, code = 1000, reason = "closed") {
    const session = this.webSocketSessions.get(id);
    if (!session) throw new Error(`net: websocket ${id}: no such session`);
    this.assertSocketHandle(session.record, ["close"]);
    session.socket.close?.(code, reason);
    if (session.record.state !== "closed") this.finishWebSocket(id, code, reason);
    return cloneRecord(session.record);
  }

  attachWebSocketEvents(id, socket) {
    const onOpen = () => {
      const session = this.webSocketSessions.get(id);
      if (!session) return;
      session.record.state = "open";
      this.syncSocketKernelObject(session.record, "websocket");
      this.writeProcfs();
    };
    const onMessage = (event = {}) => {
      const session = this.webSocketSessions.get(id);
      if (!session) return;
      const size = byteLength(event.data || "");
      session.record.messagesReceived += 1;
      session.record.bytesReceived += size;
      this.bytesReceived += size;
      this.syncSocketKernelObject(session.record, "websocket");
      this.writeProcfs();
    };
    const onClose = (event = {}) => this.finishWebSocket(id, Number(event.code || 1000), String(event.reason || "closed"));
    const onError = (event = {}) => {
      const session = this.webSocketSessions.get(id);
      if (!session) return;
      session.record.state = "error";
      session.record.closeReason = String(event.message || "error");
      this.syncSocketKernelObject(session.record, "websocket");
      this.writeProcfs();
    };
    if (typeof socket.addEventListener === "function") {
      socket.addEventListener("open", onOpen);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onError);
    } else {
      socket.onopen = onOpen;
      socket.onmessage = onMessage;
      socket.onclose = onClose;
      socket.onerror = onError;
    }
  }

  finishWebSocket(id, code = 1000, reason = "closed") {
    const session = this.webSocketSessions.get(id);
    if (!session) return;
    session.record.state = "closed";
    session.record.closedAt = new Date().toISOString();
    session.record.closeCode = Number(code || 0);
    session.record.closeReason = String(reason || "");
    this.revokeSocketKernelObject(session.record, "websocket-closed");
    this.webSocketSessions.delete(id);
    this.webSocketHistory.push(cloneRecord(session.record));
    this.webSocketHistory = this.webSocketHistory.slice(-200);
    this.appendLog({
      finishedAt: session.record.closedAt,
      requester: session.record.requester,
      host: session.record.host,
      status: "websocket-closed",
      bytesReceived: session.record.bytesReceived,
      url: session.record.url,
      reason: session.record.closeReason,
    });
    this.writeProcfs();
  }

  async fetch(url, options = {}, context = {}) {
    const target = normalizeUrl(url);
    this.assertAllowed(target, "net.fetch", context);
    const loopback = this.serviceForTarget(target);
    if (loopback) return await this.fetchLoopback(loopback, target, options, context);
    const adapter = this.fetchAdapter || this.os.networkFetch || globalThis.fetch;
    if (typeof adapter !== "function") throw new Error("net: fetch unavailable in this browser");
    const id = this.nextId();
    const startedAt = new Date().toISOString();
    const request = {
      id,
      url: redactedUrl(target),
      host: target.hostname,
      method: String(options.method || "GET").toUpperCase(),
      requester: requesterId(context),
      status: "active",
      startedAt,
      finishedAt: "",
      durationMs: 0,
      bytesReceived: 0,
    };
    const scope = this.beginRequest(id, context, options.signal);
    this.requests.set(id, request);
    this.writeProcfs();
    try {
      const response = await abortableRequest(this.fetchWithRedirectPolicy(adapter, target, { ...options, signal: scope.signal }, context), scope.signal);
      const text = await abortableRequest(responseText(response), scope.signal);
      request.status = "completed";
      request.finishedAt = new Date().toISOString();
      request.durationMs = Date.parse(request.finishedAt) - Date.parse(startedAt);
      request.statusCode = Number(response?.status ?? 200);
      request.ok = response?.ok !== false && request.statusCode < 400;
      request.bytesReceived = byteLength(text);
      this.bytesReceived += request.bytesReceived;
      this.completeRequest(id, request);
      return {
        url: request.url,
        status: request.statusCode,
        ok: request.ok,
        headers: headersObject(response?.headers),
        text,
        bytes: request.bytesReceived,
      };
    } catch (error) {
      request.status = isAbortError(error) || scope.signal.aborted ? "cancelled" : "error";
      request.finishedAt = new Date().toISOString();
      request.durationMs = Date.parse(request.finishedAt) - Date.parse(startedAt);
      request.error = error.message || String(error);
      this.completeRequest(id, request);
      throw new Error(`net: ${target.hostname}: ${request.status === "cancelled" ? "request cancelled" : request.error}`);
    } finally { scope.release(); }
  }

  async fetchWithRedirectPolicy(adapter, target, options, context) {
    const redirectMode = options.redirect || "follow";
    if (!["follow", "manual", "error"].includes(redirectMode)) throw new TypeError("invalid fetch redirect mode");
    let current = target;
    let requestOptions = { ...options, redirect: "manual" };
    for (let redirects = 0; ; redirects += 1) {
      if (options.signal?.aborted) {
        const error = new Error("request cancelled");
        error.name = "AbortError";
        throw error;
      }
      // Fetch must not contact the next host before its capability check. Browser
      // manual redirects are opaque, so those cannot be safely followed here.
      const response = await adapter(current.toString(), requestOptions);
      if (response?.type === "opaqueredirect") {
        await discardResponseBody(response);
        throw new Error("redirect blocked: this browser hides the redirect destination; request the final permitted URL directly");
      }
      if (response?.redirected) {
        await discardResponseBody(response);
        throw new Error("fetch adapter followed a redirect despite manual redirect policy");
      }
      const status = Number(response?.status);
      if (![301, 302, 303, 307, 308].includes(status)) return response;
      const location = Object.entries(headersObject(response.headers)).find(([name]) => name.toLowerCase() === "location")?.[1];
      if (redirectMode === "error") {
        await discardResponseBody(response);
        throw new Error("redirect blocked by request redirect policy");
      }
      if (redirectMode === "manual" || !location) return response;
      if (redirects >= 20) {
        await discardResponseBody(response);
        throw new Error("too many redirects");
      }
      let destination;
      try {
        destination = normalizeUrl(new URL(location, current).toString());
        if (!["http:", "https:"].includes(destination.protocol)) throw new Error("redirect destination must use HTTP or HTTPS");
        this.assertAllowed(destination, "net.fetch", context);
      } catch (error) {
        await discardResponseBody(response);
        throw error;
      }
      const headers = new Headers(requestOptions.headers || {});
      if (current.origin !== destination.origin) {
        for (const name of ["authorization", "proxy-authorization", "cookie", "cookie2"]) headers.delete(name);
      }
      const method = String(requestOptions.method || "GET").toUpperCase();
      const rewriteToGet = (status === 301 || status === 302) && method === "POST" || status === 303 && method !== "GET" && method !== "HEAD";
      if (rewriteToGet) {
        requestOptions = { ...requestOptions, method: "GET", body: undefined };
        for (const name of ["content-encoding", "content-language", "content-location", "content-type", "content-length"]) headers.delete(name);
      } else if (requestOptions.body && (typeof requestOptions.body.getReader === "function" || typeof requestOptions.body[Symbol.asyncIterator] === "function")) {
        await discardResponseBody(response);
        throw new Error("cannot replay a streaming request body across a redirect");
      }
      requestOptions = { ...requestOptions, headers };
      await discardResponseBody(response);
      current = destination;
    }
  }

  async fetchLoopback(service, target, options = {}, context = {}) {
    if (!service.handler) throw new Error(`net: ${service.host}: loopback service has no handler`);
    const id = this.nextId();
    const startedAt = new Date().toISOString();
    const request = {
      id,
      url: redactedUrl(target),
      host: service.host,
      serviceId: service.id,
      method: String(options.method || "GET").toUpperCase(),
      requester: requesterId(context),
      status: "active",
      startedAt,
      finishedAt: "",
      durationMs: 0,
      bytesReceived: 0,
      loopback: true,
    };
    const scope = this.beginRequest(id, context, options.signal);
    this.requests.set(id, request);
    this.writeProcfs();
    try {
      const response = await abortableRequest(Promise.resolve().then(() => service.handler({
        id,
        url: target.toString(),
        path: target.pathname || "/",
        method: request.method,
        headers: options.headers || {},
        body: options.body || "",
        requester: request.requester,
        signal: scope.signal,
      })), scope.signal);
      const text = await abortableRequest(responseText(response), scope.signal);
      request.status = "completed";
      request.finishedAt = new Date().toISOString();
      request.durationMs = Date.parse(request.finishedAt) - Date.parse(startedAt);
      request.statusCode = Number(response?.status ?? 200);
      request.ok = response?.ok !== false && request.statusCode < 400;
      request.bytesReceived = byteLength(text);
      service.requests += 1;
      service.bytesReceived += request.bytesReceived;
      service.updatedAt = request.finishedAt;
      this.bytesReceived += request.bytesReceived;
      this.completeRequest(id, request);
      return {
        url: request.url,
        status: request.statusCode,
        ok: request.ok,
        headers: headersObject(response?.headers),
        text,
        bytes: request.bytesReceived,
        loopback: true,
        serviceId: service.id,
      };
    } catch (error) {
      request.status = isAbortError(error) || scope.signal.aborted ? "cancelled" : "error";
      request.finishedAt = new Date().toISOString();
      request.durationMs = Date.parse(request.finishedAt) - Date.parse(startedAt);
      request.error = error.message || String(error);
      this.completeRequest(id, request);
      throw new Error(`net: ${service.host}: ${request.error}`);
    } finally { scope.release(); }
  }

  policyProbe(url, context = {}, capability = "net.fetch") {
    const target = normalizeUrl(url);
    try {
      this.assertAllowed(target, capability, context);
      return {
        url: redactedUrl(target),
        host: target.hostname,
        capability,
        allowed: true,
        reason: "allowed",
        browserOnly: true,
        companionRequired: false,
      };
    } catch (error) {
      return {
        url: redactedUrl(target),
        host: target.hostname,
        capability,
        allowed: false,
        reason: error.message,
        browserOnly: true,
        companionRequired: false,
      };
    }
  }

  dnsProbe(host, context = {}) {
    const target = normalizeUrl(host.includes("://") ? host : `https://${host}`);
    const probe = this.policyProbe(target.toString(), context, "net.dns");
    return {
      ...probe,
      addresses: probe.allowed ? ["browser-policy-only"] : [],
      rawDnsSupported: false,
    };
  }

  status() {
    return {
      activeRequests: [...this.requests.values()].map(cloneRecord),
      history: this.history.slice(-50).map(cloneRecord),
      deniedHosts: this.deniedHosts.slice(-50).map(cloneRecord),
      totals: {
        requests: this.history.length,
        denied: this.deniedHosts.length,
        active: this.requests.size,
        bytesReceived: this.bytesReceived,
        bytesSent: this.bytesSent,
      },
      websocket: {
        sessions: [...this.webSocketSessions.values()].map((session) => cloneRecord(session.record)),
        history: this.webSocketHistory.slice(-50).map(cloneRecord),
        supported: Boolean(this.webSocketAdapter || this.os.networkWebSocket || globalThis.WebSocket),
        reason: "browser WebSocket broker",
      },
      webrtc: {
        dataChannels: [...this.dataChannelSessions.values()].map((session) => cloneRecord(session.record)),
        history: this.dataChannelHistory.slice(-50).map(cloneRecord),
        supported: Boolean(this.rtcPeerConnectionAdapter || this.os.networkPeerConnection || globalThis.RTCPeerConnection),
        reason: "browser WebRTC data channel broker; signaling remains external",
      },
      rawSockets: {
        sessions: [...this.rawSocketSessions.values()].map((session) => cloneRecord(session.record)),
        history: this.rawSocketHistory.slice(-50).map(cloneRecord),
      },
      services: this.services(),
      firewall: {
        events: this.firewallEvents.slice(-100).map(cloneRecord),
        allowed: this.firewallEvents.filter((entry) => entry.action === "allow").length,
        denied: this.firewallEvents.filter((entry) => entry.action === "deny").length,
      },
      companion: {
        ...this.companionStatus(),
      },
    };
  }

  assertAllowed(url, capability, context = {}) {
    return this.assertHostAllowed(url.hostname, capability, context, redactedUrl(url));
  }

  assertHostAllowed(host, capability, context = {}, url = host) {
    if (context.process?.endedAt) throw new Error("net: process has exited");
    if (isShellOrSystem(context)) return true;
    if (typeof context.assertCapability === "function") context.assertCapability(capability);
    const hosts = allowedHosts(context);
    if (hosts.includes("*") || hosts.some((rule) => hostMatches(host, rule))) {
      this.recordFirewall({
        action: "allow",
        host,
        capability,
        requester: requesterId(context),
        reason: hosts.includes("*") ? "wildcard" : "host-allowlist",
        url,
      });
      return true;
    }
    const record = {
      at: new Date().toISOString(),
      url: String(url || host),
      host,
      capability,
      requester: requesterId(context),
      reason: hosts.length ? "host-not-allowed" : "no-network-hosts",
    };
    this.recordFirewall({ action: "deny", ...record });
    this.deniedHosts.push(record);
    this.deniedHosts = this.deniedHosts.slice(-200);
    this.appendLog({ ...record, status: "denied" });
    this.writeProcfs();
    throw new Error(`net: ${host}: host denied by network policy`);
  }

  recordFirewall(event = {}) {
    this.firewallEvents.push({
      at: event.at || new Date().toISOString(),
      action: String(event.action || "unknown"),
      host: String(event.host || ""),
      capability: String(event.capability || ""),
      requester: String(event.requester || ""),
      reason: String(event.reason || ""),
      url: String(event.url || ""),
    });
    this.firewallEvents = this.firewallEvents.slice(-200);
  }

  registerSocketKernelObject(record, kind, context = {}) {
    if (!record) return null;
    record.ownerPid = Number(context.process?.pid || 0);
    if (!this.os.objects) return null;
    const rights = socketRights(record, kind);
    const object = this.os.objects.register("socket", {
      ref: socketRef(record, kind),
      name: `${kind}:${record.id}`,
      ownerPid: context.process?.pid || 0,
      namespace: context.process?.manifest?.namespace || null,
      user: context.process?.user || this.os.session?.user || "guest",
      rights,
      metadata: socketKernelMetadata(record, kind),
    });
    record.objectId = object?.id || "";
    const handle = record.objectId ? this.os.objects.createHandle(record.objectId, {
      ownerPid: context.process?.pid || 0,
      user: context.process?.user || this.os.session?.user || "guest",
      uid: context.process?.uid || 0,
      gid: context.process?.gid || 0,
      groups: context.process?.groups || [],
      namespace: context.process?.manifest?.namespace || null,
      rights,
      closeOnExec: true,
      transferPolicy: "none",
      metadata: socketHandleMetadata(record, kind),
    }) : null;
    record.handleId = handle?.id || "";
    return object;
  }

  syncSocketKernelObject(record, kind) {
    if (!record?.objectId || !this.os.objects) return null;
    const rights = socketRights(record, kind);
    const object = this.os.objects.update(record.objectId, {
      rights,
      metadata: socketKernelMetadata(record, kind),
    });
    if (record.handleId) {
      this.os.objects.updateHandle(record.handleId, {
        rights,
        metadata: socketHandleMetadata(record, kind),
      });
    }
    return object;
  }

  revokeSocketKernelObject(record, reason = "socket-closed") {
    if (!record?.objectId || !this.os.objects) return null;
    return this.os.objects.revoke(record.objectId, reason);
  }

  assertSocketHandle(record, rights = []) {
    if (!record?.handleId || !this.os.objects) return null;
    try {
      return this.os.objects.assertHandle(record.handleId, {
        ownerPid: this.os.objects.getHandle(record.handleId)?.ownerPid,
        objectType: "socket",
        rights,
      });
    } catch (error) {
      throw new Error(`net socket handle: ${error.message}`);
    }
  }

  completeRequest(id, record) {
    this.requests.delete(id);
    this.history.push(cloneRecord(record));
    this.history = this.history.slice(-200);
    this.appendLog(record);
    this.writeProcfs();
  }

  nextId() {
    const id = `net-${this.nextRequestId}`;
    this.nextRequestId += 1;
    return id;
  }

  writeProcfs() {
    const system = this.os.permissions?.systemPrincipal?.();
    if (!system || !this.os.fs) return;
    ensureDirectory(this.os, "/proc", system);
    ensureDirectory(this.os, "/proc/net", system);
    const payload = `${JSON.stringify(this.status(), null, 2)}\n`;
    this.os.fs.writeOrCreateFile("/proc/net/status.json", payload, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/net/requests", `${formatRequests(this.status())}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/net/services.json", `${JSON.stringify(this.services(), null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/net/firewall.json", `${JSON.stringify(this.status().firewall, null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/sockets.json", `${JSON.stringify(socketTable(this.status()), null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/sockets", `${formatSockets(socketTable(this.status()))}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }

  appendLog(record) {
    const system = this.os.permissions?.systemPrincipal?.();
    if (!system || !this.os.fs) return;
    ensureDirectory(this.os, "/var/log/dindbos", system);
    const line = `${record.finishedAt || record.at || new Date().toISOString()} requester=${record.requester || "-"} host=${record.host || "-"} status=${record.status || "unknown"} bytes=${record.bytesReceived || 0} url=${record.url || "-"}${record.error ? ` error=${record.error}` : ""}${record.reason ? ` reason=${record.reason}` : ""}\n`;
    if (this.os.fs.exists(NET_LOG_PATH)) this.os.fs.appendFile(NET_LOG_PATH, line, "/", system);
    else this.os.fs.writeOrCreateFile(NET_LOG_PATH, line, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-------",
    }, system);
  }
}

function allowedHosts(context = {}) {
  const manifest = context.process?.manifest || {};
  return [
    ...(manifest.networkHosts || []),
    ...(manifest.sandbox?.networkHosts || []),
    ...(manifest.namespace?.networkHosts || []),
  ].map((host) => String(host || "").trim().toLowerCase()).filter(Boolean);
}

function hostMatches(hostname, rule) {
  const host = String(hostname || "").toLowerCase();
  const pattern = String(rule || "").toLowerCase();
  if (!pattern) return false;
  if (pattern === host) return true;
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
  return false;
}

function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(`net: invalid URL: ${value || ""}`);
  }
  if (!["http:", "https:", "loopback:", "dindbos:"].includes(parsed.protocol)) throw new Error(`net: unsupported URL scheme: ${parsed.protocol}`);
  return parsed;
}

function normalizeSocketUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(`net: invalid URL: ${value || ""}`);
  }
  if (!["ws:", "wss:"].includes(parsed.protocol)) throw new Error(`net: unsupported WebSocket URL scheme: ${parsed.protocol}`);
  return parsed;
}

function normalizePeerTarget(value) {
  const peer = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/i.test(peer)) throw new Error(`net: invalid WebRTC peer: ${value || ""}`);
  return new URL(`webrtc://${peer}`);
}

function normalizeRawProtocol(value) {
  const protocol = String(value || "").trim().toLowerCase();
  if (protocol !== "tcp" && protocol !== "udp") throw new Error(`net: unsupported raw socket protocol: ${value || ""}`);
  return protocol;
}

function normalizeHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]{0,253}$/i.test(host)) throw new Error(`net: invalid host: ${value || ""}`);
  return host;
}

function normalizeServiceId(value) {
  const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id || id.length > 80) throw new Error(`net: invalid service id: ${value || ""}`);
  return id;
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`net: invalid port: ${value || ""}`);
  return port;
}

function redactedUrl(url) {
  const safe = new URL(url.toString());
  [...safe.searchParams.keys()].forEach((key) => {
    if (/token|secret|password|auth|key/i.test(key)) safe.searchParams.set(key, "[redacted]");
  });
  safe.username = safe.username ? "[redacted]" : "";
  safe.password = "";
  return safe.toString();
}

async function responseText(response) {
  if (typeof response?.text === "function") return response.text();
  if (response?.body !== undefined) return String(response.body);
  return "";
}

async function discardResponseBody(response) {
  try { await response?.body?.cancel?.(); } catch { /* Preserve the policy or fetch error. */ }
}

function headersObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === "function") return Object.fromEntries(headers.entries());
  return { ...headers };
}

function isAbortError(error) {
  return error?.name === "AbortError" || /abort|cancel/i.test(error?.message || "");
}

function isShellOrSystem(context = {}) {
  return Boolean(context.principal?.system || context.system || requesterId(context) === "shell");
}

function abortableRequest(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); const error = new Error("request cancelled"); error.name = "AbortError"; reject(error); };
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function requesterId(context = {}) {
  return String(context.process?.appId || context.appId || "shell");
}

function cloneRecord(record) {
  return { ...record };
}

function publicLoopbackService(record) {
  return {
    id: record.id,
    host: record.host,
    port: Number(record.port || 0),
    protocol: record.protocol,
    title: record.title,
    packageId: record.packageId,
    requester: record.requester,
    registeredAt: record.registeredAt,
    updatedAt: record.updatedAt,
    requests: Number(record.requests || 0),
    bytesReceived: Number(record.bytesReceived || 0),
    status: record.status,
  };
}

function socketRights(record = {}, kind = "") {
  const rights = ["inspect", "close"];
  if (kind !== "raw") rights.push("send", "receive");
  if (record.state === "closed") return ["inspect"];
  return rights;
}

function socketRef(record = {}, kind = "") {
  if (kind === "websocket") return `${record.url || "websocket"}#${record.id}`;
  if (kind === "webrtc") return `webrtc://${record.peer || "-"}/${record.label || "dindbos"}#${record.id}`;
  return `${record.protocol || "raw"}://${record.host || "-"}:${record.port || 0}#${record.id}`;
}

function socketKernelMetadata(record = {}, kind = "") {
  return {
    socketId: record.id || "",
    kind,
    requester: record.requester || "",
    state: record.state || "",
    host: record.host || record.peer || "",
    port: Number(record.port || 0),
    protocol: record.protocol || (kind === "websocket" ? "websocket" : kind),
    label: record.label || "",
    messagesSent: Number(record.messagesSent || 0),
    messagesReceived: Number(record.messagesReceived || 0),
    bytesSent: Number(record.bytesSent || 0),
    bytesReceived: Number(record.bytesReceived || 0),
    companion: record.companion || "",
  };
}

function socketHandleMetadata(record = {}, kind = "") {
  return {
    socketId: record.id || "",
    kind,
    requester: record.requester || "",
    host: record.host || record.peer || "",
    port: Number(record.port || 0),
    state: record.state || "",
  };
}

function byteLength(value) {
  if (globalThis.TextEncoder) return new TextEncoder().encode(String(value)).length;
  return String(value).length;
}

function ensureDirectory(os, path, principal) {
  if (os.fs.exists(path)) return;
  const parent = os.fs.dirname(path);
  if (parent && parent !== path && !os.fs.exists(parent)) ensureDirectory(os, parent, principal);
  os.fs.createDirectory(path, "/", { owner: "root", group: "root" }, principal);
}

function formatRequests(status) {
  return [
    "ID STATUS HOST REQUESTER BYTES URL",
    ...status.activeRequests.map((entry) => `${entry.id} active ${entry.host} ${entry.requester} ${entry.bytesReceived || 0} ${entry.url}`),
    ...status.websocket.sessions.map((entry) => `${entry.id} websocket-${entry.state} ${entry.host} ${entry.requester} ${entry.bytesReceived || 0} ${entry.url}`),
    ...status.websocket.history.slice(-20).map((entry) => `${entry.id} websocket-${entry.state} ${entry.host} ${entry.requester} ${entry.bytesReceived || 0} ${entry.url}`),
    ...status.webrtc.dataChannels.map((entry) => `${entry.id} webrtc-${entry.state} ${entry.peer} ${entry.requester} ${entry.bytesReceived || 0} ${entry.label}`),
    ...status.webrtc.history.slice(-20).map((entry) => `${entry.id} webrtc-${entry.state} ${entry.peer} ${entry.requester} ${entry.bytesReceived || 0} ${entry.label}`),
    ...status.rawSockets.sessions.map((entry) => `${entry.id} raw-${entry.protocol}-${entry.state} ${entry.host}:${entry.port} ${entry.requester} ${entry.bytesReceived || 0} companion=${entry.companion}`),
    ...status.rawSockets.history.slice(-20).map((entry) => `${entry.id} raw-${entry.protocol}-${entry.state} ${entry.host}:${entry.port} ${entry.requester} ${entry.bytesReceived || 0} companion=${entry.companion}`),
    ...status.history.slice(-20).map((entry) => `${entry.id} ${entry.status} ${entry.host} ${entry.requester} ${entry.bytesReceived || 0} ${entry.url}`),
    ...status.deniedHosts.slice(-20).map((entry) => `- denied ${entry.host} ${entry.requester} 0 ${entry.url}`),
  ].join("\n");
}

function socketTable(status = {}) {
  return [
    ...(status.websocket?.sessions || []).map((entry) => socketTableEntry(entry, "websocket")),
    ...(status.websocket?.history || []).map((entry) => socketTableEntry(entry, "websocket")),
    ...(status.webrtc?.dataChannels || []).map((entry) => socketTableEntry(entry, "webrtc")),
    ...(status.webrtc?.history || []).map((entry) => socketTableEntry(entry, "webrtc")),
    ...(status.rawSockets?.sessions || []).map((entry) => socketTableEntry(entry, "raw")),
    ...(status.rawSockets?.history || []).map((entry) => socketTableEntry(entry, "raw")),
  ];
}

function socketTableEntry(entry = {}, type = "") {
  return {
    id: entry.id || "",
    type,
    protocol: entry.protocol || type,
    state: entry.state || "",
    host: entry.host || entry.peer || "",
    port: Number(entry.port || 0),
    requester: entry.requester || "",
    objectId: entry.objectId || "",
    handleId: entry.handleId || "",
    bytesSent: Number(entry.bytesSent || 0),
    bytesReceived: Number(entry.bytesReceived || 0),
  };
}

function formatSockets(entries = []) {
  if (!entries.length) return "id type state host port requester bytesSent bytesReceived";
  return [
    "id type state host port requester bytesSent bytesReceived",
    ...entries.map((entry) => [
      entry.id,
      entry.type,
      entry.state,
      entry.host || "-",
      entry.port || "-",
      entry.requester || "-",
      entry.bytesSent || 0,
      entry.bytesReceived || 0,
    ].join(" ")),
  ].join("\n");
}
