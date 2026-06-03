# eatsure-frontend

Static MVP frontend for EatSure barcode and label-photo analysis.

## Local setup

Open `index.html` directly, or serve the folder with any static file server.

The default backend is:

```text
https://eatsure-backend-4dkh.onrender.com
```

For local development, override it in the browser console:

```js
localStorage.setItem("EATSURE_BACKEND_BASE", "http://localhost:3000");
location.reload();
```

To reset:

```js
localStorage.removeItem("EATSURE_BACKEND_BASE");
location.reload();
```

Deploys can also define:

```html
<script>
  window.EATSURE_CONFIG = {
    backendBase: "https://your-backend.example"
  };
</script>
```

Place that script before `app.js`.
