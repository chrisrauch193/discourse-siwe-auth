import EmberObject from "@ember/object";
import {
    ajax
} from "discourse/lib/ajax";
import {
    popupAjaxError
} from "discourse/lib/ajax-error";
import loadScript from "discourse/lib/load-script";


const Web3Modal = EmberObject.extend({
    modal: null,
    wagmiAdapter: null,
    provider: null,
    connectedAddress: null,
    _currentUnsubscribe: null,  // Track current subscription to clean up
    
    async providerInit(env) {
        await this.loadScripts();
        
        const { createAppKit, WagmiAdapter, networks } = window.ReownAppKit;
        const projectId = env.PROJECT_ID;
        
        // Get the site URL for metadata
        const siteUrl = window.location.origin;
        const siteName = document.title || 'Discourse';
        
        // Create Wagmi adapter
        const wagmiAdapter = new WagmiAdapter({
            projectId,
            networks: [networks.mainnet, networks.polygon]
        });
        this.wagmiAdapter = wagmiAdapter;
        
        // Create AppKit modal
        const modal = createAppKit({
            adapters: [wagmiAdapter],
            networks: [networks.mainnet, networks.polygon],
            projectId,
            metadata: {
                name: siteName,
                description: 'Sign in with Ethereum',
                url: siteUrl,
                icons: [`${siteUrl}/images/logo-small.png`]
            },
            features: {
                analytics: false,
                email: false,        // Disable email login
                socials: false       // Disable Google, Apple, etc.
            },
            themeVariables: {
                '--w3m-z-index': '99999'
            }
        });
        
        this.modal = modal;
        
        // Subscribe to provider changes
        modal.subscribeProviders((providers) => {
            this.provider = providers['eip155'];
        });
        
        return modal;
    },

    async loadScripts() {
        return Promise.all([
            loadScript("/plugins/discourse-siwe/javascripts/appkit-bundle.min.js"),
        ]);
    },

    async signMessage(address) {
        let name = null;
        let avatar = null;
        
        // Try to fetch ENS name if available
        try {
            // ENS resolution would require additional setup
            // For now, we'll skip ENS and use the address
        } catch (error) {
            console.error('[SIWE] ENS lookup error:', error);
        }

        // Get chain ID from provider
        let chainId = 1; // Default to mainnet
        try {
            const chainIdHex = await this.provider.request({ method: 'eth_chainId' });
            chainId = parseInt(chainIdHex, 16);
        } catch (error) {
            console.error('[SIWE] Chain ID error:', error);
        }

        // Get SIWE message from backend
        const { message } = await ajax('/discourse-siwe/message', {
            data: {
                eth_account: address,
                chain_id: chainId,
            }
        }).catch(popupAjaxError);

        // Sign the message using personal_sign
        try {
            const signature = await this.provider.request({
                method: 'personal_sign',
                params: [message, address]
            });
            
            return [name || address, message, signature, avatar];
        } catch (e) {
            console.error('[SIWE] Signing error:', e);
            throw e;
        }
    },

    async runSigningProcess(cb) {
        // Clean up any previous subscription to prevent stale callbacks
        if (this._currentUnsubscribe) {
            try {
                this._currentUnsubscribe();
            } catch (e) {
                console.log('[SIWE] Cleanup previous subscription');
            }
            this._currentUnsubscribe = null;
        }
        
        let isProcessing = false;  // Prevent concurrent sign attempts
        let hasCompleted = false;  // Prevent any more attempts after success
        let initialCheckDone = false; // Skip the initial subscribeAccount fire
        
        // Store callback reference to ensure it's available
        const callback = cb;
        
        // Subscribe to account changes
        const unsubscribe = this.modal.subscribeAccount(async (account) => {
            // Skip the first fire (existing connection check on init)
            if (!initialCheckDone) {
                initialCheckDone = true;
                if (account.isConnected) {
                    console.log('[SIWE] Existing connection detected, waiting for user action');
                }
                return;
            }
            
            // Guard: skip if already processing or completed
            if (isProcessing || hasCompleted) {
                return;
            }
            
            if (account.isConnected && account.address) {
                isProcessing = true;
                this.connectedAddress = account.address;
                console.log('[SIWE] Wallet connected:', account.address);
                
                // Wait a moment for provider to be ready
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (this.provider) {
                    try {
                        console.log('[SIWE] Starting sign message flow');
                        const result = await this.signMessage(account.address);
                        console.log('[SIWE] Sign successful, calling callback');
                        hasCompleted = true;
                        unsubscribe();
                        this._currentUnsubscribe = null;
                        if (typeof callback === 'function') {
                            callback(result);
                        } else {
                            console.error('[SIWE] Callback is not a function:', typeof callback);
                        }
                    } catch (e) {
                        console.error('[SIWE] Sign process error:', e);
                        isProcessing = false;
                    }
                } else {
                    console.log('[SIWE] Provider not ready, waiting...');
                    isProcessing = false;
                }
            }
        });
        
        // Store unsubscribe function for cleanup
        this._currentUnsubscribe = unsubscribe;

        // Small delay to let initial subscription fire complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Open the modal
        console.log('[SIWE] Opening wallet modal');
        this.modal.open();
    },
});

export default Web3Modal;
