/**
 * Reown AppKit Bundle for Discourse SIWE Plugin
 * 
 * This entry point creates a browser-compatible bundle that exposes
 * AppKit functionality to window.ReownAppKit for use in Discourse plugins.
 */

import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, polygon, sepolia, arbitrum } from '@reown/appkit/networks'

// Export to window for Discourse plugin access
window.ReownAppKit = {
  // Core AppKit factory
  createAppKit,
  
  // Wagmi adapter for EVM chains
  WagmiAdapter,
  
  // Pre-configured networks
  networks: {
    mainnet,
    polygon,
    sepolia,
    arbitrum
  },
  
  // Helper to create a configured modal
  createModal: function(projectId, metadata, networks = [mainnet, polygon]) {
    const wagmiAdapter = new WagmiAdapter({
      projectId,
      networks
    })
    
    const modal = createAppKit({
      adapters: [wagmiAdapter],
      networks,
      projectId,
      metadata,
      features: {
        analytics: false
      },
      themeVariables: {
        '--w3m-z-index': '99999'
      }
    })
    
    return { modal, wagmiAdapter }
  }
}

console.log('[SIWE] Reown AppKit bundle loaded')
