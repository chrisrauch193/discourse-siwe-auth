import Controller from "@ember/controller";
import { withPluginApi } from "discourse/lib/plugin-api";
import Web3Modal from "../lib/web3modal";

export default Controller.extend({
  isConnecting: false,
  errorMessage: null,

  init() {
    this._super(...arguments);
    // Don't auto-init - wait for user to click button
  },

  verifySignature(account, message, signature, avatar) {
    document.getElementById("eth_account").value = account;
    document.getElementById("eth_message").value = message;
    document.getElementById("eth_signature").value = signature;
    document.getElementById("eth_avatar").value = avatar || '';
    document.getElementById("siwe-sign").submit();
  },

  async initAuth() {
    if (this.isConnecting) {
      return; // Prevent double-clicks
    }

    this.set('isConnecting', true);
    this.set('errorMessage', null);

    try {
      const env = withPluginApi("0.11.7", (api) => {
        const siteSettings = api.container.lookup("site-settings:main");
        return {
          PROJECT_ID: siteSettings.siwe_project_id,
        }
      });

      const provider = Web3Modal.create();
      await provider.providerInit(env);
      
      await provider.runSigningProcess((res) => {
        const [account, message, signature, avatar] = res;
        this.verifySignature(account, message, signature, avatar);
      });
    } catch (e) {
      console.error('SIWE authentication error:', e);
      this.set('errorMessage', e.message || 'Authentication failed');
    } finally {
      this.set('isConnecting', false);
    }
  },

  actions: {
    initAuth() {
      this.initAuth();
    }
  }
});
