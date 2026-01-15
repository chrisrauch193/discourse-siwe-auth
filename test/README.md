# SIWE Plugin Testing

This directory contains standalone test pages for testing the SIWE plugin without needing to run a full Discourse instance.

## Test Pages

### 1. `test-appkit.html` - Basic AppKit Test
Tests the Reown AppKit bundle in isolation:
- Initialize AppKit
- Connect wallet
- Sign a test message

**Usage:**
1. Open `test-appkit.html` in a browser
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
1. Open `test-plugin-flow.html` in a browser
2. Enter your WalletConnect Project ID (required)
3. Enter backend URL (default: `https://forum.chrisrauch.org`)
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

1. **WebAssembly CSP error**: The CSP directive `wasm_unsafe_eval` needs to be added to Discourse's CSP (already done in `plugin.rb`)

2. **"r is not a function"**: This was a callback context issue - make sure `this` is bound correctly in the controller

3. **500 error on `/discourse-siwe/message`**: Check that ETH address is being converted to EIP-55 checksum format

4. **WalletConnect not working**: Make sure Project ID is correct and network requests aren't blocked

## Notes

- The test pages use the same AppKit bundle as the Discourse plugin
- The `test-plugin-flow.html` simulates the exact same code structure as the Discourse plugin
- Form submission is simulated - it doesn't actually submit to Discourse
- Backend URL must point to a running Discourse instance with the plugin installed
