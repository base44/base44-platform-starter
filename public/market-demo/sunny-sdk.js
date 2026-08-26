/**
 * The app half of Sunny's viewer-token handshake (src/lib/appFrameAuth.ts). A real
 * Base44 app would inline this; it is shared here only to keep the demos short.
 *
 *   app → parent:  {type: "sunny:auth:request"}
 *   parent → app:  {type: "sunny:auth:token", token} | {type: "sunny:auth:denied"}
 *
 * then `Authorization: Bearer` on POST /api/sunny.
 */
(function () {
  let token = null;

  function requestToken() {
    return new Promise((resolve, reject) => {
      // Sunny attaches its listener in an effect, which can flush after a fast iframe
      // has already asked. Retry rather than hang forever.
      const ask = () => window.parent.postMessage({ type: "sunny:auth:request" }, "*");
      const retry = setInterval(ask, 500);
      const timer = setTimeout(() => { stop(); reject(new Error("Sunny did not answer")); }, 10000);
      function stop() {
        clearInterval(retry);
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
      }
      function onMessage(e) {
        const type = e.data?.type;
        if (type === "sunny:auth:denied") {
          stop();
          reject(Object.assign(new Error("Sunny refused a token for this app."), { denied: true, status: e.data.status }));
        } else if (type === "sunny:auth:token") {
          stop();
          resolve(e.data.token);
        }
      }
      window.addEventListener("message", onMessage);
      ask();
    });
  }

  /** One call to Sunny. Re-handshakes once on a 401 (an expired token). */
  async function sunny(action, params = {}) {
    if (!token) token = await requestToken();
    let res = await send(action, params);
    if (res.status === 401) {
      token = await requestToken();
      res = await send(action, params);
    }
    const body = await res.json().catch(() => ({}));
    if (body.error) throw Object.assign(new Error(body.error), { status: res.status });
    return body;
  }

  function send(action, params) {
    return fetch(new URL("/api/sunny", location.origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...params, action }),
    });
  }

  /** Turns a thrown error into something worth showing a person. */
  function explain(err) {
    if (err.denied) {
      return err.status === 403
        ? "Install this app from the market to let it read your boards."
        : "Sunny would not issue this app a token.";
    }
    return err.message;
  }

  window.Sunny = { call: sunny, explain };
})();
