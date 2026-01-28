# SIWE Plugin Testing

This directory contains standalone test pages for testing the SIWE plugin without needing to run a full Discourse instance.

## Local tester (bypass Discourse 404)

When Discourse returns 404 for `/discourse-siwe/javascripts/appkit-bundle.min.js`, you can still debug the SIWE flow by loading the AppKit bundle from disk and talking to the real forum for `/discourse-siwe/message` etc.

From the **plugin repo root** (one level above this `test/` folder):

```bash
cd discourse-siwe-auth
pnpm run serve
# or: npx serve . -p 3333
```

Then open **http://localhost:3333/test/test-plugin-flow.html** in your browser.

- The AppKit script loads from `http://localhost:3333/public/javascripts/appkit-bundle.min.js` (no 404).
- Set "Real Backend URL" to `https://forum.chrisrauch.org` and **uncheck** "Use Mock Backend" to hit the real forum for message/session APIs.
- Use "Test Full Plugin Flow" to walk through connect + sign against the live Discourse instance.

Same idea for `test-appkit.html`: open **http://localhost:3333/test/test-appkit.html** to load the bundle locally.

## Test Pages

### 1. `test-appkit.html` - Basic AppKit Test
Tests the Reown AppKit bundle in isolation:
- Initialize AppKit
- Connect wallet
- Sign a test message

**Usage:**
1. Run `pnpm run serve` from repo root, then open http://localhost:3333/test/test-appkit.html (or open the file directly if you only need offline checks).
2. Enter your WalletConnect Project ID (optional - can test with injected wallet only)
3. Click "Initialize AppKit"
4. Click "Connect Wallet"
5. Click "Sign Test Message"

### 2. `test-plugin-flow.html` - Full Plugin Flow Test
Simulates the complete Discourse plugin flow:
- Web3Modal class implementation
- Singleton pattern
- Subscription management
- Callback execution
- Form submission simulation

**Usage:**
1. Run `pnpm run serve` from repo root, then open http://localhost:3333/test/test-plugin-flow.html.
2. Enter your WalletConnect Project ID (required)
3. Enter backend URL (default: `https://forum.chrisrauch.org`), uncheck "Use Mock Backend" to hit the real forum.
4. Click "Test Full Plugin Flow"
5. Connect wallet and sign
6. View the callback result and form data

## Building the AppKit Bundle

Before testing, make sure the AppKit bundle is built:

```bash
cd bundle
npm install
npm run build
```

This will generate `public/javascripts/appkit-bundle.min.js` which is loaded by the test pages.

## Testing Checklist

- [ ] AppKit initializes without errors
- [ ] Wallet connection works (MetaMask and WalletConnect)
- [ ] Sign message flow completes
- [ ] Callback is executed with correct data
- [ ] No console errors
- [ ] Works in Chrome (was the main issue)
- [ ] Works in Firefox
- [ ] Works in Safari

## Debugging

If you see errors:

1. **404 for `appkit-bundle.min.js` / MIME type 'text/html'** (on the forum):
   - Discourse is returning an HTML 404, so the plugin route for the bundle is not active.
   - Ensure `app/controllers/discourse_siwe/assets_controller.rb` is in the repo and has been pushed. Rebuild the Discourse container so it clones the latest plugin.
   - Check that the route exists: `curl -I https://forum.chrisrauch.org/discourse-siwe/javascripts/appkit-bundle.min.js` — you want `200` and `Content-Type: application/javascript`, not `404` and `text/html`.
   - Use the **local tester** above: run `pnpm run serve` and open the test page from `http://localhost:3333/test/` so the bundle is loaded from disk and you can still hit the real forum for `/discourse-siwe/message`.

2. **WebAssembly CSP error**: The CSP directive `wasm_unsafe_eval` needs to be added to Discourse's CSP (already done in `plugin.rb`)

3. **"r is not a function"**: This was a callback context issue - make sure `this` is bound correctly in the controller

4. **500 error on `/discourse-siwe/message`**: Check that ETH address is being converted to EIP-55 checksum format

5. **WalletConnect not working**: Make sure Project ID is correct and network requests aren't blocked

## Notes

- The test pages use the same AppKit bundle as the Discourse plugin
- The `test-plugin-flow.html` simulates the exact same code structure as the Discourse plugin
- Form submission is simulated - it doesn't actually submit to Discourse
- Backend URL must point to a running Discourse instance with the plugin installed
