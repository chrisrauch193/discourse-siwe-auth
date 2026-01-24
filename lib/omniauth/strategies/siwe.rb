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
        eth_address = request.params[options.uid_field.to_s]
        # Use full wallet address for both name and nickname
        # Discourse max_username_length should be set to 60 in admin settings
        # to accommodate 42-char wallet addresses
        full_address = eth_address ? eth_address.downcase : nil
        
        {
          name: full_address,           # Display name: full wallet address
          nickname: full_address,       # Username: full wallet address (lowercase)
          image: request.params['eth_avatar'],
          # Note: email is intentionally nil - SIWE is email-less auth
        }
      end
      
      extra do
        {
          raw_info: {
            eth_account: request.params['eth_account'],
            eth_address: request.params['eth_account'],
          }
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
        # Wrap entire callback in error handler to prevent 500s
        begin
          # Parse and validate request parameters
          eth_message_crlf = request.params['eth_message']
          eth_signature = request.params['eth_signature']
          
          # Validate required parameters are present
          if eth_message_crlf.blank? || eth_signature.blank?
            Rails.logger.error("[SIWE] Missing required parameters: eth_message=#{eth_message_crlf.present?}, eth_signature=#{eth_signature.present?}")
            return fail!("missing_parameters")
          end
          
          # Parse SIWE message with error handling
          begin
            eth_message = eth_message_crlf.encode(eth_message_crlf.encoding, universal_newline: true)
            siwe_message = ::Siwe::Message.from_message(eth_message)
          rescue StandardError => e
            Rails.logger.error("[SIWE] Failed to parse SIWE message: #{e.class} - #{e.message}")
            return fail!("invalid_message_format")
          end

          domain = Discourse.base_url
          domain.slice!("#{Discourse.base_protocol}://")
          if siwe_message.domain != domain
            Rails.logger.error("[SIWE] Domain mismatch: expected=#{domain}, got=#{siwe_message.domain}")
            return fail!("Invalid domain")
          end

          # Check for missing or mismatched nonce
          stored_nonce = session[:nonce]
          if stored_nonce.blank?
            Rails.logger.error("[SIWE] No nonce in session - session may have expired or been cleared")
            return fail!("session_expired")
          end
          
          if siwe_message.nonce != stored_nonce
            Rails.logger.error("[SIWE] Nonce mismatch: expected=#{stored_nonce}, got=#{siwe_message.nonce}")
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
        rescue StandardError => e
          # Catch any unexpected errors to prevent 500 responses
          Rails.logger.error("[SIWE] Unexpected validation error: #{e.class} - #{e.message}")
          Rails.logger.error("[SIWE] Backtrace: #{e.backtrace.first(5).join("\n")}")
          failure_reason = "validation_failed"
        end

        return fail!(failure_reason) if failure_reason

        Rails.logger.info("[SIWE] Validation passed, calling super (OmniAuth callback)")
        Rails.logger.info("[SIWE] Address: #{siwe_message.address}, Chain: #{message_chain_id}")
        
        begin
          super
        rescue StandardError => e
          Rails.logger.error("[SIWE] Error in OmniAuth super callback: #{e.class} - #{e.message}")
          Rails.logger.error("[SIWE] Super backtrace: #{e.backtrace.first(10).join("\n")}")
          return fail!("omniauth_error")
        end
        
        rescue StandardError => e
          # Catch-all for any unexpected errors to prevent 500 responses
          Rails.logger.error("[SIWE] Unexpected error in callback_phase: #{e.class} - #{e.message}")
          Rails.logger.error("[SIWE] Backtrace: #{e.backtrace.first(10).join("\n")}")
          return fail!("unexpected_error")
        end
      end # callback_phase
      
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
