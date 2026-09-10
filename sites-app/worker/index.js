function assetRequest(request, pathname) {
  if (!pathname) return request;
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";
  return new Request(url, request);
}

export default {
  fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    return env.ASSETS.fetch(assetRequest(request, pathname === "/" ? "/index.html" : null));
  },
};
