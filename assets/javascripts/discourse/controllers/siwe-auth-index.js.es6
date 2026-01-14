import Controller from "@ember/controller";
import { withPluginApi } from "discourse/lib/plugin-api";
import Web3Modal from "../lib/web3modal";

// Singleton instance to avoid multiple AppKit initializations
let web3ModalInstance = null;
let isInitialized = false;

export default Controller.extend({
  init() {
    this._super(...arguments);
    // Don't auto-init - wait for user to click the button
  },

  verifySignature(account, message, signature, avatar) {
    document.getElementById("eth_account").value = account;
    document.getElementById("eth_message").value = message;
    document.getElementById("eth_signature").value = signature;
    document.getElementById("eth_avatar").value = avatar;
    document.getElementById("siwe-sign").submit();
  },

  async initAuth() {
    const env = withPluginApi("0.11.7", (api) => {
      const siteSettings = api.container.lookup("site-settings:main");

      return {
        PROJECT_ID: siteSettings.siwe_project_id,
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
    
    // Run signing process with callback
    await web3ModalInstance.runSigningProcess((res) => {
      try {
        const [account, message, signature, avatar] = res;
        this.verifySignature(account, message, signature, avatar);
      } catch (e) {
        console.error('[SIWE] Verify error:', e);
      }
    });
  },

  actions: {
    async initAuth() {
      this.initAuth();
    }
  }
});
