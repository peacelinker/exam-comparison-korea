function isHtmlNavigation(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function requestForPath(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

export default {
  async fetch(request, env) {
    if (!env?.ASSETS?.fetch) {
      return new Response("Static asset binding is unavailable.", {
        status: 503,
      });
    }

    const url = new URL(request.url);
    const navigation = isHtmlNavigation(request);

    // Cloudflare's asset binding does not always resolve "/" to index.html.
    // Map the root explicitly, then use index.html as the SPA fallback.
    const primaryRequest =
      url.pathname === "/"
        ? requestForPath(request, "/index.html")
        : request;
    const response = await env.ASSETS.fetch(primaryRequest);

    if (response.status !== 404 || !navigation) return response;
    return env.ASSETS.fetch(requestForPath(request, "/index.html"));
  },
};
