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
                analytics: false
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
        // Subscribe to account changes
        const unsubscribe = this.modal.subscribeAccount(async (account) => {
            if (account.isConnected && account.address) {
                this.connectedAddress = account.address;
                
                // Wait a moment for provider to be ready
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (this.provider) {
                    try {
                        const result = await this.signMessage(account.address);
                        unsubscribe();
                        cb(result);
                    } catch (e) {
                        console.error('[SIWE] Sign process error:', e);
                    }
                }
            }
        });

        // Open the modal
        this.modal.open();
    },
});

export default Web3Modal;
