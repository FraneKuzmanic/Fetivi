/**
 * The outer sandbox frame, ported from the ext-apps basic host (`examples/basic-host/src/sandbox.ts`).
 * It runs on its own origin, puts the widget HTML into an inner frame and relays messages between the
 * guest app and that frame. The guest app's origin is fixed here by the server, not guessed from the
 * referrer, and the inner frame gets no permissions and a fixed sandbox whatever the message asks for.
 */
export function sandboxPage(appOrigin: string): string {
  // `<` escaped so the value can never close the script element.
  const origin = JSON.stringify(appOrigin).replace(/</g, '\u003c');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fetivi sandbox</title>
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0}</style>
</head>
<body>
<script>
(function () {
  var EXPECTED_HOST_ORIGIN = ${origin};
  var OWN_ORIGIN = window.location.origin;
  var RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';
  var PROXY_READY = 'ui/notifications/sandbox-proxy-ready';

  if (window.self === window.top) throw new Error('This page only runs inside the guest app.');
  var referrerOrigin = '';
  try { referrerOrigin = new URL(document.referrer).origin; } catch (e) {}
  if (referrerOrigin !== EXPECTED_HOST_ORIGIN) throw new Error('Embedded by an unexpected page: ' + document.referrer);

  // Self-test: reaching window.top must fail, or the isolation is broken and nothing may load.
  try {
    window.top.alert('The sandbox is not isolated.');
    throw 'FAIL';
  } catch (e) {
    if (e === 'FAIL') throw new Error('The sandbox is not isolated.');
  }

  var inner = document.createElement('iframe');
  inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  document.body.appendChild(inner);

  window.addEventListener('message', function (event) {
    if (event.source === window.parent) {
      if (event.origin !== EXPECTED_HOST_ORIGIN) return;
      var data = event.data;
      if (data && data.method === RESOURCE_READY) {
        var html = data.params && data.params.html;
        if (typeof html !== 'string') return;
        var doc = inner.contentDocument || (inner.contentWindow && inner.contentWindow.document);
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();
        } else {
          inner.srcdoc = html;
        }
      } else if (inner.contentWindow) {
        inner.contentWindow.postMessage(data, '*');
      }
    } else if (event.source === inner.contentWindow) {
      if (event.origin !== OWN_ORIGIN) return;
      window.parent.postMessage(event.data, EXPECTED_HOST_ORIGIN);
    }
  });

  window.parent.postMessage({ jsonrpc: '2.0', method: PROXY_READY, params: {} }, EXPECTED_HOST_ORIGIN);
})();
</script>
</body>
</html>
`;
}
