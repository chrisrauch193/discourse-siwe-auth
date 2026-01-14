import EmberObject from "@ember/object";
import {
    ajax
} from "discourse/lib/ajax";
import {
    popupAjaxError
} from "discourse/lib/ajax-error";

/**
 * Modern wallet connection using direct window.ethereum interaction.
 * This replaces the old Web3Modal v2 approach which had compatibility issues.
 * 
 * Supports:
 * - MetaMask
 * - Coinbase Wallet
 * - Any EIP-1193 compatible wallet
 */
const Web3Modal = EmberObject.extend({
    account: null,
    chainId: null,
    
    async providerInit(env) {
        this.projectId = env.PROJECT_ID;
        // No async initialization needed for direct ethereum approach
        return this;
    },

    /**
     * Check if an Ethereum provider is available
     */
    hasProvider() {
        return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
    },

    /**
     * Request wallet connection
     */
    async connect() {
        if (!this.hasProvider()) {
            throw new Error('No Ethereum wallet detected. Please install MetaMask or another Web3 wallet.');
        }

        try {
            // Request accounts using EIP-1102
            const accounts = await window.ethereum.request({ 
                method: 'eth_requestAccounts' 
            });
            
            if (!accounts || accounts.length === 0) {
                throw new Error('No accounts returned from wallet');
            }

            this.account = accounts[0];
            
            // Get chain ID
            const chainIdHex = await window.ethereum.request({ 
                method: 'eth_chainId' 
            });
            this.chainId = parseInt(chainIdHex, 16);

            return {
                address: this.account,
                chainId: this.chainId
            };
        } catch (error) {
            if (error.code === 4001) {
                throw new Error('User rejected the connection request');
            }
            throw error;
        }
    },

    /**
     * Fetch ENS name for an address (optional, may fail)
     */
    async fetchEnsName(address) {
        try {
            // Use Ethereum mainnet for ENS resolution
            const mainnetRpc = 'https://eth.llamarpc.com';
            
            // ENS reverse resolution: addr.reverse -> name
            const namehash = this.getAddressNamehash(address);
            
            const response = await fetch(mainnetRpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_call',
                    params: [{
                        to: '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63', // ENS Universal Resolver
                        data: '0x9061b923' + namehash.slice(2).padStart(64, '0') // reverse(bytes32)
                    }, 'latest'],
                    id: 1
                })
            });
            
            const result = await response.json();
            if (result.result && result.result !== '0x') {
                // Decode the name from the response
                return this.decodeEnsName(result.result);
            }
        } catch (e) {
            console.log('ENS lookup failed (optional):', e.message);
        }
        return null;
    },

    getAddressNamehash(address) {
        // Simplified - just return a placeholder, ENS resolution is optional
        return '0x' + address.slice(2).toLowerCase();
    },

    decodeEnsName(hexData) {
        // Simplified decoder - ENS is optional feature
        try {
            if (hexData.length < 130) return null;
            const offset = parseInt(hexData.slice(2, 66), 16) * 2 + 2;
            const length = parseInt(hexData.slice(offset, offset + 64), 16);
            const nameHex = hexData.slice(offset + 64, offset + 64 + length * 2);
            return Buffer.from(nameHex, 'hex').toString('utf8');
        } catch {
            return null;
        }
    },

    /**
     * Sign a SIWE message
     */
    async signMessage(message) {
        if (!this.account) {
            throw new Error('Not connected');
        }

        try {
            const signature = await window.ethereum.request({
                method: 'personal_sign',
                params: [message, this.account]
            });
            return signature;
        } catch (error) {
            if (error.code === 4001) {
                throw new Error('User rejected the signature request');
            }
            throw error;
        }
    },

    /**
     * Main signing flow
     */
    async runSigningProcess(cb) {
        try {
            // Step 1: Connect wallet
            const { address, chainId } = await this.connect();
            
            // Step 2: Try to get ENS name (optional)
            let name = null;
            let avatar = null;
            try {
                name = await this.fetchEnsName(address);
            } catch (e) {
                console.log('ENS lookup skipped');
            }

            // Step 3: Get SIWE message from server
            const { message } = await ajax('/discourse-siwe/message', {
                data: {
                    eth_account: address,
                    chain_id: chainId,
                }
            }).catch(popupAjaxError);

            // Step 4: Sign the message
            const signature = await this.signMessage(message);

            // Step 5: Return result
            cb([name || address, message, signature, avatar]);
            
        } catch (error) {
            console.error('Wallet signing error:', error);
            // Show user-friendly error
            if (error.message) {
                alert('Wallet Error: ' + error.message);
            } else {
                alert('Failed to connect wallet. Please try again.');
            }
            throw error;
        }
    },
});

export default Web3Modal;
