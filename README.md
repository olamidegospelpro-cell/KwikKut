# KwikKut

KwikKut is an installable, browser-based background remover. Pick or drop in an image, remove its background with the in-browser AI model, and save the result as a transparent PNG.

## Run locally

Serve this folder over HTTP or HTTPS (service workers and PWA installation require a secure context; `localhost` is supported). For example:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a modern browser.

## Notes

- Background removal runs in the browser. The app does not upload your image to a KwikKut server.
- The first removal downloads the AI model from the package's configured asset host and may take a little while; an internet connection is needed for that first run.
- The PWA caches the app shell so it can reopen offline. AI processing offline depends on the model assets already being available in the browser cache.
- Images up to 25 MB are accepted. Output is a transparent PNG.
- The app imports `@imgly/background-removal` from esm.sh; you can pin or self-host the package and model assets for a fully controlled deployment.
