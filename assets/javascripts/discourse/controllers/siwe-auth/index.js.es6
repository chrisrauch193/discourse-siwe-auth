import Controller from "@ember/controller";
import { action } from "@ember/object";
import { withPluginApi } from "discourse/lib/plugin-api";
import Web3Modal from "../../lib/web3modal";
import { later } from "@ember/runloop";

// Singleton instance to avoid multiple AppKit initializations
let web3ModalInstance = null;
let isInitialized = false;

export default Controller.extend({
  isLoading: true,
  isAlreadyLoggedIn: false,
  currentUsername: null,
  
  init() {
    this._super(...arguments);
    
    // Check for auto-connect URL params after a short delay
    later(this, this._checkAutoConnect, 500);
  },
  
  /**
   * Check URL params for auto-connect flow.
   * If wallet=0x... is present, auto-trigger auth.
   * But first check if user is already logged in.
   */
  async _checkAutoConnect() {
    const params = new URLSearchParams(window.location.search);
    const wallet = params.get('wallet');
    const returnTo = params.get('return_to') || '/';
    
    // First check if already logged in via Discourse
    // The server-side controller already redirects if logged in,
    // but this is a backup for client-side rendered pages
    const currentUser = this.get('currentUser');
    if (currentUser) {
      console.log('[SIWE] User already logged in:', currentUser.username);
      this.set('isAlreadyLoggedIn', true);
      this.set('currentUsername', currentUser.username);
      this.set('isLoading', false);
      
      // Redirect to return_to or home
      later(this, () => {
        window.location.href = returnTo;
      }, 1000);
      return;
    }
    
    this.set('isLoading', false);
    
    if (wallet && wallet.startsWith('0x')) {
      console.log('[SIWE] Auto-connect triggered for wallet:', wallet);
      
      // Store return_to in session storage for post-auth redirect
      if (returnTo) {
        sessionStorage.setItem('siwe_return_to', returnTo);
      }
      
      // Auto-trigger auth flow
      this.initAuth();
    }
  },

  verifySignature(account, message, signature, avatar) {
    // Check for return_to in session storage
    const returnTo = sessionStorage.getItem('siwe_return_to');
    if (returnTo) {
      // Add return_to as hidden field or handle after submit
      const form = document.getElementById("siwe-sign");
      const hiddenField = document.createElement('input');
      hiddenField.type = 'hidden';
      hiddenField.name = 'return_to';
      hiddenField.value = returnTo;
      form.appendChild(hiddenField);
      
      // Clear from session storage
      sessionStorage.removeItem('siwe_return_to');
    }
    
    document.getElementById("eth_account").value = account;
    document.getElementById("eth_message").value = message;
    document.getElementById("eth_signature").value = signature;
    document.getElementById("eth_avatar").value = avatar;
    document.getElementById("siwe-sign").submit();
  },

  initAuth: action(async function() {
    const env = withPluginApi("0.11.7", (api) => {
      const siteSettings = api.container.lookup("site-settings:main");

      return {
        PROJECT_ID: siteSettings.siwe_project_id,
        CHAIN_ID: siteSettings.siwe_chain_id,
        CHAIN_NAME: siteSettings.siwe_chain_name,
      }
    });
    
    // Use singleton pattern - only initialize AppKit once
    if (!web3ModalInstance) {
      web3ModalInstance = Web3Modal.create();
    }
    
    // Only initialize AppKit once
    if (!isInitialized) {
      await web3ModalInstance.providerInit(env);
      isInitialized = true;
    }
    
    // Get return_to from URL or session storage
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get('return_to') || sessionStorage.getItem('siwe_return_to');
    
    // Run signing process with callback - bind 'this' to preserve controller context
    const controller = this;
    await web3ModalInstance.runSigningProcess((res) => {
      try {
        const [account, message, signature, avatar] = res;
        controller.verifySignature(account, message, signature, avatar);
      } catch (e) {
        console.error('[SIWE] Verify error:', e);
      }
    }, { returnTo });
  }),
});
