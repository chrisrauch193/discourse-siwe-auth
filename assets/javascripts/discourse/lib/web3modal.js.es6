import EmberObject from "@ember/object";
import {
    ajax
} from "discourse/lib/ajax";
import {
    popupAjaxError
} from "discourse/lib/ajax-error";
import loadScript from "discourse/lib/load-script";


// Network configurations for common chains
const NETWORK_CONFIGS = {
    1: { id: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' },
    11155111: { id: 11155111, name: 'Sepolia', rpcUrl: 'https://rpc.sepolia.org' },
    137: { id: 137, name: 'Polygon', rpcUrl: 'https://polygon-rpc.com' },
    42161: { id: 42161, name: 'Arbitrum One', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    10: { id: 10, name: 'Optimism', rpcUrl: 'https://mainnet.optimism.io' },
    8453: { id: 8453, name: 'Base', rpcUrl: 'https://mainnet.base.org' },
};

const Web3Modal = EmberObject.extend({
    modal: null,
    wagmiAdapter: null,
    provider: null,
    connectedAddress: null,
    _currentUnsubscribe: null,  // Track current subscription to clean up
    _expectedWallet: null,      // Expected wallet from URL param
    _returnTo: null,            // Return URL after auth
    _expectedChainId: null,     // Expected chain ID from settings
    _expectedChainName: null,   // Expected chain name from settings
    
    /**
     * Parse URL parameters for auto-connect flow.
     * Supports:
     * - wallet=0x... : Expected wallet address
     * - return_to=/path : Redirect after successful auth
     */
    parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        
        const wallet = params.get('wallet');
        if (wallet && wallet.startsWith('0x')) {
            this._expectedWallet = wallet.toLowerCase();
            console.log('[SIWE] Expected wallet from URL:', this._expectedWallet);
        }
        
        const returnTo = params.get('return_to');
        if (returnTo) {
            this._returnTo = returnTo;
            console.log('[SIWE] Return URL:', this._returnTo);
        }
        
        return {
            wallet: this._expectedWallet,
            returnTo: this._returnTo
        };
    },
    
    /**
     * Redirect to return_to URL if set.
     */
    redirectIfNeeded() {
        if (this._returnTo) {
            console.log('[SIWE] Redirecting to:', this._returnTo);
            window.location.href = this._returnTo;
        }
    },
    
    async providerInit(env) {
        await this.loadScripts();
        
        const { createAppKit, WagmiAdapter, networks } = window.ReownAppKit;
        const projectId = env.PROJECT_ID;
        
        // Store expected chain from settings
        this._expectedChainId = env.CHAIN_ID ? parseInt(env.CHAIN_ID, 10) : null;
        this._expectedChainName = env.CHAIN_NAME || null;
        
        console.log('[SIWE] Expected chain:', this._expectedChainId, this._expectedChainName);
        
        // Get the site URL for metadata
        const siteUrl = window.location.origin;
        const siteName = document.title || 'Discourse';
        
        // Determine which network to use
        let targetNetwork = networks.mainnet; // Default
        let networkList = [networks.mainnet, networks.sepolia];
        
        if (this._expectedChainId) {
            // Map chain ID to AppKit network
            const chainMap = {
                1: networks.mainnet,
                11155111: networks.sepolia,
                137: networks.polygon,
                42161: networks.arbitrum,
                10: networks.optimism,
                8453: networks.base,
            };
            
            if (chainMap[this._expectedChainId]) {
                targetNetwork = chainMap[this._expectedChainId];
                // Only show the expected network
                networkList = [targetNetwork];
            }
        }
        
        // Create Wagmi adapter with target network
        const wagmiAdapter = new WagmiAdapter({
            projectId,
            networks: networkList
        });
        this.wagmiAdapter = wagmiAdapter;
        
        // Create AppKit modal
        const modal = createAppKit({
            adapters: [wagmiAdapter],
            networks: networkList,
            defaultNetwork: targetNetwork,
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
            console.log('[SIWE] Connected chain ID:', chainId);
        } catch (error) {
            console.error('[SIWE] Chain ID error:', error);
        }
        
        // Check if on the expected chain
        if (this._expectedChainId && chainId !== this._expectedChainId) {
            const networkName = this._expectedChainName || `Chain ${this._expectedChainId}`;
            const errorMsg = `Please switch to ${networkName} (Chain ID: ${this._expectedChainId}) to sign in.`;
            console.error('[SIWE] Wrong network:', errorMsg);
            
            // Try to request network switch
            try {
                await this.provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x' + this._expectedChainId.toString(16) }]
                });
                
                // Wait a moment for the switch to complete
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // VERIFY switch actually worked
                const newChainIdHex = await this.provider.request({ method: 'eth_chainId' });
                chainId = parseInt(newChainIdHex, 16);
                console.log('[SIWE] Chain after switch attempt:', chainId);
                
                if (chainId !== this._expectedChainId) {
                    const failedMsg = `Failed to switch network. Please manually switch to ${networkName} (Chain ID: ${this._expectedChainId}) in your wallet before signing.`;
                    console.error('[SIWE] Network switch verification failed. Expected:', this._expectedChainId, 'Got:', chainId);
                    alert(failedMsg);
                    throw new Error(failedMsg);
                }
                
                console.log('[SIWE] Successfully switched to chain:', chainId);
            } catch (switchError) {
                console.error('[SIWE] Network switch failed:', switchError);
                // Re-throw if it's our verification error, otherwise show generic message
                if (switchError.message && switchError.message.includes('Failed to switch')) {
                    throw switchError;
                }
                alert(errorMsg);
                throw new Error(errorMsg);
            }
        }

        // Get SIWE message from backend
        const { message } = await ajax('/discourse-siwe/message', {
            type: 'GET',
            data: {
                eth_account: address,
                chain_id: chainId,
            },
            dataType: 'json'
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

    async runSigningProcess(cb, options = {}) {
        // Parse URL params for auto-connect
        this.parseUrlParams();
        
        // Override return URL if provided in options
        if (options.returnTo) {
            this._returnTo = options.returnTo;
        }
        
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
        const self = this;
        
        // Subscribe to account changes - handle different return types
        const unsubscribeResult = this.modal.subscribeAccount(async (account) => {
            // Skip the first fire (existing connection check on init)
            if (!initialCheckDone) {
                initialCheckDone = true;
                
                // Auto-connect: if we have an expected wallet and it matches
                if (account.isConnected && account.address && self._expectedWallet) {
                    const connectedLower = account.address.toLowerCase();
                    if (connectedLower === self._expectedWallet) {
                        console.log('[SIWE] Auto-connect: wallet matches expected address');
                        // Continue to signing flow
                    } else {
                        console.log('[SIWE] Auto-connect: connected wallet does not match expected');
                        console.log('[SIWE] Connected:', connectedLower, 'Expected:', self._expectedWallet);
                        return; // Let user manually connect correct wallet
                    }
                } else if (account.isConnected) {
                    console.log('[SIWE] Existing connection detected, waiting for user action');
                    return;
                } else {
                    return;
                }
            }
            
            // Guard: skip if already processing or completed
            if (isProcessing || hasCompleted) {
                return;
            }
            
            if (account.isConnected && account.address) {
                // Check if wallet matches expected (if specified)
                if (self._expectedWallet) {
                    const connectedLower = account.address.toLowerCase();
                    if (connectedLower !== self._expectedWallet) {
                        console.warn('[SIWE] Connected wallet does not match expected. Please connect:', self._expectedWallet);
                        return;
                    }
                }
                
                isProcessing = true;
                self.connectedAddress = account.address;
                console.log('[SIWE] Wallet connected:', account.address);
                
                // Wait a moment for provider to be ready
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (self.provider) {
                    try {
                        console.log('[SIWE] Starting sign message flow');
                        const result = await self.signMessage(account.address);
                        console.log('[SIWE] Sign successful, calling callback');
                        hasCompleted = true;
                        
                        // Try to unsubscribe, but don't let it block the callback
                        try {
                            if (self._currentUnsubscribe && typeof self._currentUnsubscribe === 'function') {
                                self._currentUnsubscribe();
                                console.log('[SIWE] Successfully unsubscribed');
                            }
                        } catch (e) {
                            console.log('[SIWE] Unsubscribe error (non-fatal, continuing):', e);
                        }
                        
                        self._currentUnsubscribe = null;
                        
                        // Call the callback - this is the important part
                        if (typeof callback === 'function') {
                            try {
                                callback(result);
                                
                                // Redirect after successful auth if return_to is set
                                // Note: callback usually submits form which redirects,
                                // but we'll set a timeout fallback
                                if (self._returnTo) {
                                    setTimeout(() => {
                                        if (!document.hidden) {
                                            self.redirectIfNeeded();
                                        }
                                    }, 2000);
                                }
                            } catch (callbackError) {
                                console.error('[SIWE] Callback error:', callbackError);
                                throw callbackError;
                            }
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
        
        // Store unsubscribe function for cleanup (handle different return types)
        this._currentUnsubscribe = typeof unsubscribeResult === 'function' 
            ? unsubscribeResult 
            : (unsubscribeResult && typeof unsubscribeResult.unsubscribe === 'function' 
                ? () => unsubscribeResult.unsubscribe()
                : null);

        // Small delay to let initial subscription fire complete
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Open the modal
        console.log('[SIWE] Opening wallet modal');
        if (this._expectedWallet) {
            console.log('[SIWE] Expected wallet:', this._expectedWallet);
        }
        this.modal.open();
    },
});

export default Web3Modal;
