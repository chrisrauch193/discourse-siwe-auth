# frozen_string_literal: true

require 'siwe'
require 'eth'

module DiscourseSiwe
  class AuthController < ::ApplicationController
    # Skip CSRF for API calls from frontend
    skip_before_action :verify_authenticity_token, only: [:check_session]
    
    def index
      # Check if user is already logged in
      if current_user
        return_to = params[:return_to] || '/'
        redirect_to return_to
        return
      end
      
      # Store return_to in session for post-auth redirect
      if params[:return_to]
        session[:siwe_return_to] = params[:return_to]
      end
      
      # Continue to render the SIWE auth page
    end
    
    # API endpoint to check if user is already logged in
    # This allows the frontend to skip re-auth
    def check_session
      if current_user
        render json: { 
          logged_in: true, 
          username: current_user.username,
          wallet: current_user.user_associated_accounts.find_by(provider_name: 'siwe')&.provider_uid
        }
      else
        render json: { logged_in: false }
      end
    end

    def message
      # Convert address to EIP-55 checksum format (SIWE gem requires this)
      eth_account = Eth::Address.new(params[:eth_account]).checksummed
      
      domain = Discourse.base_url
      domain.slice!("#{Discourse.base_protocol}://")
      message = Siwe::Message.new(domain, eth_account, Discourse.base_url, "1", {
        issued_at: Time.now.utc.iso8601,
        statement: SiteSetting.siwe_statement,
        nonce: Siwe::Util.generate_nonce,
        chain_id: params[:chain_id],
      })
      session[:nonce] = message.nonce

      render json: { message: message.prepare_message }
    end
  end
end
