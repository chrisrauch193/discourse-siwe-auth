module OmniAuth
  module Strategies
    class Siwe
      include OmniAuth::Strategy

      option :fields, %i[eth_message eth_account eth_signature]
      option :uid_field, :eth_account

      uid do
        request.params[options.uid_field.to_s]
      end

      info do
        {
          name: request.params[options.uid_field.to_s],
          image: request.params['eth_avatar']
        }
      end

      def request_phase
        # Check if user is already logged in via Discourse session
        # If so, redirect to return_to or home instead of showing auth page
        if current_user_logged_in?
          return_to = request.params['return_to'] || '/'
          redirect return_to
          return
        end
        
        query_string = env['QUERY_STRING']
        redirect "/discourse-siwe/auth?#{query_string}"
      end

      def callback_phase
        eth_message_crlf = request.params['eth_message']
        eth_message = eth_message_crlf.encode(eth_message_crlf.encoding, universal_newline: true)
        eth_signature = request.params['eth_signature']
        siwe_message = ::Siwe::Message.from_message(eth_message)

        domain = Discourse.base_url
        domain.slice!("#{Discourse.base_protocol}://")
        if siwe_message.domain != domain
          return fail!("Invalid domain")
        end

        if siwe_message.nonce != session[:nonce]
          return fail!("Invalid nonce")
        end
        
        # Validate chain ID matches configured network
        expected_chain_id = SiteSetting.siwe_chain_id.to_i
        message_chain_id = siwe_message.chain_id.to_i
        if expected_chain_id > 0 && message_chain_id != expected_chain_id
          network_name = SiteSetting.siwe_chain_name.presence || "Chain #{expected_chain_id}"
          return fail!("wrong_network", 
            network_name: network_name, 
            chain_id: expected_chain_id,
            message: "Please switch to #{network_name} (Chain ID: #{expected_chain_id}) to sign in"
          )
        end
        
        # Store chain_id and address in session for membership check later
        session[:siwe_chain_id] = message_chain_id
        session[:siwe_address] = siwe_message.address

        failure_reason = nil
        begin
          siwe_message.validate(eth_signature)
        rescue Siwe::ExpiredMessage
          failure_reason = :expired_message
        rescue Siwe::NotValidMessage
          failure_reason = :invalid_message
        rescue Siwe::InvalidSignature
          failure_reason = :invalid_signature
        end

        return fail!(failure_reason) if failure_reason

        super
      end
      
      private
      
      def current_user_logged_in?
        # Check Discourse session for logged-in user
        # Discourse stores the user_id in the session via warden
        return false unless env['warden']
        env['warden'].authenticated?
      rescue
        false
      end
    end
  end
end
